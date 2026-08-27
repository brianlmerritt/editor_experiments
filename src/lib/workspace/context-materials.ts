import type { WorkspaceDocument } from './model';
import { nodeCollectionId, type CollectionDefinition } from './navigator';

export interface AIContextMaterialGroup {
  id: string;
  label: string;
  items: WorkspaceDocument[];
}

export function groupAIContextMaterials(
  materials: WorkspaceDocument[],
  collections: CollectionDefinition[],
  excludedId?: string | null
): AIContextMaterialGroup[] {
  const definitions = new Map(collections.map((collection) => [collection.id, collection]));
  const groups = new Map<string, AIContextMaterialGroup & { order: number }>();
  for (const material of materials) {
    if (material.id === excludedId) continue;
    const collection = definitions.get(nodeCollectionId(material) ?? '');
    const identity = collection
      ? { id: `collection:${collection.id}`, label: collection.name, order: collection.order }
      : material.role === 'manuscript'
        ? { id: 'documents', label: 'Documents', order: -20 }
        : material.role === 'navigator_collection'
          ? { id: 'material-definitions', label: 'Material definitions', order: 10_000 }
          : { id: 'other-material', label: 'Other material', order: 10_001 };
    const group = groups.get(identity.id) ?? { ...identity, items: [] };
    group.items.push(material);
    groups.set(identity.id, group);
  }
  return [...groups.values()]
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    .map(({ order: _order, ...group }) => ({
      ...group,
      items: group.items.sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true }))
    }));
}
