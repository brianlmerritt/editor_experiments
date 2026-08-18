import { describe, expect, it } from 'vitest';
import type { LedgerEvent, Suggestion, WritingBrief } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
import { buildReviewQueue } from './review-queue';

const brief: WritingBrief = { version: 1, form: 'fiction', pov: 'third person', tense: 'past', distance: 'close', canon: '' };

function suggestion(id: string): Suggestion {
  return {
    id,
    kind: 'craft_suggestion',
    source: 'fake-sentinel',
    sourceNumber: 2,
    sourceKind: 'ai',
    target: textTarget('main', 1, 8, 'noticed'),
    behaviourId: 'craft-input',
    events: [],
    anchor: { from: 1, to: 8, text: 'noticed' },
    type: 'replacement',
    payload: { text: 'saw', comment: 'Try alternatives.' },
    category: 'diction',
    confidence: 0.7,
    variants: [{ id: `${id}_v1`, text: 'saw' }, { id: `${id}_v2`, text: 'observed' }],
    state: 'pending',
    order: 1,
    createdAt: '2026-08-17T00:00:00Z',
    provenance: { promptVersion: 1, briefVersion: 1 }
  };
}

function event(id: number, type: LedgerEvent['type'], suggestionId: string, payload: Record<string, unknown> = {}): Required<LedgerEvent> {
  return { id, timestamp: `2026-08-17T00:00:0${id}Z`, type, sessionId: 'session', branchId: 'main', suggestionId, payload };
}

describe('review queue', () => {
  it('builds one blind comparison for every distinct effective variant', () => {
    const item = suggestion('sg_1');
    const pairs = buildReviewQueue([event(1, 'suggestion_generated', item.id, { suggestion: item })], brief);
    expect(pairs.map((pair) => pair.right.text)).toEqual(['saw', 'observed']);
  });

  it('excludes suggestions resolved after generation', () => {
    const item = suggestion('sg_1');
    const events = [
      event(2, 'rejected', item.id),
      event(1, 'suggestion_generated', item.id, { suggestion: item })
    ];
    expect(buildReviewQueue(events, brief)).toEqual([]);
  });

  it('removes only the variant pair already judged', () => {
    const item = suggestion('sg_1');
    const firstPair = `pair_${item.id}_${item.variants[0].id}`;
    const events = [
      event(2, 'judgment_recorded', item.id, { pairId: firstPair }),
      event(1, 'suggestion_generated', item.id, { suggestion: item })
    ];
    expect(buildReviewQueue(events, brief).map((pair) => pair.right.text)).toEqual(['observed']);
  });

  it('does not carry abandoned comparisons across workbench reloads', () => {
    const oldItem = suggestion('sg_old');
    const currentItem = suggestion('sg_current');
    const events = [
      event(3, 'suggestion_generated', currentItem.id, { suggestion: currentItem }),
      event(2, 'session_started', ''),
      event(1, 'suggestion_generated', oldItem.id, { suggestion: oldItem })
    ];
    expect(buildReviewQueue(events, brief).every((pair) => pair.suggestionId === currentItem.id)).toBe(true);
  });
});
