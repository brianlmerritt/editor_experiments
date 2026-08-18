import { describe, expect, it } from 'vitest';
import type { LedgerEvent, Suggestion } from '$lib/domain';
import { restoreSuggestions } from './suggestion-history';

const suggestion: Suggestion = {
  id: 'suggestion-1',
  source: 'local-craft',
  sourceNumber: 1,
  sourceKind: 'local',
  anchor: { from: 1, to: 4, text: 'word' },
  type: 'annotation',
  payload: { comment: 'Check it.' },
  category: 'diction',
  confidence: 0.8,
  variants: [],
  state: 'pending',
  order: 1,
  createdAt: '2026-08-18T00:00:00Z',
  provenance: { promptVersion: 1, briefVersion: 1 }
};

function event(id: number, type: LedgerEvent['type'], payload: Record<string, unknown> = {}): Required<LedgerEvent> {
  return { id, timestamp: '2026-08-18T00:00:00Z', type, sessionId: 'session', branchId: 'main', suggestionId: suggestion.id, payload };
}

describe('restoreSuggestions', () => {
  it('restores unresolved suggestions after reload', () => {
    expect(restoreSuggestions([event(1, 'suggestion_generated', { suggestion })])).toEqual([suggestion]);
  });

  it('applies the latest terminal state', () => {
    const [restored] = restoreSuggestions([
      event(3, 'rejected'),
      event(2, 'suggestion_generated', { suggestion })
    ]);
    expect(restored.state).toBe('rejected');
  });

  it('reopens a drag dismissal when the later event undoes it', () => {
    const [restored] = restoreSuggestions([
      event(4, 'dismiss_undone'),
      event(3, 'dismissed_via_drag'),
      event(2, 'suggestion_generated', { suggestion })
    ]);
    expect(restored.state).toBe('pending');
  });
});
