import { describe, expect, it } from 'vitest';
import { categories, categoryMeta, coalesceDuplicateSuggestions, eventTypes, makeId, reconcileSuggestionAnchors, sourceCatalog, suggestionFingerprint, wordCount, type Suggestion } from './domain';
import { textTarget } from '$lib/workspace/attachments';

function suggestion(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'sg_1',
    kind: 'craft_suggestion',
    source: 'local-craft',
    sourceNumber: 1,
    sourceKind: 'local',
    target: textTarget('main', 4, 11, 'noticed'),
    behaviourId: 'craft-input',
    events: [],
    anchor: { from: 4, to: 11, text: 'noticed' },
    type: 'annotation',
    payload: { comment: 'This filters the moment.' },
    category: 'distance',
    confidence: 0.8,
    variants: [],
    state: 'pending',
    order: 4,
    createdAt: '2026-07-18T00:00:00.000Z',
    provenance: { promptVersion: 1, briefVersion: 1 },
    ...overrides
  };
}

describe('domain contracts', () => {
  it('keeps category metadata complete', () => {
    expect(Object.keys(categoryMeta).sort()).toEqual([...categories].sort());
    expect(categories.every((category) => categoryMeta[category].label.length > 0)).toBe(true);
  });

  it('keeps the append-only taxonomy unambiguous', () => {
    expect(new Set(eventTypes).size).toBe(eventTypes.length);
    expect(eventTypes).toContain('suggestion_generated');
    expect(eventTypes).toContain('judgment_recorded');
  });

  it('provides stable utility behavior', () => {
    expect(wordCount('  one\n two   three ')).toBe(3);
    expect(wordCount('')).toBe(0);
    expect(makeId('test')).toMatch(/^test_[a-z0-9]+_[a-z0-9]+$/);
    expect(sourceCatalog.map((source) => source.number)).toEqual([1, 2, 3, 4]);
  });

  it('coalesces repeated live suggestions while preserving their ledger identity', () => {
    const original = suggestion();
    const repeated = suggestion({ id: 'sg_2', createdAt: '2026-07-18T00:01:00.000Z' });
    expect(suggestionFingerprint(repeated)).toBe(suggestionFingerprint(original));

    const result = coalesceDuplicateSuggestions([original, repeated]);
    expect(result.suggestions.map((item) => item.state)).toEqual(['pending', 'superseded']);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].canonical.id).toBe('sg_1');
    expect(result.suppressed[0].duplicate.id).toBe('sg_2');
  });

  it('does not resurface an identical suggestion after the writer rejected it', () => {
    const rejected = suggestion({ id: 'sg_rejected', state: 'rejected' });
    const repeated = suggestion({ id: 'sg_again' });
    const result = coalesceDuplicateSuggestions([rejected, repeated]);
    expect(result.suggestions[1].state).toBe('superseded');
    expect(result.suppressed[0].canonical.id).toBe('sg_rejected');
  });

  it('recognizes a repeated note after preceding edits move its live anchor', () => {
    const anchored = suggestion({ anchor: { from: 20, to: 27, text: 'noticed', start: { item: 'start' }, end: { item: 'end' } } });
    const repeated = suggestion({ id: 'sg_shifted', anchor: { from: 8, to: 15, text: 'noticed' } });

    expect(suggestionFingerprint(anchored)).not.toBe(suggestionFingerprint(repeated));
    const rebased = reconcileSuggestionAnchors([anchored], () => ({ from: 8, to: 15, text: 'noticed' }));
    const result = coalesceDuplicateSuggestions([...rebased.suggestions, repeated]);

    expect(result.suggestions.map((item) => item.state)).toEqual(['pending', 'superseded']);
  });

  it('expires a live note as soon as a human edit changes its anchored text', () => {
    const current = suggestion();
    const result = reconcileSuggestionAnchors([current], () => ({ from: 4, to: 12, text: 'rewritten' }));

    expect(result.suggestions[0].state).toBe('stale');
    expect(result.expired).toEqual([current]);
  });

  it('rebases a live note without expiring it when only preceding text changed', () => {
    const current = suggestion();
    const result = reconcileSuggestionAnchors([current], () => ({ from: 14, to: 21, text: 'noticed' }));

    expect(result.suggestions[0].state).toBe('pending');
    expect(result.suggestions[0].anchor).toMatchObject({ from: 14, to: 21, text: 'noticed' });
    expect(result.expired).toEqual([]);
  });
});
