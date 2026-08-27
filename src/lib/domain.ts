import { textTarget, type TargetSet } from '$lib/workspace/attachments';
import type { AIContextManifest, AIInteractionIntent, AIInteractionRequest } from '$lib/ai/contracts';
import type { AIResponseContract } from '$lib/ai/actions';

export const categories = ['pov', 'tense', 'canon', 'cadence', 'diction', 'distance'] as const;
export type Category = (typeof categories)[number];

export const suggestionStates = ['pending', 'accepted', 'rejected', 'cleared', 'superseded', 'stale', 'hidden', 'target_changed', 'target_removed'] as const;
export type SuggestionState = (typeof suggestionStates)[number];
export type SuggestionType = 'replacement' | 'insertion' | 'annotation';
export type InputAnchorStatus = 'exact' | 'request_scope' | 'unanchored';
export type SourceKind = 'local' | 'ai';
export type SourceState = 'visible' | 'invisible' | 'off';
export type WritingMode = 'drafting' | 'revising';

export type ProviderProtocol = 'openai_compatible' | 'anthropic';

export interface ProviderProfileInput {
  id?: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  model: string;
  key?: string;
}

export interface SourceAvailability {
  available: boolean;
  name?: string;
  model?: string;
  protocol?: ProviderProtocol;
  baseUrl?: string;
  sourceNumber?: number;
  configurable?: boolean;
  reason?: string;
  credentialHint?: string;
  persistence?: 'local_file' | 'environment';
}

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

export interface InputProposal {
  proposalId: string;
  source: string;
  sourceNumber: number;
  sourceKind: SourceKind;
  from: number;
  to: number;
  sourceText: string;
  anchorStatus?: InputAnchorStatus;
  type: SuggestionType;
  category: Category;
  comment: string;
  variants: string[];
  confidence: number;
  provenance: Provenance;
}

export interface ProviderUsage {
  source: string;
  model: string;
  protocol: ProviderProtocol;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  costUsd?: number;
  costBasis: 'provider_reported' | 'estimated' | 'unavailable';
}

export type InputErrorKind = 'provider_output' | 'provider_request' | 'configuration' | 'contract';
export type RecoveryClassification = 'output_nonconforming' | 'output_invalid' | 'truncated' | 'transient' | 'rate_limited' | 'authentication' | 'configuration' | 'provider_unavailable' | 'contract' | 'interrupted';
export type RecoveryAction = 'none' | 'extract_local' | 'repair_local' | 'correct_output' | 'retry_transient' | 'increase_budget' | 'reconfigure' | 'human';

export interface InputError {
  source: string;
  message: string;
  kind?: InputErrorKind;
  attempt?: number;
  recovered?: boolean;
  outcome?: 'normalized_locally' | 'repaired_locally' | 'recovered_by_retry' | 'retry_requested' | 'rejected';
  rawOutput?: string;
  classification?: RecoveryClassification;
  recoveryAction?: RecoveryAction;
  status?: number;
  maxAttempts?: number;
  model?: string;
  protocol?: ProviderProtocol;
  latencyMs?: number;
  localReplay?: boolean;
}

export interface Provenance {
  promptVersion: number;
  briefVersion: number;
  model?: string;
  temperature?: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  providerAttempts?: number;
  costUsd?: number;
  activityId?: string;
  runId?: string;
  actionId?: string;
  actionVersion?: number;
  contextManifestId?: string;
}

export interface InputEvent {
  type: 'target_changed' | 'target_removed' | 'reattached';
  revision: number;
  transactionId: string;
  previousTarget?: TargetSet;
  previousExcerpt?: string;
}

export interface InputRecord {
  id: string;
  kind: string;
  source: string;
  sourceNumber: number;
  sourceKind: SourceKind;
  target: TargetSet;
  scope?: TargetSet;
  behaviourId: string;
  events: InputEvent[];
  anchor: RelativeAnchor;
  anchorStatus?: InputAnchorStatus;
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

/** Compatibility name while the first POC UI still calls craft inputs suggestions. */
export type Suggestion = InputRecord;

export function normalizeInputRecord(input: Suggestion, nodeId: string): Suggestion {
  const legacy = input as Suggestion & Partial<Pick<Suggestion, 'kind' | 'target' | 'behaviourId' | 'events'>>;
  return {
    ...input,
    kind: legacy.kind ?? 'craft_suggestion',
    target: legacy.target ?? textTarget(nodeId, input.anchor.from, input.anchor.to, input.anchor.text),
    behaviourId: legacy.behaviourId ?? 'craft-input',
    events: legacy.events ?? []
  };
}

export const eventTypes = [
  'session_started', 'suggestion_generated', 'generated_hidden', 'suggestion_shown',
  'accepted_via_tick', 'accepted_via_keyboard', 'accepted_then_edited', 'rejected',
  'dismissed_via_drag', 'dismiss_undone', 'superseded_by', 'stale_on_arrival',
  'stale_after_edit', 'expired_on_brief_change', 'human_edit_session', 'mode_switch', 'paused', 'resumed',
  'source_state_changed', 'arrived_after_off', 'brief_updated', 'prompt_updated',
  'branch_forked', 'branch_switched', 'reverted', 'source_tooltip_hovered',
  'judgment_recorded', 'suggestions_requested', 'provider_usage_recorded', 'duplicate_suppressed', 'markdown_exported'
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
  responseContract?: AIResponseContract;
  optionCount?: number;
  includeExplanation?: boolean;
  inputCategory?: Category;
  maxOutputTokens?: number;
  temperature?: number;
  targetScope?: 'selection' | 'document';
  context?: Array<{
    title: string;
    role?: string;
    scope: 'project' | 'document';
    content: string;
    revision: number;
  }>;
}

export type RunState = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'discarded';

export interface CraftRun {
  id: string;
  batchId?: string;
  activityId?: string;
  scope?: 'document' | 'selection';
  documentId: string;
  sourceRevision: number;
  target: TargetSet;
  originalText: string;
  promptId: string;
  promptVersion: number;
  intent?: AIInteractionIntent;
  requestedContextManifest?: AIContextManifest;
  contextManifest?: AIContextManifest;
  permittedProposalKinds?: string[];
  request?: AIInteractionRequest;
  sourceStates: Record<string, SourceState>;
  state: RunState;
  proposalIds: string[];
  errors: InputError[];
  usage?: ProviderUsage[];
  createdAt: string;
  completedAt?: string;
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
  { id: 'fake-sentinel', number: 2, kind: 'ai' as const, label: 'Replay sentinel' }
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

const semanticStopWords = new Set([
  'about', 'after', 'already', 'also', 'and', 'any', 'are', 'before', 'been', 'being',
  'but', 'can', 'confirm', 'consider', 'could', 'does', 'for', 'from', 'had', 'has',
  'have', 'her', 'hers', 'him', 'his', 'into', 'its', 'may', 'might', 'more', 'not',
  'of', 'off', 'she', 'should', 'that', 'the', 'their', 'them', 'they', 'this', 'to',
  'was', 'were', 'what', 'whether', 'which', 'with', 'would', 'you', 'your'
]);
const positiveSignals = new Set(['appropriate', 'correct', 'effective', 'good', 'maintains', 'solid', 'strong', 'works']);
const criticalSignals = new Set(['check', 'consider', 'distant', 'flat', 'intrusion', 'issue', 'risk', 'unclear', 'weak']);

function semanticTokens(value: string): Set<string> {
  return new Set((value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((token) => token.length > 2 && !semanticStopWords.has(token)));
}

function stance(tokens: Set<string>): 'positive' | 'critical' | 'neutral' {
  const positive = [...tokens].some((token) => positiveSignals.has(token));
  const critical = [...tokens].some((token) => criticalSignals.has(token));
  if (positive && !critical) return 'positive';
  if (critical && !positive) return 'critical';
  return 'neutral';
}

/**
 * Validates a provider-selected source span without guessing. Exact text is required,
 * leading/trailing whitespace is rejected, and word-like text cannot start or end in
 * the middle of another word.
 */
export function isExactTextSpan(passage: string, from: number, to: number, sourceText: string): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > passage.length) return false;
  if (!sourceText || sourceText.trim() !== sourceText || passage.slice(from, to) !== sourceText) return false;
  const wordCharacter = (value: string | undefined) => Boolean(value && /[\p{L}\p{N}_]/u.test(value));
  if (from > 0 && wordCharacter(passage[from - 1]) && wordCharacter(sourceText[0])) return false;
  if (to < passage.length && wordCharacter(sourceText.at(-1)) && wordCharacter(passage[to])) return false;
  return true;
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

export interface SuppressedDuplicate {
  duplicate: Suggestion;
  canonical: Suggestion;
  reason: 'exact' | 'semantic';
}

/** Conservative semantic equivalence for repeated AI annotations at the same locus. */
export function suggestionsDescribeSameIssue(left: Suggestion, right: Suggestion): boolean {
  if (left.sourceKind !== 'ai' || right.sourceKind !== 'ai') return false;
  if (left.source !== right.source || left.category !== right.category) return false;
  if (left.type !== 'annotation' || right.type !== 'annotation') return false;
  const overlap = Math.max(0, Math.min(left.anchor.to, right.anchor.to) - Math.max(left.anchor.from, right.anchor.from));
  const shorterRange = Math.min(left.anchor.to - left.anchor.from, right.anchor.to - right.anchor.from);
  if (shorterRange <= 0 || overlap / shorterRange < 0.6) return false;
  const leftTokens = semanticTokens(left.payload.comment);
  const rightTokens = semanticTokens(right.payload.comment);
  if (Math.min(leftTokens.size, rightTokens.size) < 4) return false;
  const leftStance = stance(leftTokens);
  const rightStance = stance(rightTokens);
  if ((leftStance === 'positive' && rightStance === 'critical') || (leftStance === 'critical' && rightStance === 'positive')) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.min(leftTokens.size, rightTokens.size) >= 0.25;
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
    const mappedExactIndex = canonicalByFingerprint.get(fingerprint);
    const exactIndex = mappedExactIndex !== undefined
      && (isLive(suggestions[mappedExactIndex].state) || isResolved(suggestions[mappedExactIndex].state))
      ? mappedExactIndex
      : undefined;
    const semanticIndex = exactIndex === undefined
      ? suggestions.findIndex((candidate, candidateIndex) => candidateIndex < index
        && (isLive(candidate.state) || isResolved(candidate.state))
        && suggestionsDescribeSameIssue(candidate, current))
      : -1;
    const canonicalIndex = exactIndex ?? (semanticIndex >= 0 ? semanticIndex : undefined);
    if (canonicalIndex === undefined) {
      canonicalByFingerprint.set(fingerprint, index);
      continue;
    }

    const canonical = suggestions[canonicalIndex];
    const reason = exactIndex === undefined ? 'semantic' as const : 'exact' as const;
    if (isResolved(current.state) && isLive(canonical.state)) {
      suggestions[canonicalIndex] = { ...canonical, state: 'superseded' };
      suppressed.push({ duplicate: canonical, canonical: current, reason });
      canonicalByFingerprint.set(fingerprint, index);
    } else if (isLive(current.state)) {
      suggestions[index] = { ...current, state: 'superseded' };
      suppressed.push({ duplicate: current, canonical, reason });
    }
  }

  return { suggestions, suppressed };
}
