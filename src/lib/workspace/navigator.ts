import type { ExtensionData, WorkspaceDocument, WorkspaceProject } from './model';

export type NavigatorMode = 'traditional' | 'context';

export interface NavigatorCapabilities {
  contentBearing: boolean;
  mayContainChildren: boolean;
}

export interface CollectionDefinition {
  id: string;
  name: string;
  singularName: string;
  order: number;
  icon: 'folder' | 'file' | 'link' | 'todo' | 'none';
  numbering: {
    enabled: boolean;
    start: number;
  };
  capabilities: NavigatorCapabilities;
}

export interface NavigatorRelationship {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  definitionId?: string;
  type: string;
  inverseType: string;
  scopeNodeIds?: string[];
  note?: string;
  confirmed: true;
}

export interface RelationshipDefinition {
  id: string;
  forwardLabel: string;
  inverseLabel: string;
  description: string;
  symmetric: boolean;
  order: number;
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
  relationshipDefinitions: RelationshipDefinition[];
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
  context: NavigatorViewMemory & {
    focusKey?: string;
    recentContextKeys: string[];
    historyKeys: string[];
    historyIndex: number;
  };
}

export const emptyNavigatorState = (): NavigatorProjectState => ({
  version: 1,
  revision: 0,
  collections: [],
  relationshipDefinitions: [],
  relationships: [],
  todos: []
});

export const emptyNavigatorMemory = (): NavigatorMemory => ({
  mode: 'traditional',
  traditional: { expandedKeys: ['fixed:todos'] },
  context: {
    expandedKeys: ['context:focus', 'context:related'],
    recentContextKeys: [],
    historyKeys: [],
    historyIndex: -1
  }
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
    collections: Array.isArray(stored.collections)
      ? (stored.collections as unknown[]).filter(isRecord).map((collection, index) => ({
          id: String(collection.id ?? ''),
          name: String(collection.name ?? 'Collection'),
          singularName: String(collection.singularName ?? collection.itemName ?? 'Item'),
          order: typeof collection.order === 'number' ? collection.order : index,
          icon: ['folder', 'file', 'link', 'todo', 'none'].includes(String(collection.icon))
            ? collection.icon as CollectionDefinition['icon']
            : 'folder',
          numbering: isRecord(collection.numbering)
            ? {
                enabled: collection.numbering.enabled === true,
                start: typeof collection.numbering.start === 'number' ? collection.numbering.start : 1
              }
            : { enabled: false, start: 1 },
          capabilities: isRecord(collection.capabilities)
            ? {
                contentBearing: collection.capabilities.contentBearing !== false,
                mayContainChildren: collection.capabilities.mayContainChildren !== false
              }
            : { contentBearing: true, mayContainChildren: true }
        })).filter((collection) => collection.id)
      : [],
    relationshipDefinitions: Array.isArray(stored.relationshipDefinitions)
      ? (stored.relationshipDefinitions as unknown[]).filter(isRecord).map((definition, index) => ({
          id: String(definition.id ?? ''),
          forwardLabel: String(definition.forwardLabel ?? '').trim(),
          inverseLabel: String(definition.inverseLabel ?? '').trim(),
          description: String(definition.description ?? '').trim(),
          symmetric: definition.symmetric === true,
          order: typeof definition.order === 'number' ? definition.order : index
        })).filter((definition) => definition.id && definition.forwardLabel && definition.inverseLabel)
      : [],
    relationships: Array.isArray(stored.relationships)
      ? (stored.relationships as unknown[]).filter(isRecord).map((relationship) => ({
          id: String(relationship.id ?? ''),
          sourceNodeId: String(relationship.sourceNodeId ?? ''),
          targetNodeId: String(relationship.targetNodeId ?? ''),
          definitionId: typeof relationship.definitionId === 'string' ? relationship.definitionId : undefined,
          type: String(relationship.type ?? '').trim(),
          inverseType: String(relationship.inverseType ?? '').trim(),
          scopeNodeIds: Array.isArray(relationship.scopeNodeIds)
            ? relationship.scopeNodeIds.map(String).filter(Boolean)
            : [],
          note: typeof relationship.note === 'string' ? relationship.note : '',
          confirmed: true as const
        })).filter((relationship) => relationship.id && relationship.sourceNodeId && relationship.targetNodeId && relationship.type && relationship.inverseType)
      : [],
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

export function nodeOptionalTitle(node: WorkspaceDocument): string {
  const navigator = node.extensions.navigator;
  return isRecord(navigator) && typeof navigator.optionalTitle === 'string' ? navigator.optionalTitle : '';
}

export function nodeArchived(node: WorkspaceDocument): boolean {
  const navigator = node.extensions.navigator;
  return isRecord(navigator) && navigator.archived === true;
}

export function nodeArchivedExtensions(current: ExtensionData, archived: boolean): ExtensionData {
  const existing = isRecord(current.navigator) ? current.navigator : {};
  return { ...current, navigator: { ...existing, archived } } as ExtensionData;
}

export function nodeExtensions(
  current: ExtensionData,
  collectionId: string,
  optionalTitle = '',
  kind: 'item' | 'collection' = 'item'
): ExtensionData {
  const existing = isRecord(current.navigator) ? current.navigator : {};
  return { ...current, navigator: { ...existing, collectionId, optionalTitle, kind } } as ExtensionData;
}

export function itemDisplayName(
  node: WorkspaceDocument,
  collection: CollectionDefinition | undefined,
  siblings: WorkspaceDocument[]
): string {
  if (!collection?.numbering.enabled) return node.title;
  const ordered = [...siblings].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const index = Math.max(0, ordered.findIndex((candidate) => candidate.id === node.id));
  const base = `${collection.singularName} ${collection.numbering.start + index}`;
  const optionalTitle = nodeOptionalTitle(node).trim();
  return optionalTitle ? `${base} — ${optionalTitle}` : base;
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
