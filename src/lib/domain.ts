export const categories = ['pov', 'tense', 'canon', 'cadence', 'diction', 'distance'] as const;
export type Category = (typeof categories)[number];

export const suggestionStates = ['pending', 'accepted', 'rejected', 'superseded', 'stale', 'hidden'] as const;
export type SuggestionState = (typeof suggestionStates)[number];
export type SuggestionType = 'replacement' | 'insertion' | 'annotation';
export type SourceKind = 'local' | 'ai';
export type SourceState = 'visible' | 'invisible' | 'off';
export type WritingMode = 'drafting' | 'revising';

export interface RelativeAnchor {
  from: number;
  to: number;
  text: string;
  start?: Record<string, unknown>;
  end?: Record<string, unknown>;
}

export interface SuggestionVariant {
  id: string;
  text: string;
  source?: string;
  confidence?: number;
}

export interface Provenance {
  promptVersion: number;
  briefVersion: number;
  model?: string;
  temperature?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface Suggestion {
  id: string;
  source: string;
  sourceNumber: number;
  sourceKind: SourceKind;
  anchor: RelativeAnchor;
  type: SuggestionType;
  payload: { text?: string; comment: string };
  category: Category;
  confidence: number;
  variants: SuggestionVariant[];
  state: SuggestionState;
  order: number;
  createdAt: string;
  provenance: Provenance;
}

export const eventTypes = [
  'session_started', 'suggestion_generated', 'generated_hidden', 'suggestion_shown',
  'accepted_via_tick', 'accepted_via_keyboard', 'accepted_then_edited', 'rejected',
  'dismissed_via_drag', 'dismiss_undone', 'superseded_by', 'stale_on_arrival',
  'stale_after_edit', 'expired_on_brief_change', 'human_edit_session', 'mode_switch', 'paused', 'resumed',
  'source_state_changed', 'arrived_after_off', 'brief_updated', 'prompt_updated',
  'branch_forked', 'branch_switched', 'reverted', 'source_tooltip_hovered',
  'judgment_recorded', 'suggestions_requested', 'duplicate_suppressed', 'markdown_exported'
] as const;
export type EventType = (typeof eventTypes)[number];

export interface LedgerEvent<T = Record<string, unknown>> {
  id?: number;
  timestamp?: string;
  type: EventType;
  sessionId: string;
  branchId: string;
  suggestionId?: string;
  payload: T;
}

export interface WritingBrief {
  version: number;
  form: 'fiction' | 'non-fiction';
  pov: string;
  tense: string;
  distance: string;
  canon: string;
}

export interface TaskPrompt {
  id: string;
  name: string;
  version: number;
  instruction: string;
}

export interface Branch {
  id: string;
  name: string;
  parentId?: string;
  createdAt: string;
  wordCount: number;
  lastEdited: string;
}

export interface GenerationRequest {
  text: string;
  from: number;
  to: number;
  branchId: string;
  sessionId: string;
  brief: WritingBrief;
  prompt: TaskPrompt;
  sourceStates: Record<string, SourceState>;
  mode: WritingMode;
}

export interface JudgmentPair {
  id: string;
  suggestionId: string;
  category: Category;
  brief: WritingBrief | null;
  left: { id: string; text: string };
  right: { id: string; text: string };
}

export const categoryMeta: Record<Category, { label: string; icon: string; intent: string }> = {
  pov: { label: 'Point of view', icon: '◉', intent: 'correctness' },
  tense: { label: 'Tense', icon: '↻', intent: 'correctness' },
  canon: { label: 'Canon', icon: '⌘', intent: 'correctness' },
  cadence: { label: 'Cadence', icon: '≋', intent: 'enhancement' },
  diction: { label: 'Diction', icon: 'Aa', intent: 'enhancement' },
  distance: { label: 'Distance', icon: '↔', intent: 'enhancement' }
};

export const sourceCatalog = [
  { id: 'local-craft', number: 1, kind: 'local' as const, label: 'Local craft checks' },
  { id: 'fake-sentinel', number: 2, kind: 'ai' as const, label: 'Replay sentinel' },
  { id: 'openrouter', number: 3, kind: 'ai' as const, label: 'OpenRouter' },
  { id: 'ollama', number: 4, kind: 'ai' as const, label: 'Ollama' }
];

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function normalizedSuggestionText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/** Stable identity for the substance of a suggestion, excluding generated IDs and telemetry. */
export function suggestionFingerprint(suggestion: Suggestion): string {
  const variantTexts = suggestion.variants.map((variant) => normalizedSuggestionText(variant.text)).sort();
  return JSON.stringify([
    suggestion.source,
    suggestion.category,
    suggestion.type,
    suggestion.anchor.from,
    suggestion.anchor.to,
    normalizedSuggestionText(suggestion.anchor.text),
    normalizedSuggestionText(suggestion.payload.comment),
    normalizedSuggestionText(suggestion.payload.text),
    variantTexts
  ]);
}

export function reconcileSuggestionAnchors(
  items: Suggestion[],
  resolve: (suggestion: Suggestion) => { from: number; to: number; text: string } | null
): { suggestions: Suggestion[]; expired: Suggestion[] } {
  const expired: Suggestion[] = [];
  const suggestions = items.map((suggestion) => {
    if (suggestion.state !== 'pending' && suggestion.state !== 'hidden') return suggestion;
    const current = resolve(suggestion);
    if (!current) {
      expired.push(suggestion);
      return { ...suggestion, state: 'stale' as const };
    }
    const rebased = { ...suggestion, anchor: { ...suggestion.anchor, from: current.from, to: current.to } };
    if (current.text === suggestion.anchor.text) return rebased;
    expired.push(suggestion);
    return { ...rebased, state: 'stale' as const };
  });
  return { suggestions, expired };
}

export interface SuppressedDuplicate {
  duplicate: Suggestion;
  canonical: Suggestion;
}

/**
 * Keeps one live suggestion for each fingerprint. Resolved decisions win over a
 * repeated pending suggestion so a new pass does not nag the writer again.
 */
export function coalesceDuplicateSuggestions(items: Suggestion[]): { suggestions: Suggestion[]; suppressed: SuppressedDuplicate[] } {
  const suggestions = items.map((suggestion) => ({ ...suggestion }));
  const canonicalByFingerprint = new Map<string, number>();
  const suppressed: SuppressedDuplicate[] = [];
  const isLive = (state: SuggestionState) => state === 'pending' || state === 'hidden';
  const isResolved = (state: SuggestionState) => state === 'accepted' || state === 'rejected';

  for (let index = 0; index < suggestions.length; index += 1) {
    const current = suggestions[index];
    if (!isLive(current.state) && !isResolved(current.state)) continue;
    const fingerprint = suggestionFingerprint(current);
    const canonicalIndex = canonicalByFingerprint.get(fingerprint);
    if (canonicalIndex === undefined) {
      canonicalByFingerprint.set(fingerprint, index);
      continue;
    }

    const canonical = suggestions[canonicalIndex];
    if (isResolved(current.state) && isLive(canonical.state)) {
      suggestions[canonicalIndex] = { ...canonical, state: 'superseded' };
      suppressed.push({ duplicate: canonical, canonical: current });
      canonicalByFingerprint.set(fingerprint, index);
    } else if (isLive(current.state)) {
      suggestions[index] = { ...current, state: 'superseded' };
      suppressed.push({ duplicate: current, canonical });
    }
  }

  return { suggestions, suppressed };
}
