import { describe, expect, it } from 'vitest';
import type { CraftRun } from '$lib/domain';
import { summarizeLatestCraftActivity } from './input-panel';

function run(id: string, state: CraftRun['state'], overrides: Partial<CraftRun> = {}): CraftRun {
  return {
    id,
    batchId: 'batch-1',
    scope: 'document',
    documentId: 'main',
    sourceRevision: 1,
    target: { mode: 'snapshot', targets: [] },
    originalText: 'Text',
    promptId: 'sentinel',
    promptVersion: 1,
    sourceStates: {},
    state,
    proposalIds: [],
    errors: [],
    createdAt: '2026-08-24T10:00:00Z',
    ...overrides
  };
}

describe('Inputs panel craft activity', () => {
  it('summarizes a document review batch rather than presenting each paragraph request as a run', () => {
    const summary = summarizeLatestCraftActivity([
      run('run-1', 'completed', { proposalIds: ['one'] }),
      run('run-2', 'running')
    ], 'main');

    expect(summary).toMatchObject({ id: 'batch-1', state: 'running', requestCount: 2, runningCount: 1, proposalCount: 1 });
  });

  it('reports partial completion and only unrecovered errors', () => {
    const summary = summarizeLatestCraftActivity([
      run('run-1', 'completed', { proposalIds: ['one'], completedAt: '2026-08-24T10:00:02Z' }),
      run('run-2', 'failed', {
        errors: [
          { source: 'openrouter', message: 'Recovered JSON', recovered: true },
          { source: 'openrouter', message: 'Provider unavailable' }
        ],
        completedAt: '2026-08-24T10:00:03Z'
      })
    ], 'main');

    expect(summary).toMatchObject({ state: 'partial', errorCount: 1, firstError: 'Provider unavailable', completedAt: '2026-08-24T10:00:03Z' });
  });

  it('ignores activity belonging to another document', () => {
    expect(summarizeLatestCraftActivity([run('run-1', 'completed', { documentId: 'other' })], 'main')).toBeNull();
  });
});
