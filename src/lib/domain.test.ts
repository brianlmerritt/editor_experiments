import { describe, expect, it } from 'vitest';
import { categories, categoryMeta, coalesceDuplicateSuggestions, eventTypes, isExactTextSpan, makeId, sourceCatalog, suggestionFingerprint, suggestionsDescribeSameIssue, wordCount, type Suggestion } from './domain';
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

  it('recognizes exact source spans only at stable text boundaries', () => {
    const passage = 'Mara watched the porter turn the key.';
    expect(isExactTextSpan(passage, 17, 23, 'porter')).toBe(true);
    expect(isExactTextSpan(passage, 18, 23, 'orter')).toBe(false);
    expect(isExactTextSpan(passage, 17, 22, 'porte')).toBe(false);
    expect(isExactTextSpan(passage, 16, 23, ' porter')).toBe(false);
  });

  it('coalesces paraphrased AI annotations about the same issue and locus', () => {
    const first = suggestion({
      id: 'input-first',
      source: 'openrouter',
      sourceKind: 'ai',
      anchor: { from: 20, to: 36, text: 'The porter stood' },
      payload: { comment: 'Establishing shot from an external perspective. Confirm this is Mara’s POV; the porter reads as objective narration.' }
    });
    const repeated = suggestion({
      id: 'input-repeated',
      source: 'openrouter',
      sourceKind: 'ai',
      anchor: { from: 20, to: 37, text: 'The porter stood.' },
      payload: { comment: 'Opening establishes external observation before a POV anchor. Ground the porter in Mara’s perception to tighten close third.' }
    });

    expect(suggestionsDescribeSameIssue(first, repeated)).toBe(true);
    const result = coalesceDuplicateSuggestions([first, repeated]);
    expect(result.suggestions.map((item) => item.state)).toEqual(['pending', 'superseded']);
    expect(result.suppressed[0]).toMatchObject({ reason: 'semantic', duplicate: { id: 'input-repeated' }, canonical: { id: 'input-first' } });
  });

  it('keeps differently located or oppositely valenced AI observations separate', () => {
    const critical = suggestion({
      source: 'openrouter',
      sourceKind: 'ai',
      anchor: { from: 20, to: 36, text: 'The porter stood' },
      payload: { comment: 'External objective perspective creates distance and risks narrator intrusion around Mara’s POV.' }
    });
    const praise = suggestion({
      id: 'input-praise',
      source: 'openrouter',
      sourceKind: 'ai',
      anchor: { from: 20, to: 36, text: 'The porter stood' },
      payload: { comment: 'Strong external perspective works well and maintains Mara’s POV with effective narrative distance.' }
    });
    const elsewhere = suggestion({
      id: 'input-elsewhere',
      source: 'openrouter',
      sourceKind: 'ai',
      anchor: { from: 80, to: 96, text: 'The porter stood' },
      payload: { comment: critical.payload.comment }
    });

    expect(suggestionsDescribeSameIssue(critical, praise)).toBe(false);
    expect(suggestionsDescribeSameIssue(critical, elsewhere)).toBe(false);
    expect(coalesceDuplicateSuggestions([critical, praise, elsewhere]).suggestions.map((item) => item.state))
      .toEqual(['pending', 'pending', 'pending']);
  });

});
