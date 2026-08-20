import type { ExtensionData, WorkspaceDocument, WorkspaceProject } from './model';

export type NavigatorMode = 'traditional' | 'context';

export interface NavigatorCapabilities {
  contentBearing: boolean;
  mayContainChildren: boolean;
}

export interface CollectionDefinition {
  id: string;
  name: string;
  itemName: string;
  order: number;
  icon: 'text' | 'character' | 'location' | 'research' | 'note';
  capabilities: NavigatorCapabilities;
}

export interface NavigatorRelationship {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  inverseType: string;
  confirmed: true;
}

export interface NavigatorTodo {
  id: string;
  title: string;
  state: 'open' | 'done';
  targetNodeIds: string[];
  parentTodoId?: string;
  createdAt: string;
}

export interface NavigatorProjectState {
  version: 1;
  revision: number;
  collections: CollectionDefinition[];
  relationships: NavigatorRelationship[];
  todos: NavigatorTodo[];
}

export interface NavigatorViewMemory {
  expandedKeys: string[];
  selectedKey?: string;
  scrollAnchorKey?: string;
}

export interface NavigatorMemory {
  mode: NavigatorMode;
  traditional: NavigatorViewMemory;
  context: NavigatorViewMemory & { recentContextKeys: string[] };
}

export const emptyNavigatorState = (): NavigatorProjectState => ({
  version: 1,
  revision: 0,
  collections: [],
  relationships: [],
  todos: []
});

export const emptyNavigatorMemory = (): NavigatorMemory => ({
  mode: 'traditional',
  traditional: { expandedKeys: ['fixed:todos'] },
  context: { expandedKeys: ['fixed:todos', 'context:focus', 'context:related'], recentContextKeys: [] }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readNavigatorState(project: WorkspaceProject | null): NavigatorProjectState {
  const stored = project?.extensions.navigator;
  if (!isRecord(stored) || stored.version !== 1) return emptyNavigatorState();
  return {
    version: 1,
    revision: typeof stored.revision === 'number' ? stored.revision : 0,
    collections: Array.isArray(stored.collections) ? stored.collections as unknown as CollectionDefinition[] : [],
    relationships: Array.isArray(stored.relationships) ? stored.relationships as unknown as NavigatorRelationship[] : [],
    todos: Array.isArray(stored.todos) ? stored.todos as unknown as NavigatorTodo[] : []
  };
}

export function navigatorExtensions(current: ExtensionData, state: NavigatorProjectState): ExtensionData {
  return {
    ...current,
    navigator: JSON.parse(JSON.stringify(state))
  } as ExtensionData;
}

export function nodeCollectionId(node: WorkspaceDocument): string | null {
  const navigator = node.extensions.navigator;
  return isRecord(navigator) && typeof navigator.collectionId === 'string'
    ? navigator.collectionId
    : null;
}

export function nodeExtensions(current: ExtensionData, collectionId: string): ExtensionData {
  return { ...current, navigator: { collectionId } };
}

export function relationNeighbours(
  nodeId: string,
  relationships: NavigatorRelationship[]
): { nodeId: string; label: string; relationshipId: string }[] {
  return relationships.flatMap((relationship) => {
    if (relationship.sourceNodeId === nodeId) {
      return [{ nodeId: relationship.targetNodeId, label: relationship.type, relationshipId: relationship.id }];
    }
    if (relationship.targetNodeId === nodeId) {
      return [{ nodeId: relationship.sourceNodeId, label: relationship.inverseType, relationshipId: relationship.id }];
    }
    return [];
  });
}

export function ancestors(nodeId: string, nodes: WorkspaceDocument[]): WorkspaceDocument[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: WorkspaceDocument[] = [];
  const visited = new Set([nodeId]);
  let current = byId.get(nodeId);
  while (current?.parentId) {
    if (visited.has(current.parentId)) break;
    visited.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    result.unshift(parent);
    current = parent;
  }
  return result;
}
