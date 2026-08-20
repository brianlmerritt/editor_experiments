import { describe, expect, it } from 'vitest';
import type { WorkspaceDocument, WorkspaceProject } from './model';
import {
  ancestors,
  emptyNavigatorState,
  navigatorExtensions,
  nodeCollectionId,
  nodeExtensions,
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
  it('starts without generated collections, nodes, relationships, or todos', () => {
    expect(readNavigatorState(project)).toEqual(emptyNavigatorState());
  });

  it('round-trips Navigator state through the project extension boundary', () => {
    const state: NavigatorProjectState = {
      version: 1,
      revision: 2,
      collections: [{
        id: 'characters', name: 'Characters', itemName: 'Character', order: 0, icon: 'character',
        capabilities: { contentBearing: true, mayContainChildren: false }
      }],
      relationships: [],
      todos: []
    };
    const stored = { ...project, extensions: navigatorExtensions({}, state) };
    expect(readNavigatorState(stored)).toEqual(state);
  });

  it('keeps collection membership on the node without replacing other extensions', () => {
    const extensions = nodeExtensions({ margin_note: { revision: 3 } }, 'scenes');
    const scene = { ...node('scene'), extensions };
    expect(nodeCollectionId(scene)).toBe('scenes');
    expect(scene.extensions.margin_note).toEqual({ revision: 3 });
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
