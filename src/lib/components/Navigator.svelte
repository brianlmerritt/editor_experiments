<script lang="ts">
  import { workspace } from '$lib/state/workspace.svelte';
  import RelationshipManager from '$lib/components/RelationshipManager.svelte';
  import {
    collectionSetDrafts,
    collectionSets,
    sameCollectionName,
    type CollectionSetDraft
  } from '$lib/workspace/collection-sets';
  import { nodeArchived, nodeCollectionId, type CollectionDefinition } from '$lib/workspace/navigator';
  import type { WorkspaceDocument } from '$lib/workspace/model';
  import collectionsInstructions from '$lib/content/navigator/collections-instructions.html?raw';
  import todosInstructions from '$lib/content/navigator/todos-instructions.html?raw';
  import archivedInstructions from '$lib/content/navigator/archived-unowned-instructions.html?raw';

  let { onOpenNode, onSwitchProject, onCreateProject, onRenameProject, onResetProject }: {
    onOpenNode: (id: string, navigation?: 'push' | 'back' | 'forward') => Promise<void>;
    onSwitchProject: (id: string) => Promise<void>;
    onCreateProject: () => void;
    onRenameProject: () => void;
    onResetProject: () => void;
  } = $props();

  let collectionManagerOpen = $state(false);
  let collectionManagerPurpose = $state<'manage' | 'create-child' | 'proactive'>('manage');
  let collectionFormOpen = $state(false);
  let collectionName = $state('');
  let singularName = $state('');
  let singularEdited = $state(false);
  let collectionIcon = $state<CollectionDefinition['icon']>('folder');
  let numberingEnabled = $state(false);
  let numberingStart = $state(1);
  let todoDraft = $state('');
  let relationshipManagerOpen = $state(false);
  let childCollection = $state('');
  let childTitle = $state('');
  let dragged = $state<{ kind: 'collection' | 'node'; id: string } | null>(null);
  let editingCollectionId = $state<string | null>(null);
  let editCollectionName = $state('');
  let editSingularName = $state('');
  let editCollectionIcon = $state<CollectionDefinition['icon']>('folder');
  let editNumberingEnabled = $state(false);
  let editNumberingStart = $state(1);
  let deletingCollectionId = $state<string | null>(null);
  let helpTopic = $state<'collections' | 'todos' | 'archived' | null>(null);
  let expandedSetIds = $state<string[]>([]);
  let setDrafts = $state<Record<string, CollectionSetDraft>>(collectionSetDrafts());
  let applyingSets = $state(false);
  let addMenuOpen = $state(false);
  let addKind = $state<'material' | 'todo' | null>(null);
  let removalMode = $state(false);
  let removalConfirm = $state(false);
  let removeNodeIds = $state<string[]>([]);
  let removeTodoIds = $state<string[]>([]);
  let removeRelationshipIds = $state<string[]>([]);
  let dropTarget = $state<{ nodeId: string; placement: 'before' | 'inside' } | null>(null);
  const promptedEmptyProjects = new Set<string>();

  let current = $derived(workspace.currentDocument);
  let focused = $derived(workspace.navigatorFocusNode);
  let helpContent = $derived(helpTopic === 'collections'
    ? collectionsInstructions
    : helpTopic === 'todos'
      ? todosInstructions
      : helpTopic === 'archived'
        ? archivedInstructions
        : '');
  let selectedSetItemCount = $derived(Object.values(setDrafts).filter((item) => item.selected && !setTemplateExists(item.id)).length);
  let selectedSetHasErrors = $derived(Object.values(setDrafts).some((item) =>
    item.selected && (!item.name.trim() || !item.singularName.trim() || draftNameConflict(item.id))));
  let removalCount = $derived(removeNodeIds.length + removeTodoIds.length + removeRelationshipIds.length);

  $effect(() => {
    const projectId = workspace.projectId;
    const collectionCount = workspace.navigator.collections.length;
    if (!projectId || workspace.loading) return;
    if (collectionCount > 0) {
      promptedEmptyProjects.delete(projectId);
      return;
    }
    if (!promptedEmptyProjects.has(projectId)) {
      promptedEmptyProjects.add(projectId);
      openCollectionManager('proactive');
    }
  });

  const iconGlyphs: Record<CollectionDefinition['icon'], string> = {
    folder: '▰', file: '▤', link: '↗', todo: '✓', none: ''
  };

  function childrenOf(nodeId: string): WorkspaceDocument[] {
    return workspace.navigatorNodes
      .filter((node) => node.parentId === nodeId && !nodeArchived(node))
      .sort((a, b) => a.order - b.order);
  }

  function rootsForCollection(collectionId: string): WorkspaceDocument[] {
    return workspace.navigatorNodes
      .filter((node) => nodeCollectionId(node) === collectionId && !nodeArchived(node))
      .filter((node) => node.parentId === collectionId || !node.parentId || !workspace.projectNodes.some((candidate) => candidate.id === node.parentId))
      .sort((a, b) => a.order - b.order);
  }

  function targetLabels(ids: string[]): string {
    const labels = ids.map((id) => {
      const node = workspace.projectNodes.find((candidate) => candidate.id === id);
      return node ? workspace.navigatorNodeLabel(node) : null;
    }).filter(Boolean);
    return labels.length ? labels.join(', ') : 'Work';
  }

  function runProjectAction(event: MouseEvent, action: () => void): void {
    const button = event.currentTarget;
    if (button instanceof HTMLElement) button.closest('details')?.removeAttribute('open');
    action();
  }

  function previewChildren(node: WorkspaceDocument, path: string[]): WorkspaceDocument[] {
    const excluded = new Set(path);
    return childrenOf(node.id).filter((child) => !excluded.has(child.id)).slice(0, 3);
  }

  function previewTodos(node: WorkspaceDocument) {
    return [...workspace.navigatorTodosFor(node.id)]
      .sort((left, right) => Number(left.state === 'done') - Number(right.state === 'done') || left.createdAt.localeCompare(right.createdAt))
      .slice(0, 3);
  }

  function previewRelations(node: WorkspaceDocument, path: string[]) {
    const excluded = new Set([
      ...path,
      ...(focused ? [focused.id] : []),
      ...workspace.selectedNodeChildren.map((child) => child.id),
      ...workspace.selectedNodeRelations.map((relation) => relation.node.id)
    ]);
    return workspace.navigatorRelationsFor(node.id).filter((relation) => !excluded.has(relation.node.id)).slice(0, 3);
  }

  function hasPreview(node: WorkspaceDocument, path: string[]): boolean {
    return Boolean(previewChildren(node, path).length || previewTodos(node).length || previewRelations(node, path).length);
  }

  function contextPeers(): WorkspaceDocument[] {
    if (!focused?.parentId) return focused ? [focused] : [];
    return workspace.navigatorNodes
      .filter((node) => node.parentId === focused?.parentId && !nodeArchived(node))
      .sort((left, right) => left.order - right.order);
  }

  async function navigateHistory(direction: 'back' | 'forward'): Promise<void> {
    const id = direction === 'back' ? workspace.navigatorBackId : workspace.navigatorForwardId;
    if (id) await onOpenNode(id, direction);
  }

  function suggestedSingular(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/ies$/i.test(trimmed)) return `${trimmed.slice(0, -3)}y`;
    if (/(sses|shes|ches|xes|zes)$/i.test(trimmed)) return trimmed.slice(0, -2);
    if (/s$/i.test(trimmed) && !/(ss|us|is)$/i.test(trimmed)) return trimmed.slice(0, -1);
    return trimmed;
  }

  function updateCollectionName(value: string): void {
    collectionName = value;
    if (!singularEdited) singularName = suggestedSingular(value);
  }

  function resetCollectionForm(): void {
    collectionName = '';
    singularName = '';
    singularEdited = false;
    collectionIcon = 'folder';
    numberingEnabled = false;
    numberingStart = 1;
    collectionFormOpen = false;
  }

  function collectionExists(name: string): boolean {
    return workspace.navigator.collections.some((collection) => sameCollectionName(collection.name, name));
  }

  function setTemplateExists(itemId: string): boolean {
    const template = collectionSets.flatMap((set) => set.items).find((item) => item.id === itemId);
    return template ? collectionExists(template.name) : false;
  }

  function draftNameConflict(itemId: string): boolean {
    const draft = setDrafts[itemId];
    if (!draft?.selected) return false;
    if (collectionExists(draft.name)) return true;
    return Object.values(setDrafts).some((candidate) =>
      candidate.id !== itemId && candidate.selected && sameCollectionName(candidate.name, draft.name));
  }

  function resetSetSelection(): void {
    setDrafts = collectionSetDrafts();
    expandedSetIds = [];
  }

  function openCollectionManager(
    purpose: 'manage' | 'create-child' | 'proactive' = 'manage',
    collection?: CollectionDefinition
  ): void {
    collectionManagerPurpose = purpose;
    collectionManagerOpen = true;
    collectionFormOpen = false;
    editingCollectionId = null;
    deletingCollectionId = null;
    resetSetSelection();
    if (collection) beginCollectionEdit(collection);
  }

  function closeCollectionManager(): void {
    collectionManagerOpen = false;
    collectionFormOpen = false;
    editingCollectionId = null;
    deletingCollectionId = null;
  }

  function setExpanded(setId: string, expanded: boolean): void {
    expandedSetIds = expanded
      ? [...new Set([...expandedSetIds, setId])]
      : expandedSetIds.filter((id) => id !== setId);
  }

  function toggleSetSelection(setId: string, selected: boolean): void {
    const set = collectionSets.find((candidate) => candidate.id === setId);
    if (!set) return;
    setDrafts = { ...setDrafts };
    for (const item of set.items) {
      const draft = setDrafts[item.id];
      if (draft && !setTemplateExists(item.id)) setDrafts[item.id] = { ...draft, selected };
    }
    if (selected) setExpanded(setId, true);
  }

  function updateSetDraft(itemId: string, update: Partial<CollectionSetDraft>): void {
    const current = setDrafts[itemId];
    if (current) setDrafts = { ...setDrafts, [itemId]: { ...current, ...update } };
  }

  function setSelectionState(setId: string): { checked: boolean; indeterminate: boolean; disabled: boolean } {
    const set = collectionSets.find((candidate) => candidate.id === setId);
    const available = set?.items.map((item) => setDrafts[item.id]).filter((item) => item && !setTemplateExists(item.id)) ?? [];
    const selected = available.filter((item) => item.selected).length;
    return { checked: Boolean(available.length) && selected === available.length, indeterminate: selected > 0 && selected < available.length, disabled: !available.length };
  }

  async function addCollection(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const created = await workspace.recordNavigatorChange(`Create ${collectionName.trim()} material type`, () => workspace.createCollection({
      name: collectionName,
      singularName,
      icon: collectionIcon,
      numbering: { enabled: numberingEnabled, start: Math.trunc(numberingStart) }
    }));
    if (!created) return;
    if (collectionManagerPurpose === 'create-child' || workspace.navigatorMemory.mode === 'context') childCollection = created.id;
    resetCollectionForm();
    closeCollectionManager();
  }

  async function applyCollectionSets(): Promise<void> {
    if (!selectedSetItemCount || selectedSetHasErrors || applyingSets) return;
    applyingSets = true;
    let firstCreatedId = '';
    await workspace.recordNavigatorChange('Add Material set', async () => {
      for (const item of Object.values(setDrafts).filter((draft) => draft.selected)) {
        if (collectionExists(item.name)) continue;
        const created = await workspace.createCollection({
          name: item.name,
          singularName: item.singularName,
          icon: item.icon,
          numbering: { ...item.numbering }
        });
        if (created && !firstCreatedId) firstCreatedId = created.id;
      }
    });
    applyingSets = false;
    if (firstCreatedId && collectionManagerPurpose === 'create-child') childCollection = firstCreatedId;
    if (firstCreatedId) closeCollectionManager();
  }

  function beginCollectionEdit(collection: CollectionDefinition): void {
    editingCollectionId = collection.id;
    deletingCollectionId = null;
    editCollectionName = collection.name;
    editSingularName = collection.singularName;
    editCollectionIcon = collection.icon;
    editNumberingEnabled = collection.numbering.enabled;
    editNumberingStart = collection.numbering.start;
  }

  async function saveCollectionEdit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!editingCollectionId) return;
    await workspace.recordNavigatorChange(`Update ${editCollectionName.trim()} material type`, () => workspace.updateCollection(editingCollectionId!, {
      name: editCollectionName,
      singularName: editSingularName,
      icon: editCollectionIcon,
      numbering: { enabled: editNumberingEnabled, start: Math.trunc(editNumberingStart) }
    }));
    editingCollectionId = null;
  }

  async function deleteCollection(collection: CollectionDefinition): Promise<void> {
    if (deletingCollectionId !== collection.id) {
      deletingCollectionId = collection.id;
      return;
    }
    if (workspace.branchId === collection.id && workspace.spineNode) await onOpenNode(workspace.spineNode.id);
    await workspace.recordNavigatorChange(`Delete ${collection.name} material type`, () => workspace.deleteCollection(collection.id));
    if (editingCollectionId === collection.id) editingCollectionId = null;
    deletingCollectionId = null;
  }

  async function addTodo(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const title = todoDraft.trim();
    const created = await workspace.recordNavigatorChange(`Create Todo: ${title}`, () => workspace.createNavigatorTodo(title));
    if (!created) return;
    todoDraft = '';
    addKind = null;
    addMenuOpen = false;
    await onOpenNode(created.id);
  }

  async function toggleTodo(id: string, title: string): Promise<void> {
    await workspace.recordNavigatorChange(`Update Todo: ${title}`, () => workspace.toggleNavigatorTodo(id));
  }

  async function addChild(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!focused) return;
    const collection = workspace.navigator.collections.find((item) => item.id === childCollection);
    const created = await workspace.recordNavigatorChange(`Create ${collection?.singularName ?? 'material'}`, () => workspace.createNavigatorNode(childCollection, childTitle, focused.id));
    if (!created) return;
    workspace.setNavigatorExpanded(`node:${focused.id}`, true, 'context');
    workspace.setNavigatorExpanded(`node:${focused.id}`, true, 'traditional');
    childTitle = '';
    addKind = null;
    addMenuOpen = false;
  }

  function startDrag(event: DragEvent, kind: 'collection' | 'node', id: string): void {
    dragged = { kind, id };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${kind}:${id}`);
    }
  }

  function allowDrop(event: DragEvent): void {
    if (!dragged) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  function markNodeDrop(event: DragEvent, nodeId: string): void {
    if (!dragged || dragged.kind !== 'node' || dragged.id === nodeId) return;
    event.preventDefault();
    const box = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
    const placement = box && event.clientY < box.top + box.height * 0.28 ? 'before' : 'inside';
    dropTarget = { nodeId, placement };
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }

  async function dropOnCollection(event: DragEvent, collection: CollectionDefinition): Promise<void> {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (!moving) return;
    if (moving.kind === 'collection') {
      await workspace.recordNavigatorChange('Reorder Material types', () => workspace.moveCollection(moving.id, collection.id));
      return;
    }
    const node = workspace.navigatorNodes.find((candidate) => candidate.id === moving.id);
    if (!node || nodeCollectionId(node) !== collection.id) {
      workspace.notice = 'Dragging does not convert an item into another Material type.';
      return;
    }
    await workspace.recordNavigatorChange('Move item to Material root', () => workspace.moveNavigatorNode(moving.id, { parentId: collection.id }));
  }

  async function dropOnNode(event: DragEvent, node: WorkspaceDocument): Promise<void> {
    event.preventDefault();
    const moving = dragged;
    const placement = dropTarget?.nodeId === node.id ? dropTarget.placement : 'inside';
    dragged = null;
    dropTarget = null;
    if (!moving || moving.kind !== 'node') return;
    if (placement === 'before' && node.parentId) {
      await workspace.recordNavigatorChange(`Move material before ${workspace.navigatorNodeLabel(node)}`, () => workspace.moveNavigatorNode(moving.id, { parentId: node.parentId!, beforeNodeId: node.id }));
      return;
    }
    await workspace.recordNavigatorChange(`Move material inside ${workspace.navigatorNodeLabel(node)}`, () => workspace.moveNavigatorNode(moving.id, { parentId: node.id }));
  }

  function toggleRemoval(kind: 'node' | 'todo' | 'relationship', id: string, checked: boolean): void {
    const current = kind === 'node' ? removeNodeIds : kind === 'todo' ? removeTodoIds : removeRelationshipIds;
    const next = checked ? [...new Set([...current, id])] : current.filter((item) => item !== id);
    if (kind === 'node') removeNodeIds = next;
    else if (kind === 'todo') removeTodoIds = next;
    else removeRelationshipIds = next;
    removalConfirm = false;
  }

  function closeRemovalMode(): void {
    removalMode = false;
    removalConfirm = false;
    removeNodeIds = [];
    removeTodoIds = [];
    removeRelationshipIds = [];
  }

  async function removeSelectedEntries(): Promise<void> {
    if (!removalCount) return;
    if (!removalConfirm) {
      removalConfirm = true;
      return;
    }
    await workspace.recordNavigatorChange(`Remove ${removalCount} Navigator ${removalCount === 1 ? 'entry' : 'entries'}`, () => workspace.removeNavigatorEntries({
      nodeIds: removeNodeIds,
      todoIds: removeTodoIds,
      relationshipIds: removeRelationshipIds
    }));
    closeRemovalMode();
  }
</script>

{#snippet nodeRow(node: WorkspaceDocument, depth = 0)}
  {@const children = childrenOf(node.id)}
  {@const key = `node:${node.id}`}
  {@const label = workspace.navigatorNodeLabel(node)}
  <div role="treeitem" tabindex="-1" aria-selected={node.id === workspace.branchId} class="navigator-node" class:selected={node.id === workspace.branchId} class:dragging={dragged?.id === node.id} class:drop-before={dropTarget?.nodeId === node.id && dropTarget.placement === 'before'} class:drop-inside={dropTarget?.nodeId === node.id && dropTarget.placement === 'inside'} data-drop-label={dropTarget?.nodeId === node.id ? dropTarget.placement === 'before' ? `Insert before ${label}` : `Place inside ${label}` : undefined} style={`--depth:${depth}`} ondragover={(event) => markNodeDrop(event, node.id)} ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropTarget = null; }} ondrop={(event) => dropOnNode(event, node)}>
    <button class="drag-handle" draggable="true" aria-label={`Move ${label}`} title={`Move ${label}`} ondragstart={(event) => startDrag(event, 'node', node.id)} ondragend={() => { dragged = null; dropTarget = null; }}>⠿</button>
    {#if children.length}
      <button class="disclosure" title={`${workspace.navigatorExpanded(key) ? 'Collapse' : 'Expand'} ${label}`} aria-label={`${workspace.navigatorExpanded(key) ? 'Collapse' : 'Expand'} ${label}`} onclick={() => workspace.toggleNavigatorExpanded(key)}>{workspace.navigatorExpanded(key) ? '⌄' : '›'}</button>
    {:else}
      <span class="disclosure placeholder"></span>
    {/if}
    <span class="structural-icon" title={node.role === 'spine' ? 'Project Spine' : 'Document'} aria-hidden="true">{node.role === 'spine' ? '▥' : '▤'}</span>
    <button class="node-link" onclick={() => onOpenNode(node.id)} title={`${label} · ${workspace.navigatorNodeType(node)}`}><span>{label}</span><small>{workspace.navigatorNodeType(node)}</small></button>
  </div>
  {#if children.length && workspace.navigatorExpanded(key)}
    {#each children as child (child.id)}{@render nodeRow(child, depth + 1)}{/each}
  {/if}
{/snippet}

{#snippet contextTodoRow(todo: (typeof workspace.navigator.todos)[number], depth = 1)}
  <div class="context-entry todo-entry" class:done={todo.state === 'done'} style={`--context-depth:${depth}`}>
    {#if removalMode}<input type="checkbox" aria-label={`Remove Todo ${todo.title}`} checked={removeTodoIds.includes(todo.id)} onchange={(event) => toggleRemoval('todo', todo.id, event.currentTarget.checked)} />{/if}
    <span class="context-entry-icon" aria-hidden="true">☑</span>
    <button onclick={() => onOpenNode(todo.id)}><span>{todo.title}</span><small>Todo</small></button>
    <input class="todo-complete" aria-label={`${todo.state === 'done' ? 'Reopen' : 'Complete'} ${todo.title}`} type="checkbox" checked={todo.state === 'done'} onchange={() => toggleTodo(todo.id, todo.title)} />
  </div>
{/snippet}

{#snippet contextRelationshipRow(relation: { node: WorkspaceDocument; label: string; relationshipId: string }, depth = 1)}
  <div class="context-entry relationship-entry" style={`--context-depth:${depth}`}>
    {#if removalMode}<input type="checkbox" aria-label={`Remove relationship ${relation.label} ${workspace.navigatorNodeLabel(relation.node)}`} checked={removeRelationshipIds.includes(relation.relationshipId)} onchange={(event) => toggleRemoval('relationship', relation.relationshipId, event.currentTarget.checked)} />{/if}
    <span class="context-entry-icon" aria-hidden="true">↗</span>
    <button onclick={() => onOpenNode(relation.node.id)}><span>{workspace.navigatorNodeLabel(relation.node)}</span><small>{relation.label}</small></button>
    {#if hasPreview(relation.node, [focused?.id ?? '', relation.node.id])}
      <button class="context-expander" aria-label={`${workspace.navigatorExpanded(`context:preview:${relation.node.id}`, 'context') ? 'Contract' : 'Expand'} ${workspace.navigatorNodeLabel(relation.node)}`} onclick={() => workspace.setNavigatorExpanded(`context:preview:${relation.node.id}`, !workspace.navigatorExpanded(`context:preview:${relation.node.id}`, 'context'), 'context')}>{workspace.navigatorExpanded(`context:preview:${relation.node.id}`, 'context') ? '⌄' : '›'}</button>
    {/if}
  </div>
  {#if workspace.navigatorExpanded(`context:preview:${relation.node.id}`, 'context')}
    {@render contextPreviewGroups(relation.node, depth + 1, [focused?.id ?? '', relation.node.id])}
  {/if}
{/snippet}

{#snippet contextMaterialRow(node: WorkspaceDocument, depth = 1, path: string[] = [], forced = false)}
  {@const key = `context:preview:${node.id}`}
  {@const expanded = forced || workspace.navigatorExpanded(key, 'context')}
  {@const label = workspace.navigatorNodeLabel(node)}
  <div role="listitem" class="context-entry material-entry" class:drop-before={dropTarget?.nodeId === node.id && dropTarget.placement === 'before'} class:drop-inside={dropTarget?.nodeId === node.id && dropTarget.placement === 'inside'} data-drop-label={dropTarget?.nodeId === node.id ? dropTarget.placement === 'before' ? `Insert before ${label}` : `Place inside ${label}` : undefined} style={`--context-depth:${depth}`} ondragover={(event) => markNodeDrop(event, node.id)} ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropTarget = null; }} ondrop={(event) => dropOnNode(event, node)}>
    {#if removalMode}<input type="checkbox" aria-label={`Remove material ${label}`} checked={removeNodeIds.includes(node.id)} onchange={(event) => toggleRemoval('node', node.id, event.currentTarget.checked)} />{/if}
    <button class="context-drag" draggable="true" aria-label={`Move ${label}`} title={`Move ${label}`} ondragstart={(event) => startDrag(event, 'node', node.id)} ondragend={() => { dragged = null; dropTarget = null; }}>⠿</button>
    <span class="context-entry-icon" aria-hidden="true">▤</span>
    <button onclick={() => onOpenNode(node.id)}><span>{label}</span><small>{workspace.navigatorNodeType(node)}</small></button>
    {#if !forced && hasPreview(node, [...path, node.id])}
      <button class="context-expander" aria-label={`${expanded ? 'Contract' : 'Expand'} ${label}`} onclick={() => workspace.setNavigatorExpanded(key, !workspace.navigatorExpanded(key, 'context'), 'context')}>{expanded ? '⌄' : '›'}</button>
    {/if}
  </div>
  {#if expanded}{@render contextPreviewGroups(node, depth + 1, [...path, node.id])}{/if}
{/snippet}

{#snippet contextPreviewGroups(node: WorkspaceDocument, depth: number, path: string[])}
  {@const material = previewChildren(node, path)}
  {@const todos = previewTodos(node)}
  {@const relations = previewRelations(node, path)}
  <div class="context-preview" style={`--context-depth:${depth}`}>
    {#if material.length}<div class="preview-label">Material</div>{#each material as child (child.id)}{@render contextMaterialRow(child, depth, path)}{/each}{/if}
    {#if todos.length}<div class="preview-label">Todos</div>{#each todos as todo (todo.id)}{@render contextTodoRow(todo, depth)}{/each}{/if}
    {#if relations.length}<div class="preview-label">Relationships</div>{#each relations as relation (relation.relationshipId)}{@render contextRelationshipRow(relation, depth)}{/each}{/if}
  </div>
{/snippet}

{#snippet collectionCreationForm()}
  <form class="collection-form" onsubmit={addCollection}>
    <label>Material type <span>plural — e.g. Characters, Chapters, Locations</span><input aria-label="Material type name (plural)" placeholder="Characters, Chapters, Locations…" value={collectionName} oninput={(event) => updateCollectionName(event.currentTarget.value)} /></label>
    <label>Singular item name <input aria-label="Singular item name" placeholder="Character" value={singularName} oninput={(event) => { singularEdited = true; singularName = event.currentTarget.value; }} /></label>
    <label>Icon <select aria-label="Material type icon" bind:value={collectionIcon}><option value="folder">Folder</option><option value="file">File</option><option value="link">Link</option><option value="todo">Todo</option><option value="none">None</option></select></label>
    <label class="numbering"><input type="checkbox" bind:checked={numberingEnabled} /> Number items</label>
    {#if numberingEnabled}<label>Start number <input aria-label="Start number" type="number" step="1" bind:value={numberingStart} /></label>{/if}
    <div><button type="button" onclick={resetCollectionForm}>Cancel</button><button class="primary" disabled={!collectionName.trim() || !singularName.trim()}>Create Material type</button></div>
  </form>
{/snippet}

{#snippet todoSection()}
  <section class="todo-section">
    <div class="section-heading">
      <span class="drag-handle placeholder"></span>
      <button class="disclosure" title={`${workspace.navigatorExpanded('fixed:todos') ? 'Collapse' : 'Expand'} Todos`} aria-label={`${workspace.navigatorExpanded('fixed:todos') ? 'Collapse' : 'Expand'} Todos`} onclick={() => workspace.toggleNavigatorExpanded('fixed:todos')}>{workspace.navigatorExpanded('fixed:todos') ? '⌄' : '›'}</button>
      <span class="structural-icon" title="Todo list" aria-hidden="true">☑</span>
      <button class="heading-label" title="About Todos" onclick={() => helpTopic = 'todos'}>Todos <em>{workspace.navigator.todos.filter((todo) => todo.state === 'open').length}</em></button>
    </div>
    {#if workspace.navigatorExpanded('fixed:todos')}
      <div class="todo-list">
        {#each workspace.navigator.todos as todo (todo.id)}
          <div class="navigator-node todo-row" class:selected={workspace.branchId === todo.id} class:done={todo.state === 'done'}>
            <span class="drag-handle placeholder"></span>
            <span class="todo-checkbox"><input aria-label={`${todo.state === 'done' ? 'Reopen' : 'Complete'} ${todo.title}`} title={`${todo.state === 'done' ? 'Mark open' : 'Mark done'} — ${todo.title}`} type="checkbox" checked={todo.state === 'done'} onchange={() => toggleTodo(todo.id, todo.title)} /></span>
            <span class="structural-icon" title="Todo document" aria-hidden="true">▤</span>
            <button class="node-link todo-link" title={`Open ${todo.title}`} onclick={() => onOpenNode(todo.id)}><span>{todo.title}</span><small title={`Applies to ${targetLabels(todo.targetNodeIds)}`}>{targetLabels(todo.targetNodeIds)}</small></button>
          </div>
        {/each}
        {#if !workspace.navigator.todos.length}<p class="empty">No work recorded yet.</p>{/if}
        <form class="quick-add" onsubmit={addTodo}>
          <input aria-label="New Todo" placeholder={current ? `Todo for ${workspace.navigatorNodeLabel(current)}` : 'New Todo'} bind:value={todoDraft} />
          <button disabled={!todoDraft.trim()} aria-label="Add Todo" title="Create and open a new Todo">+</button>
        </form>
      </div>
    {/if}
  </section>
{/snippet}

<nav class="navigator" aria-label="Project Navigator">
  <header class="navigator-header">
    <div class="navigator-title">
      <strong>Navigator</strong>
      <div class="navigator-history" aria-label="Navigator undo and redo">
        <button disabled={!workspace.canUndoNavigator} title={workspace.navigatorUndoLabel ? `Undo: ${workspace.navigatorUndoLabel}` : 'Nothing to undo in the Navigator'} aria-label={workspace.navigatorUndoLabel ? `Undo ${workspace.navigatorUndoLabel}` : 'Navigator Undo'} onclick={() => workspace.undoNavigator()}>⟲</button>
        <button disabled={!workspace.canRedoNavigator} title={workspace.navigatorRedoLabel ? `Redo: ${workspace.navigatorRedoLabel}` : 'Nothing to redo in the Navigator'} aria-label={workspace.navigatorRedoLabel ? `Redo ${workspace.navigatorRedoLabel}` : 'Navigator Redo'} onclick={() => workspace.redoNavigator()}>⟳</button>
      </div>
    </div>
    <div class="project-control">
      <select value={workspace.projectId} onchange={(event) => onSwitchProject(event.currentTarget.value)} aria-label="Project">
        {#each workspace.projects as project}<option value={project.id}>{project.title}</option>{/each}
      </select>
      <details class="project-menu">
        <summary aria-label="Project actions" title="Project actions">•••</summary>
        <div>
          <button type="button" onclick={(event) => runProjectAction(event, onCreateProject)}>Create project</button>
          <button type="button" onclick={(event) => runProjectAction(event, onRenameProject)}>Rename project</button>
          <button type="button" class="danger" onclick={(event) => runProjectAction(event, onResetProject)}>Start over</button>
        </div>
      </details>
    </div>
    <div class="navigator-controls">
      <div class="history-controls" aria-label="Navigator history">
        <button disabled={!workspace.navigatorBackId} title="Back to the previous Navigator focus" aria-label="Back" onclick={() => navigateHistory('back')}>‹</button>
        <button disabled={!workspace.navigatorForwardId} title="Forward to the next Navigator focus" aria-label="Forward" onclick={() => navigateHistory('forward')}>›</button>
      </div>
      <div class="mode-switch" aria-label="Navigator view">
        <button title="Show the stable project structure" class:active={workspace.navigatorMemory.mode === 'traditional'} onclick={() => workspace.setNavigatorMode('traditional')}>Traditional</button>
        <button title="Show the current structural neighbourhood" class:active={workspace.navigatorMemory.mode === 'context'} onclick={() => workspace.setNavigatorMode('context')}>Context</button>
      </div>
    </div>
  </header>

  <div class="navigator-scroll">
    {#if workspace.navigatorMemory.mode === 'traditional' && workspace.spineNode}<section class="fixed-section"><div class="spine-row">{@render nodeRow(workspace.spineNode)}</div></section>{/if}

    {#if workspace.navigatorMemory.mode === 'traditional'}
      <div class="collection-list">
        <div class="collection-group-header">
          <button class="group-title" title="About Material" onclick={() => helpTopic = 'collections'}><span>Material</span><span aria-hidden="true">?</span></button>
          <button class="manage-collections" title="Manage Material" aria-label="Manage Material" onclick={() => openCollectionManager()}>•••</button>
        </div>
        {#each [...workspace.navigator.collections].sort((a, b) => a.order - b.order) as collection (collection.id)}
          {@const collectionKey = `collection:${collection.id}`}
          {@const roots = rootsForCollection(collection.id)}
          {@const members = workspace.navigatorNodes.filter((node) => nodeCollectionId(node) === collection.id && !nodeArchived(node))}
          <section role="group" class="collection" class:dragging={dragged?.id === collection.id} ondragover={allowDrop} ondrop={(event) => dropOnCollection(event, collection)}>
            <div class="section-heading" class:selected={workspace.branchId === collection.id}>
              <button class="drag-handle" draggable="true" aria-label={`Move ${collection.name}`} title="Move Material type" ondragstart={(event) => startDrag(event, 'collection', collection.id)} ondragend={() => dragged = null}>⠿</button>
              <button class="disclosure" title={`${workspace.navigatorExpanded(collectionKey) ? 'Collapse' : 'Expand'} ${collection.name}`} aria-label={`${workspace.navigatorExpanded(collectionKey) ? 'Collapse' : 'Expand'} ${collection.name}`} onclick={() => workspace.toggleNavigatorExpanded(collectionKey)}>{workspace.navigatorExpanded(collectionKey) ? '⌄' : '›'}</button>
              <span class="structural-icon" title={`${collection.icon === 'none' ? 'Material type' : `${collection.icon} Material type`}`} aria-hidden="true">{collection.icon === 'none' ? '·' : iconGlyphs[collection.icon]}</span>
              <button class="heading-label collection-link" title={`Open ${collection.name}`} onclick={() => onOpenNode(collection.id)}>{collection.name} <em>{members.length}</em></button>
              <button class="collection-action" aria-label={`Manage ${collection.name}`} title="Manage Material type" onclick={() => openCollectionManager('manage', collection)}>•••</button>
            </div>
            {#if workspace.navigatorExpanded(collectionKey)}
              <div class="collection-contents">
                {#each roots as node (node.id)}{@render nodeRow(node, 1)}{/each}
              </div>
            {/if}
          </section>
        {/each}

        <button class="new-collection" title="Create or manage Material" onclick={() => openCollectionManager()}><span aria-hidden="true">＋</span> Manage Material…</button>
        <button class="new-collection" title="Manage writing relationship vocabulary and links" onclick={() => relationshipManagerOpen = true}><span aria-hidden="true">↗</span> Manage Relationships…</button>
      </div>
    {:else}
      <div class="context-view">
        {#if focused}
          {@const peers = contextPeers()}
          {@const peerIndex = peers.findIndex((node) => node.id === focused.id)}
          {@const cascadeKey = `context:cascade:${focused.id}`}
          {@const cascadeExpanded = workspace.navigatorExpanded(cascadeKey, 'context')}
          <div class="context-navigation">
            <div class="context-breadcrumb">
              {#each workspace.selectedNodeAncestors as ancestor (ancestor.id)}<button onclick={() => onOpenNode(ancestor.id)}>{workspace.navigatorNodeLabel(ancestor)}</button><span>/</span>{/each}
              <strong>{workspace.navigatorNodeType(focused)}</strong>
            </div>
            {#if peers.length > 1}<div class="peer-navigation"><button disabled={peerIndex <= 0} aria-label="Previous sibling" title={peerIndex > 0 ? `Previous: ${workspace.navigatorNodeLabel(peers[peerIndex - 1])}` : 'No previous sibling'} onclick={() => peerIndex > 0 && onOpenNode(peers[peerIndex - 1].id)}>‹</button><span>{peerIndex + 1} of {peers.length}</span><button disabled={peerIndex >= peers.length - 1} aria-label="Next sibling" title={peerIndex < peers.length - 1 ? `Next: ${workspace.navigatorNodeLabel(peers[peerIndex + 1])}` : 'No next sibling'} onclick={() => peerIndex < peers.length - 1 && onOpenNode(peers[peerIndex + 1].id)}>›</button></div>{/if}
          </div>

          <section class="selected-context">
            <div class="context-label">Selected</div>
            <div class="selected-row">
              <span class="context-entry-icon" aria-hidden="true">{focused.role === 'spine' ? '▥' : '▤'}</span>
              <div><strong>{workspace.navigatorNodeLabel(focused)}</strong><small>{workspace.navigatorNodeType(focused)}</small></div>
              {#if workspace.selectedNodeChildren.some((child) => hasPreview(child, [focused.id, child.id]))}
                <button class="context-expander" aria-label={`${cascadeExpanded ? 'Contract' : 'Expand'} material beneath ${workspace.navigatorNodeLabel(focused)}`} onclick={() => workspace.setNavigatorExpanded(cascadeKey, !cascadeExpanded, 'context')}>{cascadeExpanded ? '⌄' : '›'}</button>
              {/if}
            </div>

            <div class="selected-attachments">
              {#each workspace.selectedNodeChildren as node (node.id)}{@render contextMaterialRow(node, 1, [focused.id], cascadeExpanded)}{/each}
              {#if !workspace.selectedNodeChildren.length}<p class="context-empty-entry">No material attached.</p>{/if}

              <div class="context-divider"></div>
              <div class="attachment-heading">Todos <em>{workspace.selectedNodeTodos.filter((todo) => todo.state === 'open').length}</em></div>
              {#each workspace.selectedNodeTodos as todo (todo.id)}{@render contextTodoRow(todo, 1)}{/each}
              {#if !workspace.selectedNodeTodos.length}<p class="context-empty-entry">No Todos attached.</p>{/if}

              <div class="context-divider"></div>
              <div class="attachment-heading">Relationships <em>{workspace.selectedNodeRelations.length}</em></div>
              {#each workspace.selectedNodeRelations as relation (relation.relationshipId)}{@render contextRelationshipRow(relation, 1)}{/each}
              {#if !workspace.selectedNodeRelations.length}<p class="context-empty-entry">No confirmed relationships.</p>{/if}

              <div class="context-divider"></div>
              <div class="context-actions">
                {#if removalMode}
                  <button type="button" onclick={closeRemovalMode}>Cancel</button>
                  <button type="button" class="danger" disabled={!removalCount} onclick={removeSelectedEntries}>{removalConfirm ? `Confirm removal of ${removalCount}` : `Remove ${removalCount || ''} selected`}</button>
                {:else}
                  <button type="button" class="context-add" onclick={() => { addMenuOpen = !addMenuOpen; addKind = null; }}>＋ Add…</button>
                  <button type="button" class="context-remove" aria-label="Remove Navigator entries" title="Select material, Todos, or relationships to remove" onclick={() => { removalMode = true; addMenuOpen = false; addKind = null; }}>−</button>
                {/if}
              </div>

              {#if addMenuOpen && !removalMode}
                <div class="add-panel">
                  <div class="add-kind-choices"><button class:active={addKind === 'material'} onclick={() => addKind = 'material'}>Material</button><button class:active={addKind === 'todo'} onclick={() => addKind = 'todo'}>Todo</button><button onclick={() => { relationshipManagerOpen = true; addKind = null; addMenuOpen = false; }}>Relationship</button></div>
                  {#if addKind === 'material'}
                    <form class="relation-form" onsubmit={addChild}><label>Material type<select aria-label="Child material type" bind:value={childCollection}><option value="">Choose a Material type</option>{#each workspace.navigator.collections as collection}<option value={collection.id}>{collection.singularName}</option>{/each}</select></label><label>Optional title<input aria-label="Child title" placeholder="Title (optional when numbered)" bind:value={childTitle} /></label><div class="create-within-actions"><button type="button" onclick={() => openCollectionManager('create-child')}>Manage Material…</button><span></span><button class="primary" disabled={!childCollection}>Create {workspace.navigator.collections.find((collection) => collection.id === childCollection)?.singularName ?? 'material'}</button></div></form>
                  {:else if addKind === 'todo'}
                    <form class="relation-form" onsubmit={addTodo}><label>Todo<input aria-label="New contextual Todo" placeholder={`Todo for ${workspace.navigatorNodeLabel(focused)}`} bind:value={todoDraft} /></label><div><button class="primary" disabled={!todoDraft.trim()}>Create Todo</button></div></form>
                  {/if}
                </div>
              {/if}

              {#if removalConfirm}<p class="removal-warning">Remove the selected entries? Material moves to Archived/Unowned with its nested material, Todos are removed, and relationships are unlinked. Navigator Undo will restore the complete operation.</p>{/if}
            </div>
          </section>
        {:else}
          <p class="empty context-empty">Select a structural item to establish a Navigator selection.</p>
        {/if}
      </div>
    {/if}

    {#if workspace.navigatorMemory.mode === 'traditional'}{@render todoSection()}{/if}

    {#if workspace.navigatorMemory.mode === 'traditional'}<section class="archive-section">
      <div class="section-heading"><span class="drag-handle placeholder"></span><button class="disclosure" title={`${workspace.navigatorExpanded('fixed:archive') ? 'Collapse' : 'Expand'} Archived/Unowned`} aria-label={`${workspace.navigatorExpanded('fixed:archive') ? 'Collapse' : 'Expand'} Archived/Unowned`} onclick={() => workspace.toggleNavigatorExpanded('fixed:archive')}>{workspace.navigatorExpanded('fixed:archive') ? '⌄' : '›'}</button><span class="structural-icon" title="Recovery area" aria-hidden="true">⌁</span><button class="heading-label" title="About Archived/Unowned" onclick={() => helpTopic = 'archived'}>Archived/Unowned <em>{workspace.archivedOrUnownedNodes.length}</em></button></div>
      {#if workspace.navigatorExpanded('fixed:archive')}
        {#each workspace.archivedOrUnownedNodes as node (node.id)}{@render nodeRow(node)}{/each}
        {#if !workspace.archivedOrUnownedNodes.length}<p class="empty">Nothing archived or without an owner.</p>{/if}
      {/if}
    </section>{/if}
  </div>
</nav>

{#if collectionManagerOpen}
  <div class="collection-manager-backdrop" role="presentation" onclick={closeCollectionManager}>
    <div class="collection-manager" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="collection-manager-title" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') closeCollectionManager(); }}>
      <header>
        <div>
          <small>Navigator</small>
          <h2 id="collection-manager-title">Manage Material</h2>
        </div>
        <button type="button" class="manager-close" title="Close Material Manager" aria-label="Close Material Manager" onclick={closeCollectionManager}>×</button>
      </header>

      {#if collectionManagerPurpose === 'proactive'}
        <div class="collection-welcome">
          <strong>Build your project</strong>
          <p>This project has no Material types yet. Start with a Material set or create your own. Nothing here creates sample content.</p>
        </div>
      {/if}

      <section class="manager-section collection-sets">
        <div class="manager-section-heading">
          <div><h3>Material sets</h3><p>Select a complete set, then adjust or remove individual Material types.</p></div>
          <button type="button" onclick={() => collectionFormOpen = !collectionFormOpen}>{collectionFormOpen ? 'Hide custom form' : 'Create custom Material type'}</button>
        </div>

        {#if collectionFormOpen}{@render collectionCreationForm()}{/if}

        <div class="set-list">
          {#each collectionSets as set (set.id)}
            {@const selection = setSelectionState(set.id)}
            {@const expanded = expandedSetIds.includes(set.id)}
            <section class="collection-set">
              <div class="set-heading">
                <button type="button" class="set-disclosure" title={`${expanded ? 'Collapse' : 'Expand'} ${set.name}`} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${set.name}`} onclick={() => setExpanded(set.id, !expanded)}>{expanded ? '⌄' : '›'}</button>
                <input
                  type="checkbox"
                  aria-label={`Select all Material types in ${set.name}`}
                  checked={selection.checked}
                  indeterminate={selection.indeterminate}
                  disabled={selection.disabled}
                  onchange={(event) => toggleSetSelection(set.id, event.currentTarget.checked)}
                />
                <button type="button" class="set-title" onclick={() => setExpanded(set.id, !expanded)}><strong>{set.name}</strong><span>{set.description}</span></button>
                <small>{set.items.length}</small>
              </div>
              {#if expanded}
                <div class="set-items">
                  {#each set.items as template (template.id)}
                    {@const draft = setDrafts[template.id]}
                    {@const exists = setTemplateExists(template.id)}
                    {@const conflict = !exists && draftNameConflict(template.id)}
                    <div class="set-item" class:existing={exists} class:conflict>
                      <input type="checkbox" aria-label={`Add ${draft.name}`} checked={draft.selected} disabled={exists} onchange={(event) => updateSetDraft(template.id, { selected: event.currentTarget.checked })} />
                      <label>Plural name<input aria-label={`${set.name} ${template.name} plural name`} value={draft.name} disabled={!draft.selected || exists} oninput={(event) => updateSetDraft(template.id, { name: event.currentTarget.value })} /></label>
                      <label>Singular name<input aria-label={`${set.name} ${template.name} singular name`} value={draft.singularName} disabled={!draft.selected || exists} oninput={(event) => updateSetDraft(template.id, { singularName: event.currentTarget.value })} /></label>
                      <label>Icon<select aria-label={`${set.name} ${template.name} icon`} value={draft.icon} disabled={!draft.selected || exists} onchange={(event) => updateSetDraft(template.id, { icon: event.currentTarget.value as CollectionDefinition['icon'] })}><option value="folder">Folder</option><option value="file">File</option><option value="link">Link</option><option value="todo">Todo</option><option value="none">None</option></select></label>
                      <label class="set-numbering"><input type="checkbox" checked={draft.numbering.enabled} disabled={!draft.selected || exists} onchange={(event) => updateSetDraft(template.id, { numbering: { ...draft.numbering, enabled: event.currentTarget.checked } })} /> Number</label>
                      {#if draft.numbering.enabled}<label>Start<input aria-label={`${set.name} ${template.name} start number`} type="number" min="0" step="1" value={draft.numbering.start} disabled={!draft.selected || exists} oninput={(event) => updateSetDraft(template.id, { numbering: { ...draft.numbering, start: Math.trunc(Number(event.currentTarget.value)) } })} /></label>{/if}
                      {#if exists}<span class="already-added">Already added</span>{:else if conflict}<span class="name-conflict">Name already in use</span>{/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </section>
          {/each}
        </div>
      </section>

      {#if workspace.navigator.collections.length}
        <section class="manager-section existing-collections">
          <div class="manager-section-heading"><div><h3>Existing Material types</h3><p>Edit their presentation or safely remove a Material type.</p></div></div>
          {#each [...workspace.navigator.collections].sort((a, b) => a.order - b.order) as collection (collection.id)}
            <div class="existing-collection-row">
              <span class="structural-icon" aria-hidden="true">{collection.icon === 'none' ? '·' : iconGlyphs[collection.icon]}</span>
              <strong>{collection.name}</strong>
              <small>{collection.singularName}</small>
              <button type="button" onclick={() => editingCollectionId === collection.id ? editingCollectionId = null : beginCollectionEdit(collection)}>{editingCollectionId === collection.id ? 'Close' : 'Edit'}</button>
            </div>
            {#if editingCollectionId === collection.id}
              <form class="collection-form edit-collection" onsubmit={saveCollectionEdit}>
                <label>Material type <span>plural</span><input aria-label="Edit Material type name" bind:value={editCollectionName} /></label>
                <label>Singular item name <input aria-label="Edit singular item name" bind:value={editSingularName} /></label>
                <label>Icon <select aria-label="Edit Material type icon" bind:value={editCollectionIcon}><option value="folder">Folder</option><option value="file">File</option><option value="link">Link</option><option value="todo">Todo</option><option value="none">None</option></select></label>
                <label class="numbering"><input type="checkbox" bind:checked={editNumberingEnabled} /> Number items</label>
                {#if editNumberingEnabled}<label>Start number <input aria-label="Edit start number" type="number" step="1" bind:value={editNumberingStart} /></label>{/if}
                {#if deletingCollectionId === collection.id}<p class="delete-warning">Delete this Material type? Its items will move to Archived/Unowned rather than be erased.</p>{/if}
                <div class="collection-edit-actions"><button type="button" class="danger" onclick={() => deleteCollection(collection)}>{deletingCollectionId === collection.id ? 'Confirm delete' : 'Delete Material type'}</button><span></span><button type="button" onclick={() => { editingCollectionId = null; deletingCollectionId = null; }}>Cancel</button><button class="primary" disabled={!editCollectionName.trim() || !editSingularName.trim()}>Save</button></div>
              </form>
            {/if}
          {/each}
        </section>
      {/if}

      <footer>
        <span>{selectedSetHasErrors ? 'Resolve duplicate or missing names before creating Material types' : selectedSetItemCount ? `${selectedSetItemCount} Material type${selectedSetItemCount === 1 ? '' : 's'} selected` : 'Select Material types from one or more sets'}</span>
        <button type="button" onclick={closeCollectionManager}>Cancel</button>
        <button type="button" class="primary" disabled={!selectedSetItemCount || selectedSetHasErrors || applyingSets} onclick={applyCollectionSets}>{applyingSets ? 'Creating…' : 'Create selected Material types'}</button>
      </footer>
    </div>
  </div>
{/if}

<RelationshipManager open={relationshipManagerOpen} sourceNodeId={workspace.navigatorFocusId ?? workspace.spineNode?.id ?? current?.id ?? null} onClose={() => relationshipManagerOpen = false} />

{#if helpTopic}
  <div class="navigator-help-backdrop" role="presentation" onclick={() => helpTopic = null}>
    <div class="navigator-help" role="dialog" tabindex="-1" aria-modal="true" aria-label="Navigator instructions" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
      <button class="help-close" title="Close instructions" aria-label="Close instructions" onclick={() => helpTopic = null}>×</button>
      <div class="help-content">{@html helpContent}</div>
    </div>
  </div>
{/if}

<style>
  .navigator { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; height: 100%; border-right: 1px solid var(--line); background: color-mix(in srgb, var(--paper-deep) 70%, var(--canvas)); color: var(--ink-soft); }
  .navigator-header { display: grid; gap: 12px; padding: 16px 14px 12px; border-bottom: 1px solid var(--line); }
  .navigator-title { display: flex; align-items: center; justify-content: space-between; gap: 7px; }
  .navigator-header strong { color: var(--ink); font: 700 11px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .project-control { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) 30px; gap: 5px; }
  .project-control > select { min-width: 0; height: 31px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink-soft); padding: 0 8px; font: 600 10px/1 var(--font-ui); }
  .project-menu { position: relative; }
  .project-menu summary { display: grid; height: 31px; place-items: center; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--muted); cursor: pointer; font: 700 10px/1 var(--font-ui); list-style: none; }
  .project-menu summary::-webkit-details-marker { display: none; }
  .project-menu[open] summary { border-color: var(--accent); color: var(--accent); }
  .project-menu > div { position: absolute; z-index: 20; top: 35px; right: 0; display: grid; width: 145px; gap: 2px; padding: 5px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); box-shadow: 0 12px 30px rgb(35 30 22 / .16); }
  .project-menu button { min-height: 29px; padding: 0 8px; border: 0; border-radius: 3px; background: transparent; color: var(--ink-soft); font: 500 9px/1 var(--font-ui); text-align: left; }
  .project-menu button:hover { background: var(--paper-deep); }
  .project-menu button.danger { color: #8d3329; }
  .navigator-history { display: flex; align-items: center; }
  .navigator-history button { display: grid; width: 23px; height: 23px; place-items: center; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 16px/1 var(--font-ui); }
  .navigator-history button:not(:disabled):hover { background: var(--paper); color: var(--accent); }
  .navigator-history button:disabled { cursor: default; opacity: .25; }
  .navigator-controls { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px; }
  .history-controls, .mode-switch { display: grid; padding: 2px; border: 1px solid var(--line); border-radius: 5px; background: var(--canvas); }
  .history-controls { grid-template-columns: 28px 28px; }
  .mode-switch { grid-template-columns: 1fr 1fr; }
  .history-controls button, .mode-switch button { min-height: 27px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 600 9px/1 var(--font-ui); cursor: pointer; }
  .history-controls button { font-size: 18px; }
  .history-controls button:disabled { cursor: default; opacity: .28; }
  .mode-switch button.active { background: var(--paper); color: var(--accent); box-shadow: 0 1px 3px #3f392714; }
  .navigator-scroll { min-height: 0; overflow: auto; padding: 10px 8px 24px; }
  section { margin: 0; }
  .fixed-section, .todo-section { padding-bottom: 5px; border-bottom: 1px solid var(--line); }
  .todo-section { padding-top: 7px; }
  .archive-section { margin-top: 12px; padding-top: 7px; border-top: 1px solid var(--line); }
  .collection-group-header { display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: center; }
  .group-title { display: flex; width: 100%; align-items: center; justify-content: space-between; min-height: 30px; padding: 0 8px 0 58px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 700 9px/1 var(--font-ui); letter-spacing: .05em; text-align: left; text-transform: uppercase; }
  .group-title:hover { background: color-mix(in srgb, var(--paper) 72%, transparent); color: var(--ink-soft); }
  .group-title span:last-child { opacity: .55; font-size: 10px; }
  .manage-collections { width: 27px; height: 27px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 10px/1 var(--font-ui); }
  .manage-collections:hover { background: var(--paper); color: var(--ink); }
  .section-heading, .navigator-node { display: flex; align-items: center; min-height: 31px; padding-left: calc(var(--depth, 0) * 14px); border-radius: 3px; }
  .section-heading.selected, .navigator-node.selected { background: var(--accent-soft); color: var(--accent); }
  .section-heading:hover, .navigator-node:hover { background: color-mix(in srgb, var(--accent-soft) 48%, transparent); }
  .dragging { opacity: .48; }
  button { cursor: pointer; }
  .drag-handle { display: grid; flex: 0 0 18px; width: 18px; height: 25px; place-items: center; border: 0; background: transparent; color: color-mix(in srgb, var(--muted) 48%, transparent); font: 12px/1 var(--font-ui); cursor: grab; }
  .drag-handle:active { cursor: grabbing; }
  .drag-handle.placeholder { display: block; }
  .spine-row .drag-handle { visibility: hidden; }
  .disclosure { display: grid; flex: 0 0 22px; width: 22px; height: 25px; place-items: center; border: 0; background: transparent; color: var(--muted); font: 16px/1 var(--font-ui); }
  .disclosure.placeholder { display: block; }
  .structural-icon { width: 16px; color: var(--muted); font-size: 10px; text-align: center; }
  .heading-label, .node-link { display: flex; min-width: 0; flex: 1; align-items: center; gap: 7px; min-height: 30px; border: 0; border-radius: 3px; background: transparent; color: inherit; font: 600 11px/1.2 var(--font-ui); text-align: left; }
  .heading-label em { margin-left: auto; color: var(--muted); font-style: normal; font-weight: 500; }
  .node-link { overflow: hidden; font-weight: 500; font-size: 12px; }
  .node-link span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-link small { overflow: hidden; max-width: 72px; margin-left: auto; color: var(--muted); font: 8px/1 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .navigator-node, .context-entry { position: relative; }
  .navigator-node.drop-before::before, .context-entry.drop-before::before { position: absolute; z-index: 2; right: 4px; bottom: auto; left: 18px; height: 2px; border-radius: 2px; background: var(--accent); content: ''; top: -1px; }
  .navigator-node.drop-inside, .context-entry.drop-inside { outline: 1px solid var(--accent); outline-offset: -1px; background: var(--accent-soft); }
  .navigator-node.drop-before::after, .navigator-node.drop-inside::after, .context-entry.drop-before::after, .context-entry.drop-inside::after { position: absolute; z-index: 4; right: 4px; bottom: calc(100% - 3px); padding: 3px 5px; border-radius: 3px; background: var(--accent); color: white; content: attr(data-drop-label); font: 700 8px/1 var(--font-ui); pointer-events: none; white-space: nowrap; }
  .todo-list, .collection-contents { padding: 0 0 6px; }
  .todo-checkbox { display: grid; flex: 0 0 22px; width: 22px; place-items: center; }
  .todo-row { padding-left: 14px; }
  .todo-checkbox input { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .todo-row.done .todo-link > span { color: var(--muted); text-decoration: line-through; }
  .empty { margin: 5px 8px 8px 40px; color: var(--muted); font: 10px/1.4 var(--font-ui); }
  .quick-add { display: flex; gap: 4px; margin: 4px 5px 0 58px; }
  .quick-add input { min-width: 0; flex: 1; height: 29px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); font: 10px/1 var(--font-ui); }
  .quick-add button { width: 29px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--accent); }
  .collection-list { padding-top: 3px; }
  .collection-action { flex: 0 0 28px; height: 26px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 10px/1 var(--font-ui); opacity: .28; }
  .section-heading:hover .collection-action, .collection-action:focus-visible { opacity: 1; }
  .collection-action:hover { background: var(--paper); color: var(--ink); }
  .new-collection { display: flex; width: 100%; align-items: center; gap: 8px; min-height: 31px; margin: 0; padding: 0 8px 0 58px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 600 10px/1 var(--font-ui); text-align: left; }
  .new-collection:hover { background: color-mix(in srgb, var(--paper) 72%, transparent); color: var(--accent); }
  .collection-form, .relation-form { display: grid; gap: 8px; margin: 8px 4px; padding: 10px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); }
  .collection-form label, .relation-form label { display: grid; gap: 4px; color: var(--ink-soft); font: 600 9px/1.2 var(--font-ui); }
  .collection-form label > span { justify-self: end; margin-top: -12px; color: var(--muted); font-weight: 400; }
  .collection-form label.numbering { display: flex; align-items: center; }
  .collection-form input:not([type='checkbox']), .collection-form select, .relation-form input, .relation-form select { width: 100%; height: 31px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: #fff; font: 10px/1 var(--font-ui); }
  .collection-form > div, .relation-form > div { display: flex; justify-content: flex-end; gap: 5px; }
  .relation-form .create-within-actions span { flex: 1; }
  .collection-form .collection-edit-actions { align-items: center; }
  .collection-edit-actions span { flex: 1; }
  .collection-form button, .relation-form button { min-height: 28px; border: 1px solid var(--line); border-radius: 3px; background: transparent; font: 600 9px/1 var(--font-ui); }
  .collection-form button.primary, .relation-form button.primary { background: var(--accent); color: white; }
  .collection-form button.danger { color: #8d3329; }
  .delete-warning { margin: 0; padding: 7px 8px; border-left: 2px solid #8d3329; background: #8d33290b; color: #773129; font: 9px/1.45 var(--font-ui); }
  .context-view { padding: 7px 3px 12px; }
  .context-navigation { display: grid; gap: 5px; padding: 2px 6px 9px; border-bottom: 1px solid var(--line); }
  .context-breadcrumb { display: flex; min-width: 0; align-items: center; gap: 4px; overflow: hidden; color: var(--muted); font: 9px/1.2 var(--font-ui); white-space: nowrap; }
  .context-breadcrumb button { overflow: hidden; padding: 2px 0; border: 0; background: transparent; color: var(--muted); font: inherit; text-overflow: ellipsis; }
  .context-breadcrumb button:hover { color: var(--accent); }
  .context-breadcrumb strong { overflow: hidden; color: var(--ink-soft); font: 700 9px/1.2 var(--font-ui); text-overflow: ellipsis; text-transform: none; letter-spacing: 0; }
  .peer-navigation { display: flex; align-items: center; justify-content: flex-end; gap: 5px; color: var(--muted); font: 8px/1 var(--font-ui); }
  .peer-navigation button { display: grid; width: 22px; height: 20px; place-items: center; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink-soft); font: 15px/1 var(--font-ui); }
  .peer-navigation button:disabled { cursor: default; opacity: .28; }
  .selected-context { padding: 9px 0 0; }
  .context-label { margin: 0 6px 5px 6px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .1em; }
  .selected-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) 25px; min-height: 39px; align-items: center; padding: 3px 5px; border-radius: 3px; background: var(--accent-soft); color: var(--ink); }
  .selected-row > div { display: grid; min-width: 0; gap: 2px; }
  .selected-row strong, .selected-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .selected-row strong { font: 650 11px/1.2 var(--font-ui); }
  .selected-row small { color: var(--muted); font: 8px/1 var(--font-ui); }
  .selected-attachments { margin-left: 13px; padding: 3px 0 0 7px; border-left: 1px solid var(--line); }
  .context-entry { display: flex; min-width: 0; min-height: 32px; margin-left: calc((var(--context-depth, 1) - 1) * 13px); align-items: center; border-radius: 3px; color: var(--ink-soft); }
  .context-entry:hover { background: color-mix(in srgb, var(--accent-soft) 45%, transparent); }
  .context-entry > input:first-child { flex: 0 0 14px; width: 13px; height: 13px; margin: 0 4px; accent-color: var(--accent); }
  .context-entry-icon { display: grid; flex: 0 0 20px; width: 20px; place-items: center; color: var(--muted); font: 10px/1 var(--font-ui); }
  .context-entry > button:not(.context-drag):not(.context-expander) { display: flex; min-width: 0; min-height: 30px; flex: 1; align-items: center; gap: 7px; padding: 0 4px; border: 0; background: transparent; color: inherit; font: 500 10px/1.25 var(--font-ui); text-align: left; }
  .context-entry > button:not(.context-drag):not(.context-expander) span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .context-entry > button:not(.context-drag):not(.context-expander) small { overflow: hidden; max-width: 74px; margin-left: auto; color: var(--muted); font: 8px/1 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .context-drag { display: grid; flex: 0 0 17px; width: 17px; height: 27px; place-items: center; border: 0; background: transparent; color: color-mix(in srgb, var(--muted) 52%, transparent); font: 11px/1 var(--font-ui); cursor: grab; }
  .context-drag:active { cursor: grabbing; }
  .context-expander { display: grid; flex: 0 0 25px; width: 25px; height: 27px; place-items: center; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 15px/1 var(--font-ui); }
  .context-expander:hover { background: var(--paper); color: var(--accent); }
  .todo-complete { flex: 0 0 13px; width: 13px; height: 13px; margin: 0 6px 0 2px; accent-color: var(--accent); }
  .todo-entry.done > button span { color: var(--muted); text-decoration: line-through; }
  .context-preview { min-width: 0; }
  .preview-label { margin: 3px 3px 2px calc((var(--context-depth, 1) - 1) * 13px + 37px); color: var(--muted); font: 700 7px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; }
  .context-divider { height: 1px; margin: 7px 5px 6px 21px; background: var(--line); }
  .attachment-heading { display: flex; align-items: center; min-height: 23px; margin-left: 21px; color: var(--muted); font: 700 8px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; }
  .attachment-heading em { margin-left: auto; padding-right: 7px; font-style: normal; font-weight: 500; }
  .context-empty-entry { margin: 5px 7px 7px 42px; color: var(--muted); font: 9px/1.35 var(--font-ui); }
  .context-actions { display: flex; gap: 5px; padding: 2px 5px 0 21px; }
  .context-actions button, .add-kind-choices button { min-height: 29px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink-soft); font: 600 9px/1 var(--font-ui); }
  .context-actions .context-add { flex: 1; text-align: left; padding-left: 9px; }
  .context-actions .context-remove { width: 30px; color: #8d3329; font-size: 15px; }
  .context-actions .danger { flex: 1; border-color: #8d33294f; color: #8d3329; }
  .context-actions button:disabled { cursor: default; opacity: .38; }
  .add-panel { margin: 7px 5px 0 21px; padding: 7px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--paper) 82%, var(--canvas)); }
  .add-kind-choices { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
  .add-kind-choices button.active { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .add-panel .relation-form { margin: 7px 0 0; background: var(--canvas); }
  .removal-warning { margin: 7px 5px 0 21px; padding: 8px; border-left: 2px solid #8d3329; background: #8d33290b; color: #773129; font: 9px/1.45 var(--font-ui); }
  .context-empty { margin-top: 16px; }
  .collection-manager-backdrop { position: fixed; z-index: 95; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(34 31 27 / .38); backdrop-filter: blur(3px); }
  .collection-manager { display: flex; width: min(920px, 100%); max-height: calc(100vh - 48px); flex-direction: column; overflow: hidden; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); box-shadow: 0 24px 80px rgb(25 22 17 / .24); }
  .collection-manager > header { display: flex; align-items: center; justify-content: space-between; padding: 19px 22px 16px; border-bottom: 1px solid var(--line); }
  .collection-manager > header small { color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .12em; }
  .collection-manager h2 { margin: 4px 0 0; color: var(--ink); font: 500 25px/1.1 var(--font-reading); }
  .manager-close { width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font: 24px/1 var(--font-ui); }
  .manager-close:hover { background: var(--paper-deep); color: var(--ink); }
  .collection-welcome { margin: 16px 22px 0; padding: 12px 14px; border-left: 3px solid var(--accent); background: var(--accent-soft); }
  .collection-welcome strong { color: var(--ink); font: 700 12px/1.2 var(--font-ui); }
  .collection-welcome p { margin: 4px 0 0; color: var(--ink-soft); font: 11px/1.45 var(--font-ui); }
  .manager-section { min-height: 0; overflow: auto; padding: 18px 22px; }
  .collection-sets { flex: 1 1 auto; }
  .manager-section + .manager-section { border-top: 1px solid var(--line); }
  .manager-section-heading { display: flex; align-items: start; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
  .manager-section-heading h3 { margin: 0; color: var(--ink); font: 700 11px/1.2 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .manager-section-heading p { margin: 4px 0 0; color: var(--muted); font: 10px/1.4 var(--font-ui); }
  .manager-section-heading > button, .existing-collection-row button { min-height: 28px; padding: 0 9px; border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); font: 600 9px/1 var(--font-ui); }
  .manager-section-heading > button:hover, .existing-collection-row button:hover { background: var(--paper-deep); }
  .set-list { display: grid; gap: 7px; }
  .collection-set { overflow: hidden; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--canvas) 45%, var(--paper)); }
  .set-heading { display: grid; grid-template-columns: 28px 22px minmax(0, 1fr) auto; min-height: 48px; align-items: center; padding: 0 11px 0 6px; }
  .set-disclosure { width: 28px; height: 32px; border: 0; background: transparent; color: var(--muted); font: 18px/1 var(--font-ui); }
  .set-heading > input, .set-item > input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .set-title { display: grid; min-width: 0; gap: 3px; padding: 7px 9px; border: 0; background: transparent; text-align: left; }
  .set-title strong { color: var(--ink); font: 700 11px/1.2 var(--font-ui); }
  .set-title span { overflow: hidden; color: var(--muted); font: 9px/1.25 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .set-heading > small { color: var(--muted); font: 9px/1 var(--font-ui); }
  .set-items { border-top: 1px solid var(--line); background: var(--paper); }
  .set-item { display: grid; grid-template-columns: 22px minmax(125px, 1.2fr) minmax(115px, 1fr) 92px 72px 58px; gap: 8px; align-items: end; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
  .set-item:last-child { border-bottom: 0; }
  .set-item > input { align-self: center; }
  .set-item label { display: grid; gap: 4px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .04em; }
  .set-item label.set-numbering { display: flex; align-items: center; align-self: center; gap: 5px; }
  .set-item label.set-numbering input { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); }
  .set-item input:not([type='checkbox']), .set-item select { min-width: 0; width: 100%; height: 29px; padding: 0 7px; border: 1px solid var(--line); border-radius: 3px; background: #fff; color: var(--ink); font: 10px/1 var(--font-ui); text-transform: none; }
  .set-item input:disabled, .set-item select:disabled { background: var(--paper-deep); color: var(--muted); opacity: .72; }
  .set-item.existing, .set-item.conflict { grid-template-columns: 22px minmax(125px, 1.2fr) minmax(115px, 1fr) 92px 72px 58px auto; }
  .already-added, .name-conflict { align-self: center; color: var(--accent); font: 700 8px/1 var(--font-ui); text-transform: uppercase; white-space: nowrap; }
  .name-conflict { color: #8d3329; }
  .existing-collections { flex: 0 0 auto; max-height: 34vh; }
  .existing-collection-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 36px; border-bottom: 1px solid var(--line); }
  .existing-collection-row strong { color: var(--ink); font: 600 11px/1.2 var(--font-ui); }
  .existing-collection-row small { color: var(--muted); font: 10px/1.2 var(--font-ui); }
  .collection-manager .collection-form { margin: 10px 0 14px; background: var(--canvas); }
  .collection-manager > footer { display: flex; align-items: center; justify-content: flex-end; gap: 7px; min-height: 57px; padding: 10px 22px; border-top: 1px solid var(--line); background: var(--paper-deep); }
  .collection-manager > footer span { margin-right: auto; color: var(--muted); font: 10px/1.3 var(--font-ui); }
  .collection-manager > footer button { min-height: 32px; padding: 0 11px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink-soft); font: 600 9px/1 var(--font-ui); }
  .collection-manager > footer button.primary { border-color: var(--accent); background: var(--accent); color: white; }
  .collection-manager > footer button:disabled { cursor: default; opacity: .42; }
  .navigator-help-backdrop { position: fixed; z-index: 90; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(34 31 27 / .30); backdrop-filter: blur(2px); }
  .navigator-help { position: relative; width: min(560px, 100%); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); padding: 26px 30px; box-shadow: 0 24px 70px rgb(25 22 17 / .22); }
  .help-close { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font-size: 22px; }
  .help-close:hover { background: var(--paper-deep); color: var(--ink); }
  .help-content :global(h2) { margin: 0 34px 14px 0; color: var(--ink); font: 500 25px/1.2 var(--font-reading); }
  .help-content :global(p), .help-content :global(li) { color: var(--ink-soft); font: 12px/1.6 var(--font-ui); }
  .help-content :global(ul) { margin: 14px 0 0; padding-left: 20px; }
  .help-content :global(li + li) { margin-top: 7px; }
  @media (max-width: 760px) {
    .navigator { height: 100%; max-height: none; border-right: 1px solid var(--line); border-bottom: 0; }
    .collection-manager-backdrop { padding: 10px; }
    .collection-manager { max-height: calc(100vh - 20px); }
    .set-item, .set-item.existing, .set-item.conflict { grid-template-columns: 22px 1fr 1fr; align-items: end; }
    .already-added, .name-conflict { grid-column: 2 / -1; }
  }
</style>
