import { describe, expect, it } from 'vitest';
import type { Suggestion } from '$lib/domain';
import { rebaseResponseRange, type TrackedRequestRange } from './request-anchor';

function suggestion(from: number, to: number, text: string): Suggestion {
  return {
    id: 'input-1', kind: 'craft_suggestion', source: 'openrouter', sourceNumber: 3, sourceKind: 'ai',
    target: { mode: 'snapshot', targets: [{ type: 'text', nodeId: 'main', start: from, end: to }] },
    behaviourId: 'craft-input', events: [], anchor: { from, to, text }, type: 'replacement',
    payload: { comment: 'Revise this.' }, category: 'diction', confidence: 0.8,
    variants: [{ id: 'variant-1', text: 'watched' }], state: 'pending', order: 1,
    createdAt: '2026-08-18T00:00:00Z', provenance: { promptVersion: 1, briefVersion: 1 }
  };
}

const requested: TrackedRequestRange = {
  from: 10,
  to: 35,
  text: 'Mara noticed the platform.'
};

describe('AI response anchors', () => {
  it('moves a response with unchanged prose when text before the request is edited', () => {
    const current = 'Mara noticed the platform.';
    const result = rebaseResponseRange(
      suggestion(15, 22, 'noticed'),
      requested,
      { from: 24, to: 49, text: current },
      (from, to) => current.slice(from - 24, to - 24)
    );

    expect(result).toEqual({ from: 29, to: 36 });
  });

  it('rejects a response when the writer changes its requested passage while waiting', () => {
    const result = rebaseResponseRange(
      suggestion(15, 22, 'noticed'),
      requested,
      { from: 10, to: 34, text: 'Mara saw the platform.' },
      () => 'noticed'
    );

    expect(result).toBeNull();
  });

  it('rejects invalid provider offsets instead of applying them elsewhere', () => {
    const result = rebaseResponseRange(
      suggestion(8, 15, 'noticed'),
      requested,
      { from: 10, to: 35, text: requested.text },
      () => 'noticed'
    );

    expect(result).toBeNull();
  });
});
