import { describe, expect, it } from 'vitest';
import { categories, categoryMeta, eventTypes, makeId, sourceCatalog, wordCount } from './domain';

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
});
