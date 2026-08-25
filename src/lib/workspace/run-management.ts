import type { CraftRun, InputError } from '$lib/domain';

export type ProviderHealthState = 'untested' | 'healthy' | 'recovering_frequently' | 'poor_fit' | 'incompatible' | 'temporarily_unavailable';

export interface ProviderHealthSummary {
  sourceId: string;
  state: ProviderHealthState;
  runCount: number;
  attemptCount: number;
  recoveredCount: number;
  failedCount: number;
  firstPassRate: number | null;
  evidence: string;
}

export interface ProviderReconfigurationIssue {
  runId: string;
  sourceId: string;
  error: InputError;
}

export function latestProviderReconfigurationIssue(
  runs: CraftRun[],
  documentId: string,
  providerSourceIds: string[]
): ProviderReconfigurationIssue | null {
  const providerIds = new Set(providerSourceIds);
  const assessed = new Set<string>();
  for (const run of [...runs].reverse()) {
    if (run.documentId !== documentId) continue;
    const sources = new Set([
      ...Object.keys(run.sourceStates).filter((sourceId) => providerIds.has(sourceId) && run.sourceStates[sourceId] !== 'off'),
      ...run.errors.map((error) => error.source).filter((sourceId) => providerIds.has(sourceId))
    ]);
    for (const sourceId of sources) {
      if (assessed.has(sourceId)) continue;
      assessed.add(sourceId);
      const error = [...run.errors].reverse().find((item) =>
        item.source === sourceId
        && !item.recovered
        && (item.recoveryAction === 'reconfigure' || item.classification === 'authentication' || item.classification === 'configuration'));
      if (error) return { runId: run.id, sourceId, error };
    }
  }
  return null;
}

function sourceErrors(run: CraftRun, sourceId: string): InputError[] {
  return run.errors.filter((error) => error.source === sourceId);
}

export function summarizeProviderHealth(runs: CraftRun[], sourceId: string): ProviderHealthSummary {
  const relevant = runs
    .filter((run) => run.sourceStates[sourceId] && run.sourceStates[sourceId] !== 'off')
    .slice(-30);
  if (!relevant.length) return {
    sourceId, state: 'untested', runCount: 0, attemptCount: 0, recoveredCount: 0,
    failedCount: 0, firstPassRate: null, evidence: 'No recorded runs.'
  };
  const errors = relevant.flatMap((run) => sourceErrors(run, sourceId));
  const recoveredCount = errors.filter((error) => error.recovered).length;
  const failedRuns = relevant.filter((run) => sourceErrors(run, sourceId).some((error) => !error.recovered));
  const attemptCount = relevant.reduce((total, run) => {
    const attempts = sourceErrors(run, sourceId).map((error) => error.attempt ?? 1);
    return total + Math.max(1, ...attempts);
  }, 0);
  const firstPassRuns = relevant.filter((run) => run.state === 'completed' && sourceErrors(run, sourceId).length === 0);
  const incompatible = errors.some((error) => !error.recovered && ['authentication', 'configuration'].includes(error.classification ?? ''));
  const unavailable = errors.some((error) => !error.recovered && ['transient', 'rate_limited', 'provider_unavailable'].includes(error.classification ?? ''));
  const outputFailures = errors.filter((error) => !error.recovered && ['output_invalid', 'truncated'].includes(error.classification ?? '')).length;
  const recoveryRate = recoveredCount / Math.max(1, relevant.length);
  const state: ProviderHealthState = incompatible ? 'incompatible'
    : unavailable ? 'temporarily_unavailable'
      : outputFailures >= Math.max(2, Math.ceil(relevant.length / 2)) ? 'poor_fit'
        : recoveryRate >= 0.3 ? 'recovering_frequently'
          : 'healthy';
  const firstPassRate = firstPassRuns.length / relevant.length;
  const evidence = `${firstPassRuns.length}/${relevant.length} runs completed without recorded recovery; ${recoveredCount} recovered diagnostic${recoveredCount === 1 ? '' : 's'}; ${failedRuns.length} failed.`;
  return {
    sourceId,
    state,
    runCount: relevant.length,
    attemptCount,
    recoveredCount,
    failedCount: failedRuns.length,
    firstPassRate,
    evidence
  };
}
