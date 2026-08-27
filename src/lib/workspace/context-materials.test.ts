import { describe, expect, it } from 'vitest';
import type { WorkspaceDocument } from './model';
import type { CollectionDefinition } from './navigator';
import { groupAIContextMaterials } from './context-materials';

function material(id: string, title: string, collectionId?: string, role = 'navigator_node'): WorkspaceDocument {
  return {
    id, projectId: 'project', parentId: null, title, order: 0, revision: 1, role,
    extensions: collectionId ? { navigator: { collectionId } } : {},
    kind: 'document', content: `${title} content`, updatedAt: '2026-08-27T00:00:00Z'
  };
}

const collections: CollectionDefinition[] = [
  { id: 'characters', name: 'Characters', singularName: 'Character', order: 0, icon: 'file', numbering: { enabled: false, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true } },
  { id: 'scenes', name: 'Scenes', singularName: 'Scene', order: 1, icon: 'file', numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true } }
];

describe('Writing Context Material groups', () => {
  it('groups choices by project Material type and uses numeric title ordering', () => {
    const groups = groupAIContextMaterials([
      material('scene-10', 'Scene 10', 'scenes'),
      material('ash', 'Ash', 'characters'),
      material('scene-2', 'Scene 2', 'scenes'),
      material('draft', 'Main draft', undefined, 'manuscript')
    ], collections);

    expect(groups.map((group) => group.label)).toEqual(['Documents', 'Characters', 'Scenes']);
    expect(groups.find((group) => group.label === 'Scenes')?.items.map((item) => item.title)).toEqual(['Scene 2', 'Scene 10']);
  });

  it('omits the active request target', () => {
    const groups = groupAIContextMaterials([
      material('ash', 'Ash', 'characters'),
      material('marcus', 'Marcus', 'characters')
    ], collections, 'ash');

    expect(groups[0].items.map((item) => item.id)).toEqual(['marcus']);
  });
});
