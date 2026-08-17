import { categories, sourceCatalog, makeId, coalesceDuplicateSuggestions, reconcileSuggestionAnchors as reconcileAnchors, type Branch, type Category, type GenerationRequest, type LedgerEvent, type SourceState, type Suggestion, type TaskPrompt, type WritingBrief, type WritingMode } from '$lib/domain';
import { workspaceFacade, type MarkdownExport, type WorkspaceFacade } from '$lib/workspace/facade';

const defaultBrief: WritingBrief = { version: 1, form: 'fiction', pov: 'close third person', tense: 'past', distance: 'close, embodied, minimal narrator intrusion', canon: '' };
const defaultPrompt: TaskPrompt = { id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Flag craft issues precisely.' };

export class WorkspaceState {
  sessionId = $state('session_pending');
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

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage !== 'undefined') {
      this.sessionId = localStorage.getItem('margin-note:session') ?? makeId('session');
      localStorage.setItem('margin-note:session', this.sessionId);
      this.branchId = localStorage.getItem('margin-note:branch') ?? 'main';
    }
    try {
      const loaded = await this.facade.load();
      this.brief = loaded.brief;
      this.prompts = loaded.prompts;
      this.branches = loaded.branches;
      this.ledger = loaded.events;
      this.costUsd = loaded.stats.costUsd;
      if (!this.branches.some((branch) => branch.id === this.branchId)) this.branchId = 'main';
      await this.log('session_started', { userAgent: navigator.userAgent, resumedSession: this.ledger.some((event) => event.sessionId === this.sessionId) });
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
      const request: GenerationRequest = { ...input, sessionId: this.sessionId, branchId: this.branchId, brief: this.brief, sourceStates: { ...this.sourceStates }, mode: this.mode };
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

  async addBranch(branch: Branch): Promise<void> {
    this.branches = await this.facade.createBranch(branch, this.sessionId);
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
    localStorage.setItem('margin-note:branch', id);
    this.suggestions = [];
    await this.log('branch_switched', { from: previous, to: id });
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
