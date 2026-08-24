import { describe, expect, it } from 'vitest';
import type { WorkspaceDocument, WorkspaceProject } from './model';
import {
  ancestors,
  compareNavigatorLabels,
  emptyNavigatorState,
  navigatorExtensions,
  nodeCollectionId,
  nodeExtensions,
  itemDisplayName,
  readNavigatorState,
  relationNeighbours,
  type NavigatorProjectState
} from './navigator';

const project: WorkspaceProject = {
  id: 'project', title: 'Work', revision: 1, extensions: {}, updatedAt: '2026-08-20T00:00:00Z'
};

function node(id: string, parentId: string | null = null): WorkspaceDocument {
  return {
    id, projectId: 'project', parentId, title: id, order: 0, revision: 1,
    extensions: {}, kind: 'document', content: '', updatedAt: '2026-08-20T00:00:00Z'
  };
}

describe('Navigator domain projection', () => {
  it('orders numbered writing material naturally and then alphabetically', () => {
    const labels = ['Scene 10', 'Appendix', 'Scene 2', 'Scene 1', 'Character'];
    expect(labels.sort(compareNavigatorLabels)).toEqual(['Appendix', 'Character', 'Scene 1', 'Scene 2', 'Scene 10']);
  });

  it('starts without generated collections, nodes, relationships, or todos', () => {
    expect(readNavigatorState(project)).toEqual(emptyNavigatorState());
  });

  it('round-trips Navigator state through the project extension boundary', () => {
    const state: NavigatorProjectState = {
      version: 1,
      revision: 2,
      collections: [{
        id: 'characters', name: 'Characters', singularName: 'Character', order: 0, icon: 'folder',
        numbering: { enabled: false, start: 1 },
        capabilities: { contentBearing: true, mayContainChildren: false }
      }],
      relationshipDefinitions: [{
        id: 'features', forwardLabel: 'features', inverseLabel: 'appears in',
        description: 'Participation in a narrative unit.', symmetric: false, order: 0
      }],
      relationships: [{
        id: 'relation', sourceNodeId: 'scene', targetNodeId: 'mara', definitionId: 'features',
        type: 'features', inverseType: 'appears in', scopeNodeIds: ['chapter'], note: 'Mara arrives late.', confirmed: true
      }],
      todos: []
    };
    const stored = { ...project, extensions: navigatorExtensions({}, state) };
    expect(readNavigatorState(stored)).toEqual(state);
  });

  it('loads legacy free-text relationships while defaulting the new vocabulary and scope fields', () => {
    const stored = {
      ...project,
      extensions: {
        navigator: {
          version: 1,
          revision: 3,
          collections: [],
          relationships: [{ id: 'legacy', sourceNodeId: 'scene', targetNodeId: 'mara', type: 'features', inverseType: 'appears in', confirmed: true }],
          todos: []
        }
      }
    };

    expect(readNavigatorState(stored)).toMatchObject({
      relationshipDefinitions: [],
      relationships: [{ id: 'legacy', definitionId: undefined, scopeNodeIds: [], note: '' }]
    });
  });

  it('keeps collection membership on the node without replacing other extensions', () => {
    const extensions = nodeExtensions({ margin_note: { revision: 3 } }, 'scenes', 'Arrival');
    const scene = { ...node('scene'), extensions };
    expect(nodeCollectionId(scene)).toBe('scenes');
    expect(scene.extensions.margin_note).toEqual({ revision: 3 });
  });

  it('derives numbered labels from sibling order while retaining optional titles', () => {
    const first = { ...node('first'), order: 0, extensions: nodeExtensions({}, 'scenes', 'Arrival') };
    const second = { ...node('second'), order: 1, extensions: nodeExtensions({}, 'scenes') };
    const collection = {
      id: 'scenes', name: 'Scenes', singularName: 'Scene', order: 0, icon: 'folder' as const,
      numbering: { enabled: true, start: 3 }, capabilities: { contentBearing: true, mayContainChildren: true }
    };

    expect(itemDisplayName(first, collection, [first, second])).toBe('Scene 3 — Arrival');
    expect(itemDisplayName(second, collection, [first, second])).toBe('Scene 4');
    expect(itemDisplayName(first, collection, [second, { ...first, order: 2 }])).toBe('Scene 4 — Arrival');
  });

  it('projects inverse relationship labels without copying nodes', () => {
    const relations = [{
      id: 'relation', sourceNodeId: 'scene', targetNodeId: 'mara', type: 'features',
      inverseType: 'appears in', confirmed: true as const
    }];
    expect(relationNeighbours('scene', relations)).toEqual([{ nodeId: 'mara', label: 'features', relationshipId: 'relation' }]);
    expect(relationNeighbours('mara', relations)).toEqual([{ nodeId: 'scene', label: 'appears in', relationshipId: 'relation' }]);
  });

  it('walks primary containment defensively', () => {
    const nodes = [node('chapter'), node('scene', 'chapter'), node('beat', 'scene')];
    expect(ancestors('beat', nodes).map((item) => item.id)).toEqual(['chapter', 'scene']);
  });
});
