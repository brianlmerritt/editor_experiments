import { describe, expect, it } from 'vitest';
import type { Category, CraftRun, Suggestion } from '$lib/domain';
import { textTarget } from './attachments';
import { selectDisplayedInputs, summarizeLatestCraftActivity } from './input-panel';

function input(id: string, overrides: Partial<Suggestion> = {}): Suggestion {
  const sourceText = overrides.anchor?.text ?? id;
  return {
    id,
    kind: 'craft_suggestion',
    source: 'openrouter',
    sourceNumber: 3,
    sourceKind: 'ai',
    target: textTarget('main', 0, sourceText.length, sourceText),
    behaviourId: 'craft-input',
    events: [],
    anchor: { from: 0, to: sourceText.length, text: sourceText },
    type: 'annotation',
    payload: { comment: `Comment ${id}` },
    category: 'diction',
    confidence: 0.7,
    variants: [],
    state: 'pending',
    order: 0,
    createdAt: '2026-08-25T00:00:00Z',
    provenance: { promptVersion: 1, briefVersion: 1 },
    ...overrides
  };
}

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
  it('separates filters, combined duplicates, and the display limit', () => {
    const duplicate = input('duplicate', {
      id: 'duplicate',
      anchor: { from: 0, to: 3, text: 'one' },
      target: textTarget('main', 0, 3, 'one'),
      payload: { comment: 'Comment one' }
    });
    const categoryVisibility = { pov: false, tense: true, canon: true, cadence: true, diction: true, distance: true } satisfies Record<Category, boolean>;
    const summary = selectDisplayedInputs([
      input('one'),
      duplicate,
      input('two', { order: 1 }),
      input('three', { order: 2 }),
      input('four', { order: 3 }),
      input('five', { order: 4 }),
      input('hidden-category', { category: 'pov' }),
      input('hidden-source', { source: 'anthropic' })
    ], categoryVisibility, { openrouter: true, anthropic: false }, 3);

    expect(summary).toMatchObject({
      pendingCount: 8,
      hiddenByFilters: 2,
      duplicatesCombined: 1,
      displayableCount: 5,
      beyondLimit: 2
    });
    expect(summary.displayed.map((item) => item.id)).toEqual(['one', 'two', 'three']);
  });

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

  it('keeps a provider-partial passage visible as a partial activity', () => {
    const summary = summarizeLatestCraftActivity([
      run('run-1', 'partial', {
        proposalIds: ['one'],
        errors: [{ source: 'provider-b', message: 'Unavailable', classification: 'transient', recovered: false }],
        completedAt: '2026-08-24T10:00:03Z'
      })
    ], 'main');

    expect(summary).toMatchObject({ state: 'partial', proposalCount: 1, errorCount: 1 });
  });

  it('ignores activity belonging to another document', () => {
    expect(summarizeLatestCraftActivity([run('run-1', 'completed', { documentId: 'other' })], 'main')).toBeNull();
  });
});
