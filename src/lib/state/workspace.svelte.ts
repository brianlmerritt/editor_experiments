import { categories, sourceCatalog, makeId, type Branch, type Category, type GenerationRequest, type LedgerEvent, type SourceState, type Suggestion, type TaskPrompt, type WritingBrief, type WritingMode } from '$lib/domain';

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
    if (typeof localStorage !== 'undefined') {
      this.sessionId = localStorage.getItem('margin-note:session') ?? makeId('session');
      localStorage.setItem('margin-note:session', this.sessionId);
      this.branchId = localStorage.getItem('margin-note:branch') ?? 'main';
    }
    try {
      const [settings, branches, events] = await Promise.all([
        fetch('/api/settings').then((response) => response.json()),
        fetch('/api/branches').then((response) => response.json()),
        fetch('/api/events?limit=45').then((response) => response.json())
      ]);
      this.brief = settings.brief;
      this.prompts = settings.prompts;
      this.branches = branches.branches;
      this.ledger = events.events;
      this.costUsd = events.stats.costUsd;
      if (!this.branches.some((branch) => branch.id === this.branchId)) this.branchId = 'main';
      await this.log('session_started', { userAgent: navigator.userAgent, resumedSession: this.ledger.some((event) => event.sessionId === this.sessionId) });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Could not initialize workspace';
    } finally {
      this.loading = false;
    }
  }

  async log(type: LedgerEvent['type'], payload: Record<string, unknown>, suggestionId?: string): Promise<void> {
    const event: LedgerEvent = { type, sessionId: this.sessionId, branchId: this.branchId, suggestionId, payload };
    try {
      const response = await fetch('/api/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) });
      if (!response.ok) throw new Error(`Ledger write failed (${response.status})`);
      const data = await response.json();
      this.ledger = [data.event, ...this.ledger].slice(0, 60);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Ledger write failed';
    }
  }

  async refreshLedger(): Promise<void> {
    const data = await fetch('/api/events?limit=45').then((response) => response.json());
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
      const response = await fetch('/api/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      if (!response.ok) throw new Error(`Suggestion request failed (${response.status})`);
      const data = await response.json() as { suggestions: Suggestion[]; errors: { source: string; message: string }[] };
      if (data.errors.length) this.notice = data.errors.map((item) => `${item.source}: ${item.message}`).join(' · ');
      this.suggestions = [...this.suggestions.filter((suggestion) => suggestion.state !== 'stale'), ...data.suggestions];
      await this.refreshLedger();
      return data.suggestions;
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
    const response = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'brief', value: this.brief, sessionId: this.sessionId, branchId: this.branchId }) });
    if (!response.ok) throw new Error('Could not save brief');
    const stale = this.suggestions.filter((suggestion) => suggestion.state === 'pending' && suggestion.provenance.briefVersion < this.brief.version);
    this.suggestions = this.suggestions.map((suggestion) => stale.some((item) => item.id === suggestion.id) ? { ...suggestion, state: 'stale' } : suggestion);
    for (const suggestion of stale) await this.log('expired_on_brief_change', { fromVersion: previous.version, toVersion: this.brief.version }, suggestion.id);
    await this.refreshLedger();
  }

  async savePrompt(next: TaskPrompt): Promise<void> {
    const current = this.prompts.find((prompt) => prompt.id === next.id);
    const value = { ...next, version: (current?.version ?? 0) + 1 };
    this.prompts = this.prompts.map((prompt) => prompt.id === value.id ? value : prompt);
    await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'prompt', value, sessionId: this.sessionId, branchId: this.branchId }) });
    await this.refreshLedger();
  }

  async addBranch(branch: Branch): Promise<void> {
    const response = await fetch('/api/branches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...branch, sessionId: this.sessionId }) });
    const data = await response.json();
    this.branches = data.branches;
  }

  async switchBranch(id: string): Promise<void> {
    if (id === this.branchId) return;
    const previous = this.branchId;
    this.branchId = id;
    localStorage.setItem('margin-note:branch', id);
    this.suggestions = [];
    await this.log('branch_switched', { from: previous, to: id });
  }
}

export const workspace = new WorkspaceState();
