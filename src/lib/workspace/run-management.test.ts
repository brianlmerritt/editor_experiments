import { describe, expect, it } from 'vitest';
import type { CraftRun } from '$lib/domain';
import { latestProviderReconfigurationIssue, summarizeProviderHealth } from './run-management';

function run(id: string, errors: CraftRun['errors'] = []): CraftRun {
  return {
    id, documentId: 'main', sourceRevision: 1, target: { mode: 'snapshot', targets: [] }, originalText: 'Text',
    promptId: 'review', promptVersion: 1, sourceStates: { provider: 'visible' }, state: errors.some((error) => !error.recovered) ? 'failed' : 'completed',
    proposalIds: [], errors, createdAt: '2026-08-25T00:00:00Z', completedAt: '2026-08-25T00:00:01Z'
  };
}

describe('provider health evidence', () => {
  it('surfaces the latest unresolved authentication failure for the current document', () => {
    const issue = latestProviderReconfigurationIssue([
      run('other', [{ source: 'provider', classification: 'authentication', recoveryAction: 'reconfigure', recovered: false, message: 'Old key' }]),
      { ...run('current', [{ source: 'provider', classification: 'authentication', recoveryAction: 'reconfigure', recovered: false, message: 'Unauthorized' }]), documentId: 'current-document' }
    ], 'current-document', ['provider']);

    expect(issue).toMatchObject({ runId: 'current', sourceId: 'provider', error: { message: 'Unauthorized' } });
  });

  it('clears an older authentication warning after the provider succeeds', () => {
    expect(latestProviderReconfigurationIssue([
      run('failed', [{ source: 'provider', classification: 'authentication', recoveryAction: 'reconfigure', recovered: false, message: 'Unauthorized' }]),
      run('succeeded')
    ], 'main', ['provider'])).toBeNull();
  });

  it('does not surface historical failures for a provider excluded from current use', () => {
    expect(latestProviderReconfigurationIssue([
      run('failed', [{ source: 'provider', classification: 'authentication', recoveryAction: 'reconfigure', recovered: false, message: 'Unauthorized' }])
    ], 'main', [])).toBeNull();
  });

  it('reports frequent successful recovery separately from failure', () => {
    const summary = summarizeProviderHealth([
      run('one'),
      run('two', [{ source: 'provider', kind: 'provider_output', classification: 'output_invalid', attempt: 1, recovered: true, outcome: 'recovered_by_retry', message: 'Corrected' }])
    ], 'provider');

    expect(summary).toMatchObject({ state: 'recovering_frequently', runCount: 2, recoveredCount: 1, failedCount: 0, firstPassRate: 0.5 });
    expect(summary.evidence).toContain('1/2 runs');
  });

  it('identifies configuration incompatibility without globally condemning the model', () => {
    const summary = summarizeProviderHealth([
      run('one', [{ source: 'provider', kind: 'provider_request', classification: 'authentication', recoveryAction: 'reconfigure', recovered: false, message: 'Unauthorized' }])
    ], 'provider');

    expect(summary.state).toBe('incompatible');
    expect(summary.failedCount).toBe(1);
  });
});
