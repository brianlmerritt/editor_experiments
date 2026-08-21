import { describe, expect, it } from 'vitest';
import { relationshipSetDrafts, relationshipSets, sameRelationshipDefinition } from './relationship-sets';

describe('writing relationship sets', () => {
  it('provides six editable writing vocabularies without creating relationship instances', () => {
    expect(relationshipSets.map((set) => set.name)).toEqual([
      'Narrative essentials',
      'Character knowledge and change',
      'Story world',
      'Argument and evidence',
      'Research',
      'Non-fiction'
    ]);
    expect(relationshipSets.every((set) => set.items.length >= 8)).toBe(true);
    expect(relationshipSets.flatMap((set) => set.items).every((item) => item.forwardLabel && item.inverseLabel && item.description)).toBe(true);
  });

  it('creates independent unselected drafts for editing in the manager', () => {
    const first = relationshipSetDrafts();
    const second = relationshipSetDrafts();
    const id = 'narrative-essentials:features';

    first[id].selected = true;
    first[id].forwardLabel = 'contains a performance by';

    expect(second[id]).toMatchObject({ selected: false, forwardLabel: 'features', inverseLabel: 'appears in' });
  });

  it('recognises duplicate definitions in either direction', () => {
    const installed = { forwardLabel: 'features', inverseLabel: 'appears in' };
    expect(sameRelationshipDefinition(installed, { forwardLabel: ' FEATURES ', inverseLabel: 'appears   in' })).toBe(true);
    expect(sameRelationshipDefinition(installed, { forwardLabel: 'appears in', inverseLabel: 'features' })).toBe(true);
    expect(sameRelationshipDefinition(installed, { forwardLabel: 'uses viewpoint of', inverseLabel: 'is viewpoint character in' })).toBe(false);
  });
});
