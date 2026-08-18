import { categories, sourceCatalog, makeId, coalesceDuplicateSuggestions, normalizeInputRecord, reconcileSuggestionAnchors as reconcileAnchors, type Branch, type Category, type GenerationRequest, type LedgerEvent, type SourceState, type Suggestion, type SuggestionState, type TaskPrompt, type WritingBrief, type WritingMode } from '$lib/domain';
import { restoreSuggestions } from '$lib/suggestion-history';
import { workspaceFacade, type MarkdownExport, type WorkspaceFacade } from '$lib/workspace/facade';
import type { ContextBucket, ContextScope, WorkspaceDocument, WorkspaceProject } from '$lib/workspace/model';
import { defaultAttachmentBehaviours, sameTarget, selectionHasStrikethrough, textTarget, type AttachmentBehaviour, type FormatAttachment, type TargetSet } from '$lib/workspace/attachments';
import { applyAttachmentChanges } from '$lib/workspace/mutations';
import { cloneHistorySnapshot, type EditorDocumentSnapshot, type EditorTransactionDetail, type WorkspaceHistoryEntry, type WorkspaceHistorySnapshot } from '$lib/workspace/transactions';
import { settings, type SettingsStore } from '$lib/state/settings.svelte';

const defaultBrief: WritingBrief = { version: 1, form: 'fiction', pov: 'close third person', tense: 'past', distance: 'close, embodied, minimal narrator intrusion', canon: '' };
const defaultPrompt: TaskPrompt = { id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Flag craft issues precisely.' };
const attachmentBehaviourVersion = 2;

export class WorkspaceState {
  sessionId = $state('session_pending');
  projectId = $state('project_default');
  branchId = $state('main');
  // Kept in provider requests for backward compatibility; the UI is one continuous workflow.
  mode = $state<WritingMode>('revising');
  paused = $state(false);
  surface = $state<'docked' | 'tray'>('docked');
  activeSuggestionId = $state<string | null>(null);
  preview = $state<{ suggestionId: string; text: string } | null>(null);
  inputs = $state<Suggestion[]>([]);
  formats = $state<FormatAttachment[]>([]);
  behaviours = $state<Record<string, AttachmentBehaviour>>({ ...defaultAttachmentBehaviours });
  workspaceRevision = $state(0);
  documentSnapshot = $state<EditorDocumentSnapshot | null>(null);
  undoStack = $state<WorkspaceHistoryEntry[]>([]);
  redoStack = $state<WorkspaceHistoryEntry[]>([]);
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

  constructor(
    private readonly facade: WorkspaceFacade = workspaceFacade,
    private readonly settingsState: SettingsStore = settings
  ) {}

  get suggestions(): Suggestion[] { return this.inputs; }
  set suggestions(value: Suggestion[]) { this.inputs = value; }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  get pendingCount(): number {
    return this.suggestions.filter((suggestion) => suggestion.state === 'pending' || suggestion.state === 'hidden').length;
  }

  get visibleSuggestions(): Suggestion[] {
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
      this.settingsState.load(loaded.sourceAvailability);
      for (const source of sourceCatalog) if (!this.settingsState.sourceAvailable(source.id)) this.sourceStates[source.id] = 'off';
      this.loadDocumentDomain(this.currentDocument, loaded.events);
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

  setEditorReady(snapshot: EditorDocumentSnapshot): void {
    this.documentSnapshot = cloneHistorySnapshot({
      document: snapshot,
      inputs: [],
      formats: [],
      revision: this.workspaceRevision
    }).document;
  }

  recordEditorTransaction(detail: EditorTransactionDetail): void {
    this.documentSnapshot = detail.after;
    if (detail.origin.kind === 'workspace_history') return;

    const transactionId = makeId('transaction');
    const before = this.historySnapshot(detail.before);
    const transformed = applyAttachmentChanges({
      inputs: this.inputs,
      formats: this.formats,
      behaviours: this.behaviours,
      changes: detail.changes,
      revision: this.workspaceRevision,
      transactionId,
      acceptedInputId: detail.origin.kind === 'input_acceptance' ? detail.origin.inputId : undefined
    });
    this.inputs = transformed.inputs;
    this.formats = transformed.formats;
    this.workspaceRevision += 1;
    const after = this.historySnapshot(detail.after);
    const acceptance = detail.origin.kind === 'input_acceptance';
    this.pushHistory({
      id: transactionId,
      source: acceptance ? 'ai' : 'human',
      label: acceptance ? 'Accept input revision' : 'Edit text',
      before,
      after,
      createdAt: Date.now(),
      group: acceptance ? undefined : 'typing'
    });
  }

  undoWorkspace(): EditorDocumentSnapshot | null {
    const entry = this.undoStack.at(-1);
    if (!entry) return null;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, entry];
    this.restoreHistoryState(entry.before);
    void this.persistDomainState('Undo workspace change');
    return entry.before.document;
  }

  redoWorkspace(): EditorDocumentSnapshot | null {
    const entry = this.redoStack.at(-1);
    if (!entry) return null;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, entry];
    this.restoreHistoryState(entry.after);
    void this.persistDomainState('Redo workspace change');
    return entry.after.document;
  }

  private setStrikethrough(target: TargetSet, value: boolean, label: string): boolean {
    if (!this.documentSnapshot) return false;
    const before = this.historySnapshot(this.documentSnapshot);
    const matching = this.formats.filter((format) => format.properties.strikethrough !== undefined && sameTarget(format.target, target));
    const existing = matching
      .sort((left, right) => right.priority - left.priority || right.createdAtRevision - left.createdAtRevision)[0];
    const priority = Math.max(10, ...this.formats.map((format) => format.priority + 1));
    if (existing) {
      this.formats = [
        ...this.formats.filter((format) => !matching.some((item) => item.id === format.id)),
        {
          ...existing,
          properties: { ...existing.properties, strikethrough: value },
          priority,
          createdAtRevision: this.workspaceRevision
        }
      ];
    } else {
      this.formats = [...this.formats, {
        id: makeId('format'),
        target,
        properties: { strikethrough: value },
        behaviourId: 'format-default',
        priority,
        createdAtRevision: this.workspaceRevision
      }];
    }
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({
      id: makeId('transaction'),
      source: 'format',
      label,
      before,
      after,
      createdAt: Date.now()
    });
    void this.persistDomainState(label);
    return true;
  }

  toggleSelectionStrikethrough(from: number, to: number, selectedText: string): boolean {
    if (from >= to) return false;
    return this.setStrikethrough(
      textTarget(this.branchId, from, to, selectedText),
      !this.selectionHasStrikethrough(from, to),
      'Toggle selection strikethrough'
    );
  }

  toggleWorkStrikethrough(): boolean {
    const target: TargetSet = {
      mode: 'live',
      targets: [{ type: 'node', nodeId: this.branchId, includeDescendants: true }]
    };
    return this.setStrikethrough(target, !this.workHasStrikethrough, 'Toggle work strikethrough');
  }

  selectionHasStrikethrough(from: number, to: number): boolean {
    return from < to && selectionHasStrikethrough(this.formats, this.branchId, from, to);
  }

  get workHasStrikethrough(): boolean {
    return selectionHasStrikethrough(this.formats, this.branchId, 0, Number.MAX_SAFE_INTEGER);
  }

  async setInputState(id: string, state: SuggestionState, label: string): Promise<void> {
    const record = this.inputs.find((item) => item.id === id);
    if (!record || record.state === state || !this.documentSnapshot) return;
    const before = this.historySnapshot(this.documentSnapshot);
    this.inputs = this.inputs.map((item) => item.id === id ? { ...item, state } : item);
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({ id: makeId('transaction'), source: 'input', label, before, after, createdAt: Date.now() });
    await this.persistDomainState(label);
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
    const availability = this.settingsState.availability(sourceId);
    if (!this.sourceAvailable(sourceId)) {
      this.sourceStates[sourceId] = 'off';
      this.notice = availability.reason ?? `${sourceId} is not configured.`;
      return;
    }
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

  enableConfiguredSource(sourceId: string): void {
    if (!this.settingsState.sourceAvailable(sourceId)) return;
    this.sourceStates[sourceId] = 'visible';
  }

  sourceAvailable(sourceId: string): boolean {
    return this.settingsState.sourceAvailable(sourceId);
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
    await this.setInputState(id, state, `Set input ${state}`);
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
    this.loadDocumentDomain(this.currentDocument, data.events);
    this.documentSnapshot = null;
    this.undoStack = [];
    this.redoStack = [];
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
      const document = await this.facade.saveDocument({
        id: documentId,
        content,
        extensions: this.domainExtensions(),
        createdBy: this.sessionId,
        reason
      });
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

  private historySnapshot(document: EditorDocumentSnapshot): WorkspaceHistorySnapshot {
    return cloneHistorySnapshot({
      document,
      inputs: this.inputs,
      formats: this.formats,
      revision: this.workspaceRevision
    });
  }

  private pushHistory(entry: WorkspaceHistoryEntry): void {
    const previous = this.undoStack.at(-1);
    if (entry.group === 'typing' && previous?.group === 'typing' && entry.createdAt - previous.createdAt <= 1200) {
      this.undoStack = [...this.undoStack.slice(0, -1), {
        ...previous,
        after: entry.after,
        createdAt: entry.createdAt
      }];
    } else this.undoStack = [...this.undoStack, entry].slice(-100);
    this.redoStack = [];
  }

  private restoreHistoryState(snapshot: WorkspaceHistorySnapshot): void {
    const restored = cloneHistorySnapshot(snapshot);
    this.inputs = restored.inputs;
    this.formats = restored.formats;
    this.workspaceRevision = restored.revision;
    this.documentSnapshot = restored.document;
    this.activeSuggestionId = null;
    this.preview = null;
  }

  private loadDocumentDomain(document: WorkspaceDocument | null, events: Required<LedgerEvent>[]): void {
    const stored = document?.extensions.margin_note;
    const value = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as Record<string, unknown>
      : null;
    const persistedInputs = Array.isArray(value?.inputs) ? value.inputs as Suggestion[] : null;
    this.inputs = (persistedInputs ?? restoreSuggestions(events)).map((input) => normalizeInputRecord(input, document?.id ?? this.branchId));
    this.formats = Array.isArray(value?.formats) ? value.formats as FormatAttachment[] : [];
    const storedBehaviours = value?.behaviours && typeof value.behaviours === 'object' && !Array.isArray(value.behaviours)
      ? value.behaviours as Record<string, AttachmentBehaviour>
      : {};
    this.behaviours = { ...defaultAttachmentBehaviours, ...storedBehaviours };
    if (typeof value?.behaviourVersion !== 'number' || value.behaviourVersion < attachmentBehaviourVersion) {
      this.behaviours['format-default'] = { ...defaultAttachmentBehaviours['format-default'] };
    }
    this.workspaceRevision = typeof value?.revision === 'number' ? value.revision : document?.revision ?? 0;
  }

  private domainExtensions(): WorkspaceDocument['extensions'] {
    const current = this.currentDocument?.extensions ?? {};
    return {
      ...current,
      margin_note: JSON.parse(JSON.stringify({
        revision: this.workspaceRevision,
        behaviourVersion: attachmentBehaviourVersion,
        inputs: this.inputs,
        formats: this.formats,
        behaviours: this.behaviours
      }))
    } as WorkspaceDocument['extensions'];
  }

  private async persistDomainState(reason: string): Promise<void> {
    const documentId = this.branchId;
    this.documentSave = this.documentSave.then(async () => {
      const document = await this.facade.saveDocument({
        id: documentId,
        extensions: this.domainExtensions(),
        createdBy: this.sessionId,
        reason
      });
      this.documents = this.documents.map((item) => item.id === document.id ? document : item);
      this.refreshBranches();
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : 'Workspace state save failed';
    });
    await this.documentSave;
  }

  private async coalesceSuggestions(items: Suggestion[]): Promise<void> {
    const coalesced = coalesceDuplicateSuggestions(items.map((item) => normalizeInputRecord(item, this.branchId)));
    this.suggestions = coalesced.suggestions;
    for (const { duplicate, canonical } of coalesced.suppressed) {
      await this.log('duplicate_suppressed', {
        duplicateOf: canonical.id,
        source: duplicate.source,
        category: duplicate.category,
        anchor: [duplicate.anchor.from, duplicate.anchor.to]
      }, duplicate.id);
    }
    await this.persistDomainState('Update inputs');
  }
}

export const workspace = new WorkspaceState();
