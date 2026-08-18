import { categories, sourceCatalog, makeId, coalesceDuplicateSuggestions, reconcileSuggestionAnchors as reconcileAnchors, type Branch, type Category, type GenerationRequest, type LedgerEvent, type SourceState, type Suggestion, type TaskPrompt, type WritingBrief, type WritingMode } from '$lib/domain';
import { restoreSuggestions } from '$lib/suggestion-history';
import { workspaceFacade, type MarkdownExport, type WorkspaceFacade } from '$lib/workspace/facade';
import type { ContextBucket, ContextScope, WorkspaceDocument, WorkspaceProject } from '$lib/workspace/model';

const defaultBrief: WritingBrief = { version: 1, form: 'fiction', pov: 'close third person', tense: 'past', distance: 'close, embodied, minimal narrator intrusion', canon: '' };
const defaultPrompt: TaskPrompt = { id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Flag craft issues precisely.' };

export class WorkspaceState {
  sessionId = $state('session_pending');
  projectId = $state('project_default');
  branchId = $state('main');
  mode = $state<WritingMode>('drafting');
  paused = $state(false);
  surface = $state<'docked' | 'tray'>('docked');
  activeSuggestionId = $state<string | null>(null);
  preview = $state<{ suggestionId: string; text: string } | null>(null);
  suggestions = $state<Suggestion[]>([]);
  ledger = $state<Required<LedgerEvent>[]>([]);
  brief = $state<WritingBrief>(defaultBrief);
  prompts = $state<TaskPrompt[]>([defaultPrompt]);
  branches = $state<Branch[]>([{ id: 'main', name: 'Main draft', createdAt: new Date().toISOString(), wordCount: 0, lastEdited: new Date().toISOString() }]);
  projects = $state<WorkspaceProject[]>([]);
  documents = $state<WorkspaceDocument[]>([]);
  contextBuckets = $state<ContextBucket[]>([]);
  sourceStates = $state<Record<string, SourceState>>(Object.fromEntries(sourceCatalog.map((source) => [source.id, source.id === 'openrouter' || source.id === 'ollama' ? 'off' : 'visible'])));
  categoryVisibility = $state<Record<Category, boolean>>(Object.fromEntries(categories.map((category) => [category, true])) as Record<Category, boolean>);
  densityCap = $state(8);
  costUsd = $state(0);
  loading = $state(true);
  generating = $state(false);
  notice = $state<string | null>(null);
  lastError = $state<string | null>(null);
  sourceClickAt = $state<Record<string, number>>({});
  private dispatches = new Map<string, AbortController>();
  private documentSave: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly facade: WorkspaceFacade = workspaceFacade) {}

  get pendingCount(): number {
    return this.suggestions.filter((suggestion) => suggestion.state === 'pending' || suggestion.state === 'hidden').length;
  }

  get visibleSuggestions(): Suggestion[] {
    if (this.mode === 'drafting') return [];
    return this.suggestions
      .filter((suggestion) => suggestion.state === 'pending')
      .filter((suggestion) => this.categoryVisibility[suggestion.category])
      .filter((suggestion) => this.sourceStates[suggestion.source] === 'visible')
      .sort((a, b) => a.order - b.order)
      .slice(0, this.densityCap);
  }

  get queuedCount(): number {
    return Math.max(0, this.suggestions.filter((suggestion) => suggestion.state === 'pending').length - this.visibleSuggestions.length);
  }

  get currentProject(): WorkspaceProject | null {
    return this.projects.find((project) => project.id === this.projectId) ?? null;
  }

  get currentDocument(): WorkspaceDocument | null {
    return this.documents.find((document) => document.id === this.branchId) ?? null;
  }

  get currentContext(): ContextBucket[] {
    return this.contextBuckets.filter((bucket) => bucket.projectId === this.projectId && (bucket.scope === 'project' || bucket.documentId === this.branchId));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage !== 'undefined') {
      this.sessionId = localStorage.getItem('margin-note:session') ?? makeId('session');
      localStorage.setItem('margin-note:session', this.sessionId);
      this.projectId = localStorage.getItem('margin-note:project') ?? 'project_default';
      this.branchId = localStorage.getItem('margin-note:document') ?? localStorage.getItem('margin-note:branch') ?? 'main';
    }
    try {
      const loaded = await this.facade.load({ projectId: this.projectId, documentId: this.branchId });
      this.brief = loaded.brief;
      this.prompts = loaded.prompts;
      this.projects = loaded.persistent.projects;
      this.documents = loaded.persistent.documents;
      this.contextBuckets = loaded.persistent.contextBuckets;
      this.projectId = loaded.activeProjectId;
      this.branchId = loaded.activeDocumentId;
      this.branches = loaded.branches;
      this.ledger = loaded.events;
      this.suggestions = restoreSuggestions(loaded.events);
      this.costUsd = loaded.stats.costUsd;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('margin-note:project', this.projectId);
        localStorage.setItem('margin-note:document', this.branchId);
        localStorage.setItem('margin-note:branch', this.branchId);
      }
      void this.log('session_started', { userAgent: navigator.userAgent, resumedSession: this.ledger.some((event) => event.sessionId === this.sessionId) });
    } catch (error) {
      this.initialized = false;
      this.lastError = error instanceof Error ? error.message : 'Could not initialize workspace';
    } finally {
      this.loading = false;
    }
  }

  async log(type: LedgerEvent['type'], payload: Record<string, unknown>, suggestionId?: string): Promise<void> {
    const event: LedgerEvent = { type, sessionId: this.sessionId, branchId: this.branchId, suggestionId, payload };
    try {
      const saved = await this.facade.appendEvent(event);
      this.ledger = [saved, ...this.ledger].slice(0, 60);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Ledger write failed';
    }
  }

  async refreshLedger(): Promise<void> {
    const data = await this.facade.events();
    this.ledger = data.events;
    this.costUsd = data.stats.costUsd;
  }

  async setMode(next: WritingMode): Promise<void> {
    if (next === this.mode) return;
    const previous = this.mode;
    this.mode = next;
    this.activeSuggestionId = null;
    await this.log('mode_switch', { from: previous, to: next, pendingSuggestions: this.pendingCount });
  }

  async togglePause(): Promise<void> {
    this.paused = !this.paused;
    if (this.paused) {
      for (const controller of this.dispatches.values()) controller.abort();
      this.dispatches.clear();
    }
    await this.log(this.paused ? 'paused' : 'resumed', { mode: this.mode });
  }

  async cycleSource(sourceId: string): Promise<void> {
    const now = Date.now();
    const previous = this.sourceStates[sourceId] ?? 'visible';
    const elapsed = now - (this.sourceClickAt[sourceId] ?? 0);
    let next: SourceState;
    if (previous === 'off') next = 'visible';
    else if (previous === 'visible') next = 'invisible';
    else next = elapsed <= 1000 ? 'off' : 'visible';
    this.sourceStates[sourceId] = next;
    this.sourceClickAt[sourceId] = now;
    if (next === 'off') {
      for (const [key, controller] of this.dispatches) {
        if (key.includes(`:${sourceId}:`)) { controller.abort(); this.dispatches.delete(key); }
      }
    }
    if (next === 'visible') {
      this.suggestions = this.suggestions.map((suggestion) => suggestion.source === sourceId && suggestion.state === 'hidden' ? { ...suggestion, state: 'pending' } : suggestion);
    }
    await this.log('source_state_changed', { source: sourceId, from: previous, to: next, dwellMs: elapsed });
  }

  toggleCategory(category: Category): void {
    this.categoryVisibility[category] = !this.categoryVisibility[category];
  }

  async requestSuggestions(input: Omit<GenerationRequest, 'sessionId' | 'branchId' | 'brief' | 'sourceStates' | 'mode'>, rangeKey = 'document'): Promise<Suggestion[]> {
    if (this.paused) return [];
    this.dispatches.get(rangeKey)?.abort();
    const controller = new AbortController();
    this.dispatches.set(rangeKey, controller);
    this.generating = true;
    await this.log('suggestions_requested', { range: [input.from, input.to], promptId: input.prompt.id, characters: input.text.length });
    try {
      const request: GenerationRequest = {
        ...input,
        sessionId: this.sessionId,
        branchId: this.branchId,
        brief: this.brief,
        sourceStates: { ...this.sourceStates },
        mode: this.mode,
        context: this.currentContext.map((bucket) => ({
          title: bucket.title,
          role: bucket.role,
          scope: bucket.scope,
          content: bucket.content,
          revision: bucket.revision
        }))
      };
      const data = await this.facade.suggestions(request, controller.signal);
      if (data.errors.length) this.notice = data.errors.map((item) => `${item.source}: ${item.message}`).join(' · ');
      await this.coalesceSuggestions([...this.suggestions, ...data.suggestions]);
      await this.refreshLedger();
      return data.suggestions.filter((suggestion) => this.suggestions.some((item) => item.id === suggestion.id && (item.state === 'pending' || item.state === 'hidden')));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return [];
      this.lastError = error instanceof Error ? error.message : 'Suggestion request failed';
      return [];
    } finally {
      if (this.dispatches.get(rangeKey) === controller) this.dispatches.delete(rangeKey);
      this.generating = this.dispatches.size > 0;
    }
  }

  activate(id: string | null): void { this.activeSuggestionId = id; }
  setPreview(suggestionId: string, text: string): void { this.preview = { suggestionId, text }; }
  clearPreview(): void { this.preview = null; }

  async reconcileSuggestionAnchors(resolve: (suggestion: Suggestion) => { from: number; to: number; text: string } | null): Promise<void> {
    const reconciled = reconcileAnchors(this.suggestions, resolve);
    const expiredIds = new Set(reconciled.expired.map((suggestion) => suggestion.id));
    if (this.activeSuggestionId && expiredIds.has(this.activeSuggestionId)) this.activeSuggestionId = null;
    if (this.preview && expiredIds.has(this.preview.suggestionId)) this.preview = null;
    await this.coalesceSuggestions(reconciled.suggestions);
    for (const suggestion of reconciled.expired) {
      await this.log('stale_after_edit', {
        expected: suggestion.anchor.text,
        source: suggestion.source,
        category: suggestion.category
      }, suggestion.id);
    }
  }

  async resolveSuggestion(id: string, state: 'accepted' | 'rejected' | 'stale', eventType: LedgerEvent['type'], payload: Record<string, unknown> = {}): Promise<void> {
    const suggestion = this.suggestions.find((item) => item.id === id);
    if (!suggestion) return;
    this.suggestions = this.suggestions.map((item) => item.id === id ? { ...item, state } : item);
    if (this.activeSuggestionId === id) this.activeSuggestionId = null;
    await this.log(eventType, { category: suggestion.category, source: suggestion.source, ...payload }, id);
  }

  async supersedeSiblings(suggestion: Suggestion, selectedVariantId: string): Promise<void> {
    for (const variant of suggestion.variants) {
      if (variant.id !== selectedVariantId) await this.log('superseded_by', { winner: selectedVariantId, supersededVariant: variant.id, source: suggestion.source }, suggestion.id);
    }
  }

  reorder(id: string, direction: -1 | 1): void {
    const live = this.suggestions.filter((suggestion) => suggestion.state === 'pending').sort((a, b) => a.order - b.order);
    const index = live.findIndex((suggestion) => suggestion.id === id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= live.length) return;
    const first = live[index];
    const second = live[swap];
    this.suggestions = this.suggestions.map((suggestion) => suggestion.id === first.id ? { ...suggestion, order: second.order } : suggestion.id === second.id ? { ...suggestion, order: first.order } : suggestion);
  }

  async saveBrief(next: WritingBrief): Promise<void> {
    const previous = this.brief;
    this.brief = { ...next, version: previous.version + 1 };
    await this.facade.saveBrief(this.brief, this.sessionId, this.branchId);
    const stale = this.suggestions.filter((suggestion) => suggestion.state === 'pending' && suggestion.provenance.briefVersion < this.brief.version);
    this.suggestions = this.suggestions.map((suggestion) => stale.some((item) => item.id === suggestion.id) ? { ...suggestion, state: 'stale' } : suggestion);
    for (const suggestion of stale) await this.log('expired_on_brief_change', { fromVersion: previous.version, toVersion: this.brief.version }, suggestion.id);
    await this.refreshLedger();
  }

  async savePrompt(next: TaskPrompt): Promise<void> {
    const current = this.prompts.find((prompt) => prompt.id === next.id);
    const value = { ...next, version: (current?.version ?? 0) + 1 };
    this.prompts = this.prompts.map((prompt) => prompt.id === value.id ? value : prompt);
    await this.facade.savePrompt(value, this.sessionId, this.branchId);
    await this.refreshLedger();
  }

  async addBranch(branch: Branch, content = ''): Promise<void> {
    const document = await this.facade.createDocument({
      id: branch.id,
      projectId: this.projectId,
      title: branch.name,
      content,
      role: 'manuscript',
      parentId: branch.parentId ?? null,
      createdBy: this.sessionId,
      reason: 'Forked document'
    });
    this.documents = [...this.documents, document];
    this.refreshBranches();
    await this.log('branch_forked', { name: branch.name, parentId: branch.parentId, wordCount: branch.wordCount });
  }

  async exportMarkdown(markdown: string, title?: string): Promise<MarkdownExport> {
    const result = await this.facade.exportMarkdown({ markdown, title, sessionId: this.sessionId, branchId: this.branchId });
    await this.refreshLedger();
    return result;
  }

  async switchBranch(id: string): Promise<void> {
    if (id === this.branchId) return;
    const previous = this.branchId;
    this.branchId = id;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('margin-note:document', id);
      localStorage.setItem('margin-note:branch', id);
    }
    const data = await this.facade.suggestionHistory(id);
    this.ledger = data.events;
    this.costUsd = data.stats.costUsd;
    this.suggestions = restoreSuggestions(data.events);
    await this.log('branch_switched', { from: previous, to: id });
  }

  async switchProject(id: string): Promise<void> {
    if (id === this.projectId) return;
    const document = this.documents.find((item) => item.projectId === id);
    if (!document) throw new Error('Project has no document');
    this.projectId = id;
    if (typeof localStorage !== 'undefined') localStorage.setItem('margin-note:project', id);
    this.refreshBranches();
    await this.switchBranch(document.id);
  }

  async createProject(title: string): Promise<void> {
    const project = await this.facade.createProject(title);
    const document = await this.facade.createDocument({
      projectId: project.id,
      title: 'Main draft',
      role: 'manuscript',
      createdBy: this.sessionId,
      reason: 'Initial project document'
    });
    this.projects = [...this.projects, project];
    this.documents = [...this.documents, document];
    const persistent = await this.facade.persistentWorkspace();
    this.contextBuckets = persistent.contextBuckets;
    this.projectId = project.id;
    if (typeof localStorage !== 'undefined') localStorage.setItem('margin-note:project', project.id);
    this.refreshBranches();
    await this.switchBranch(document.id);
  }

  async createDocument(title: string): Promise<WorkspaceDocument> {
    const document = await this.facade.createDocument({
      projectId: this.projectId,
      title,
      role: 'manuscript',
      createdBy: this.sessionId
    });
    this.documents = [...this.documents, document];
    this.refreshBranches();
    return document;
  }

  async saveDocumentContent(content: string, reason = 'Editing session'): Promise<void> {
    const documentId = this.branchId;
    this.documentSave = this.documentSave.then(async () => {
      const document = await this.facade.saveDocument({ id: documentId, content, createdBy: this.sessionId, reason });
      this.documents = this.documents.map((item) => item.id === document.id ? document : item);
      this.refreshBranches();
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : 'Document save failed';
    });
    await this.documentSave;
  }

  async renameDocument(id: string, title: string): Promise<void> {
    const document = await this.facade.saveDocument({ id, title, createdBy: this.sessionId, reason: 'Renamed document' });
    this.documents = this.documents.map((item) => item.id === id ? document : item);
    this.refreshBranches();
  }

  async createContextBucket(input: { title: string; role?: string; scope: ContextScope; content?: string }): Promise<ContextBucket> {
    const bucket = await this.facade.createContextBucket({
      projectId: this.projectId,
      documentId: input.scope === 'document' ? this.branchId : null,
      scope: input.scope,
      title: input.title,
      role: input.role,
      content: input.content,
      createdBy: this.sessionId
    });
    this.contextBuckets = [...this.contextBuckets, bucket];
    return bucket;
  }

  async saveContextBucket(input: { id: string; title: string; role?: string; content: string }): Promise<ContextBucket> {
    const bucket = await this.facade.saveContextBucket({ ...input, createdBy: this.sessionId, reason: 'Edited context' });
    this.contextBuckets = this.contextBuckets.map((item) => item.id === bucket.id ? bucket : item);
    return bucket;
  }

  async deleteContextBucket(id: string): Promise<void> {
    await this.facade.deleteContextBucket(id);
    this.contextBuckets = this.contextBuckets.filter((bucket) => bucket.id !== id);
  }

  private refreshBranches(): void {
    this.branches = this.documents
      .filter((document) => document.projectId === this.projectId)
      .map((document) => ({
        id: document.id,
        name: document.title,
        parentId: document.parentId ?? undefined,
        createdAt: document.updatedAt,
        wordCount: document.content.trim() ? document.content.trim().split(/\s+/).length : 0,
        lastEdited: document.updatedAt
      }));
  }

  private async coalesceSuggestions(items: Suggestion[]): Promise<void> {
    const coalesced = coalesceDuplicateSuggestions(items);
    this.suggestions = coalesced.suggestions;
    for (const { duplicate, canonical } of coalesced.suppressed) {
      await this.log('duplicate_suppressed', {
        duplicateOf: canonical.id,
        source: duplicate.source,
        category: duplicate.category,
        anchor: [duplicate.anchor.from, duplicate.anchor.to]
      }, duplicate.id);
    }
  }
}

export const workspace = new WorkspaceState();
