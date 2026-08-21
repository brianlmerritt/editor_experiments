import { describe, expect, it } from 'vitest';
import { collectionSetDrafts, collectionSets, sameCollectionName } from './collection-sets';

describe('Collection sets', () => {
  it('offers unique, ordinary Collection suggestions including Scene Beats', () => {
    const items = collectionSets.flatMap((set) => set.items);

    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    expect(items.find((item) => item.name === 'Scene Beats')).toMatchObject({
      singularName: 'Scene Beat',
      numbering: { enabled: true, start: 1 }
    });
  });

  it('creates editable, initially unselected drafts without mutating the built-in sets', () => {
    const drafts = collectionSetDrafts();
    drafts.chapters.selected = true;
    drafts.chapters.numbering.start = 4;

    expect(collectionSetDrafts().chapters).toMatchObject({ selected: false, numbering: { start: 1 } });
  });

  it('matches existing Collection names without case or surrounding whitespace', () => {
    expect(sameCollectionName(' Scene Beats ', 'scene beats')).toBe(true);
    expect(sameCollectionName('Scenes', 'Scene Beats')).toBe(false);
  });
});
