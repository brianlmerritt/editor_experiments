import { suggestionFingerprint, type Category, type CraftRun, type Suggestion } from '$lib/domain';

export type CraftActivityState = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'discarded';

export interface CraftActivitySummary {
  id: string;
  scope: 'document' | 'selection';
  state: CraftActivityState;
  requestCount: number;
  runningCount: number;
  proposalCount: number;
  errorCount: number;
  createdAt: string;
  completedAt?: string;
  firstError?: string;
}

export interface InputDisplaySummary {
  displayed: Suggestion[];
  pendingCount: number;
  hiddenByFilters: number;
  duplicatesCombined: number;
  beyondLimit: number;
  displayableCount: number;
}

export function selectDisplayedInputs(
  inputs: Suggestion[],
  categoryVisibility: Record<Category, boolean>,
  sourceVisibility: Record<string, boolean>,
  limit: number
): InputDisplaySummary {
  const pending = inputs.filter((input) => input.state === 'pending');
  const filtered = pending
    .filter((input) => categoryVisibility[input.category])
    .filter((input) => sourceVisibility[input.source] !== false);
  const seen = new Set<string>();
  const displayable = filtered.filter((input) => {
    const fingerprint = suggestionFingerprint(input);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  }).sort((left, right) => left.order - right.order);
  const displayed = displayable.slice(0, Math.max(1, limit));
  return {
    displayed,
    pendingCount: pending.length,
    hiddenByFilters: pending.length - filtered.length,
    duplicatesCombined: filtered.length - displayable.length,
    beyondLimit: displayable.length - displayed.length,
    displayableCount: displayable.length
  };
}

export function summarizeLatestCraftActivity(runs: CraftRun[], documentId: string): CraftActivitySummary | null {
  const relevant = runs.filter((run) => run.documentId === documentId);
  const latest = relevant.at(-1);
  if (!latest) return null;
  const id = latest.batchId ?? latest.id;
  const batch = relevant.filter((run) => (run.batchId ?? run.id) === id);
  const runningCount = batch.filter((run) => run.state === 'running' || run.state === 'queued').length;
  const completedCount = batch.filter((run) => run.state === 'completed').length;
  const partialCount = batch.filter((run) => run.state === 'partial').length;
  const failedCount = batch.filter((run) => run.state === 'failed').length;
  const discardedCount = batch.filter((run) => run.state === 'discarded').length;
  const cancelledCount = batch.filter((run) => run.state === 'cancelled').length;
  const unrecoveredErrors = batch.flatMap((run) => run.errors).filter((error) => !error.recovered);
  let state: CraftActivityState;
  if (runningCount) state = 'running';
  else if (partialCount || completedCount && (failedCount || discardedCount || cancelledCount)) state = 'partial';
  else if (failedCount) state = 'failed';
  else if (discardedCount) state = 'discarded';
  else if (cancelledCount) state = 'cancelled';
  else state = 'completed';
  return {
    id,
    scope: latest.scope ?? 'document',
    state,
    requestCount: batch.length,
    runningCount,
    proposalCount: batch.reduce((total, run) => total + run.proposalIds.length, 0),
    errorCount: unrecoveredErrors.length,
    createdAt: batch[0]?.createdAt ?? latest.createdAt,
    completedAt: batch.every((run) => run.completedAt) ? batch.map((run) => run.completedAt!).sort().at(-1) : undefined,
    firstError: unrecoveredErrors[0]?.message
  };
}
