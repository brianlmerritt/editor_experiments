<script lang="ts">
  import { workspace } from '$lib/state/workspace.svelte';
  import { nodeArchived, nodeCollectionId, type CollectionDefinition } from '$lib/workspace/navigator';
  import type { WorkspaceDocument } from '$lib/workspace/model';
  import collectionsInstructions from '$lib/content/navigator/collections-instructions.html?raw';
  import todosInstructions from '$lib/content/navigator/todos-instructions.html?raw';
  import archivedInstructions from '$lib/content/navigator/archived-unowned-instructions.html?raw';

  let { onOpenNode }: {
    onOpenNode: (id: string, navigation?: 'push' | 'back' | 'forward') => Promise<void>
  } = $props();

  let collectionFormOpen = $state(false);
  let collectionName = $state('');
  let singularName = $state('');
  let singularEdited = $state(false);
  let collectionIcon = $state<CollectionDefinition['icon']>('folder');
  let numberingEnabled = $state(false);
  let numberingStart = $state(1);
  let nodeDrafts = $state<Record<string, string>>({});
  let todoDraft = $state('');
  let relationOpen = $state(false);
  let relationTarget = $state('');
  let relationType = $state('features');
  let relationInverseType = $state('appears in');
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

  let current = $derived(workspace.currentDocument);
  let focused = $derived(workspace.navigatorFocusNode);
  let availableRelationTargets = $derived(workspace.projectNodes.filter((node) => node.id !== workspace.navigatorFocusId));
  let helpContent = $derived(helpTopic === 'collections'
    ? collectionsInstructions
    : helpTopic === 'todos'
      ? todosInstructions
      : helpTopic === 'archived'
        ? archivedInstructions
        : '');

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

  function nearbyNodes(node: WorkspaceDocument): WorkspaceDocument[] {
    return workspace.navigatorNeighbourhood(node.id);
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

  async function addCollection(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const created = await workspace.createCollection({
      name: collectionName,
      singularName,
      icon: collectionIcon,
      numbering: { enabled: numberingEnabled, start: Math.trunc(numberingStart) }
    });
    if (!created) return;
    resetCollectionForm();
    await onOpenNode(created.id);
  }

  async function addNode(collection: CollectionDefinition): Promise<void> {
    const created = await workspace.createNavigatorNode(collection.id, nodeDrafts[collection.id] ?? '');
    if (!created) return;
    nodeDrafts = { ...nodeDrafts, [collection.id]: '' };
    await onOpenNode(created.id);
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
    await workspace.updateCollection(editingCollectionId, {
      name: editCollectionName,
      singularName: editSingularName,
      icon: editCollectionIcon,
      numbering: { enabled: editNumberingEnabled, start: Math.trunc(editNumberingStart) }
    });
    editingCollectionId = null;
  }

  async function deleteCollection(collection: CollectionDefinition): Promise<void> {
    if (deletingCollectionId !== collection.id) {
      deletingCollectionId = collection.id;
      return;
    }
    if (workspace.branchId === collection.id && workspace.spineNode) await onOpenNode(workspace.spineNode.id);
    await workspace.deleteCollection(collection.id);
    if (editingCollectionId === collection.id) editingCollectionId = null;
    deletingCollectionId = null;
  }

  async function addTodo(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const created = await workspace.createNavigatorTodo(todoDraft);
    if (!created) return;
    todoDraft = '';
    await onOpenNode(created.id);
  }

  async function addRelationship(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!await workspace.createNavigatorRelationship(relationTarget, relationType, relationInverseType)) return;
    relationTarget = '';
    relationOpen = false;
  }

  async function addChild(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!focused) return;
    const created = await workspace.createNavigatorNode(childCollection, childTitle, focused.id);
    if (!created) return;
    workspace.setNavigatorExpanded(`node:${focused.id}`, true, 'context');
    workspace.setNavigatorExpanded(`node:${focused.id}`, true, 'traditional');
    childTitle = '';
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

  async function dropOnCollection(event: DragEvent, collection: CollectionDefinition): Promise<void> {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (!moving) return;
    if (moving.kind === 'collection') {
      await workspace.moveCollection(moving.id, collection.id);
      return;
    }
    const node = workspace.navigatorNodes.find((candidate) => candidate.id === moving.id);
    if (!node || nodeCollectionId(node) !== collection.id) {
      workspace.notice = 'Dragging does not convert an item into another Collection.';
      return;
    }
    await workspace.moveNavigatorNode(moving.id, { parentId: collection.id });
  }

  async function dropBeforeNode(event: DragEvent, node: WorkspaceDocument): Promise<void> {
    event.preventDefault();
    const moving = dragged;
    dragged = null;
    if (!moving || moving.kind !== 'node' || !node.parentId) return;
    await workspace.moveNavigatorNode(moving.id, { parentId: node.parentId, beforeNodeId: node.id });
  }
</script>

{#snippet nodeRow(node: WorkspaceDocument, depth = 0, contextual = false)}
  {@const children = childrenOf(node.id)}
  {@const key = `node:${node.id}`}
  {@const nearby = contextual ? nearbyNodes(node) : []}
  {@const nearbyTodos = contextual ? workspace.navigatorTodosFor(node.id) : []}
  {@const neighbourhoodKey = `context:neighbourhood:${node.id}`}
  {@const label = workspace.navigatorNodeLabel(node)}
  <div role="treeitem" tabindex="-1" aria-selected={node.id === workspace.branchId} class="navigator-node" class:selected={node.id === workspace.branchId} class:dragging={dragged?.id === node.id} style={`--depth:${depth}`} ondragover={allowDrop} ondrop={(event) => dropBeforeNode(event, node)}>
    <button class="drag-handle" draggable="true" aria-label={`Move ${label}`} title={`Move ${label}`} ondragstart={(event) => startDrag(event, 'node', node.id)} ondragend={() => dragged = null}>⠿</button>
    {#if children.length && !contextual}
      <button class="disclosure" title={`${workspace.navigatorExpanded(key) ? 'Collapse' : 'Expand'} ${label}`} aria-label={`${workspace.navigatorExpanded(key) ? 'Collapse' : 'Expand'} ${label}`} onclick={() => workspace.toggleNavigatorExpanded(key)}>{workspace.navigatorExpanded(key) ? '⌄' : '›'}</button>
    {:else}
      <span class="disclosure placeholder"></span>
    {/if}
    <span class="structural-icon" title={node.role === 'spine' ? 'Project Spine' : 'Document'} aria-hidden="true">{node.role === 'spine' ? '▥' : '▤'}</span>
    <button class="node-link" onclick={() => onOpenNode(node.id)} title={label}><span>{label}</span></button>
    {#if contextual && (nearby.length || nearbyTodos.length)}
      <button class="neighbourhood-toggle" title={`${workspace.navigatorExpanded(neighbourhoodKey, 'context') ? 'Hide' : 'Show'} nearby material for ${label}`} aria-label={`${workspace.navigatorExpanded(neighbourhoodKey, 'context') ? 'Hide' : 'Show'} nearby material for ${label}`} onclick={() => workspace.setNavigatorExpanded(neighbourhoodKey, !workspace.navigatorExpanded(neighbourhoodKey, 'context'), 'context')}>⌁</button>
    {/if}
  </div>
  {#if !contextual && children.length && workspace.navigatorExpanded(key)}
    {#each children as child (child.id)}{@render nodeRow(child, depth + 1)}{/each}
  {/if}
  {#if contextual && workspace.navigatorExpanded(neighbourhoodKey, 'context')}
    <div class="neighbourhood" style={`--depth:${depth + 1}`}>
      {#each nearby as neighbour (neighbour.id)}{@render nodeRow(neighbour, depth + 1)}{/each}
      {#each nearbyTodos as todo (todo.id)}
        <button class="neighbourhood-todo" class:done={todo.state === 'done'} onclick={() => onOpenNode(todo.id)} title={`Open Todo: ${todo.title}`}><span aria-hidden="true">☑</span>{todo.title}</button>
      {/each}
    </div>
  {/if}
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
            <span class="todo-checkbox"><input aria-label={`${todo.state === 'done' ? 'Reopen' : 'Complete'} ${todo.title}`} title={`${todo.state === 'done' ? 'Mark open' : 'Mark done'} — ${todo.title}`} type="checkbox" checked={todo.state === 'done'} onchange={() => workspace.toggleNavigatorTodo(todo.id)} /></span>
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
    <div><strong>Navigator</strong><small title="Current project">{workspace.currentProject?.title}</small></div>
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
        <button class="group-title" title="About Collections" onclick={() => helpTopic = 'collections'}><span>Collections</span><span aria-hidden="true">?</span></button>
        {#each [...workspace.navigator.collections].sort((a, b) => a.order - b.order) as collection (collection.id)}
          {@const collectionKey = `collection:${collection.id}`}
          {@const roots = rootsForCollection(collection.id)}
          <section role="group" class="collection" class:dragging={dragged?.id === collection.id} ondragover={allowDrop} ondrop={(event) => dropOnCollection(event, collection)}>
            <div class="section-heading" class:selected={workspace.branchId === collection.id}>
              <button class="drag-handle" draggable="true" aria-label={`Move ${collection.name}`} title="Move Collection" ondragstart={(event) => startDrag(event, 'collection', collection.id)} ondragend={() => dragged = null}>⠿</button>
              <button class="disclosure" title={`${workspace.navigatorExpanded(collectionKey) ? 'Collapse' : 'Expand'} ${collection.name}`} aria-label={`${workspace.navigatorExpanded(collectionKey) ? 'Collapse' : 'Expand'} ${collection.name}`} onclick={() => workspace.toggleNavigatorExpanded(collectionKey)}>{workspace.navigatorExpanded(collectionKey) ? '⌄' : '›'}</button>
              <span class="structural-icon" title={`${collection.icon === 'none' ? 'Collection' : `${collection.icon} Collection`}`} aria-hidden="true">{collection.icon === 'none' ? '·' : iconGlyphs[collection.icon]}</span>
              <button class="heading-label collection-link" title={`Open ${collection.name}`} onclick={() => onOpenNode(collection.id)}>{collection.name} <em>{workspace.navigatorNodes.filter((node) => nodeCollectionId(node) === collection.id && !nodeArchived(node)).length}</em></button>
              <button class="collection-action" aria-label={`Manage ${collection.name}`} title="Manage Collection" onclick={() => beginCollectionEdit(collection)}>•••</button>
            </div>
            {#if editingCollectionId === collection.id}
              <form class="collection-form edit-collection" onsubmit={saveCollectionEdit}>
                <label>Collection name <span>plural</span><input aria-label="Edit Collection name" bind:value={editCollectionName} /></label>
                <label>Singular name <input aria-label="Edit singular name" bind:value={editSingularName} /></label>
                <label>Icon <select aria-label="Edit Collection icon" bind:value={editCollectionIcon}><option value="folder">Folder</option><option value="file">File</option><option value="link">Link</option><option value="todo">Todo</option><option value="none">None</option></select></label>
                <label class="numbering"><input type="checkbox" bind:checked={editNumberingEnabled} /> Number items</label>
                {#if editNumberingEnabled}<label>Start number <input aria-label="Edit start number" type="number" step="1" bind:value={editNumberingStart} /></label>{/if}
                {#if deletingCollectionId === collection.id}<p class="delete-warning">Delete this Collection? Its items will move to Archived/Unowned rather than be erased.</p>{/if}
                <div class="collection-edit-actions"><button type="button" class="danger" onclick={() => deleteCollection(collection)}>{deletingCollectionId === collection.id ? 'Confirm delete' : 'Delete Collection'}</button><span></span><button type="button" onclick={() => { editingCollectionId = null; deletingCollectionId = null; }}>Cancel</button><button class="primary" disabled={!editCollectionName.trim() || !editSingularName.trim()}>Save</button></div>
              </form>
            {/if}
            {#if workspace.navigatorExpanded(collectionKey)}
              <div class="collection-contents">
                {#each roots as node (node.id)}{@render nodeRow(node, 1)}{/each}
                {#if !roots.length}<p class="empty">No {collection.name.toLowerCase()} yet.</p>{/if}
                <div class="quick-add">
                  <input
                    aria-label={`Create new ${collection.singularName}`}
                    placeholder={`Create new ${collection.singularName.toLowerCase()}`}
                    title={collection.numbering.enabled ? 'A name is optional because numbering is enabled.' : `Name the new ${collection.singularName}.`}
                    value={nodeDrafts[collection.id] ?? ''}
                    oninput={(event) => nodeDrafts = { ...nodeDrafts, [collection.id]: event.currentTarget.value }}
                    onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addNode(collection); } }}
                  />
                  <button disabled={!collection.numbering.enabled && !nodeDrafts[collection.id]?.trim()} onclick={() => addNode(collection)} aria-label={`Add ${collection.singularName}`}>+</button>
                </div>
              </div>
            {/if}
          </section>
        {/each}

        {#if collectionFormOpen}
          <form class="collection-form" onsubmit={addCollection}>
            <label>Collection name <span>plural — e.g. Characters, Chapters, Locations</span><input aria-label="Collection name (plural)" placeholder="Characters, Chapters, Locations…" value={collectionName} oninput={(event) => updateCollectionName(event.currentTarget.value)} /></label>
            <label>Singular name <input aria-label="Singular name" placeholder="Character" value={singularName} oninput={(event) => { singularEdited = true; singularName = event.currentTarget.value; }} /></label>
            <label>Icon <select aria-label="Collection icon" bind:value={collectionIcon}><option value="folder">Folder</option><option value="file">File</option><option value="link">Link</option><option value="todo">Todo</option><option value="none">None</option></select></label>
            <label class="numbering"><input type="checkbox" bind:checked={numberingEnabled} /> Number items</label>
            {#if numberingEnabled}<label>Start number <input aria-label="Start number" type="number" step="1" bind:value={numberingStart} /></label>{/if}
            <div><button type="button" onclick={resetCollectionForm}>Cancel</button><button class="primary" disabled={!collectionName.trim() || !singularName.trim()}>Create Collection</button></div>
          </form>
        {:else}
          <button class="new-collection" title="Create a new Collection" onclick={() => collectionFormOpen = true}><span aria-hidden="true">＋</span> Add Collection</button>
        {/if}
      </div>
    {:else}
      <div class="context-view">
        {#if focused}
          <section><div class="context-label">Focused</div>{@render nodeRow(focused, 0, true)}</section>
          {#if workspace.selectedNodeParent}<section><div class="context-label">Parent</div>{@render nodeRow(workspace.selectedNodeParent, 0, true)}</section>{/if}
          {#if workspace.selectedNodeSiblings.length}<section><div class="context-label">Siblings</div>{#each workspace.selectedNodeSiblings as node (node.id)}{@render nodeRow(node, 0, true)}{/each}</section>{/if}
          {#if workspace.selectedNodeChildren.length}<section><div class="context-label">Contains</div>{#each workspace.selectedNodeChildren as node (node.id)}{@render nodeRow(node, 0, true)}{/each}</section>{/if}
          <section>
            <div class="context-label">Related</div>
            {#each workspace.selectedNodeRelations as relation (relation.relationshipId)}<div class="related-row"><small>{relation.label}</small>{@render nodeRow(relation.node, 0, true)}</div>{/each}
            {#if !workspace.selectedNodeRelations.length}<p class="empty">No confirmed relationships.</p>{/if}
            {#if relationOpen}
              <form class="relation-form" onsubmit={addRelationship}>
                <select aria-label="Related item" bind:value={relationTarget}><option value="">Choose an item</option>{#each availableRelationTargets as node}<option value={node.id}>{workspace.navigatorNodeLabel(node)}</option>{/each}</select>
                <input aria-label="Relationship" bind:value={relationType} />
                <input aria-label="Inverse relationship" bind:value={relationInverseType} />
                <div><button type="button" onclick={() => relationOpen = false}>Cancel</button><button class="primary" disabled={!relationTarget || !relationType.trim() || !relationInverseType.trim()}>Link</button></div>
              </form>
            {:else if availableRelationTargets.length}<button class="new-collection" onclick={() => relationOpen = true}>+ Link related material</button>{/if}
          </section>
          <section>
            <div class="context-label">Add inside {workspace.navigatorNodeLabel(focused)}</div>
            <form class="relation-form" onsubmit={addChild}>
              <select aria-label="Child collection" bind:value={childCollection}><option value="">Choose a Collection</option>{#each workspace.navigator.collections as collection}<option value={collection.id}>{collection.singularName}</option>{/each}</select>
              <input aria-label="Child title" placeholder="Title (optional when numbered)" bind:value={childTitle} />
              <div><button class="primary" disabled={!childCollection}>Add inside</button></div>
            </form>
          </section>
          <section>
            <div class="context-label">Applicable Todos</div>
            {#each workspace.selectedNodeTodos as todo (todo.id)}<button class="context-todo" class:done={todo.state === 'done'} onclick={() => onOpenNode(todo.id)}>{todo.title}</button>{/each}
            {#if !workspace.selectedNodeTodos.length}<p class="empty">No Todos target this item.</p>{/if}
            <form class="quick-add" onsubmit={addTodo}>
              <input aria-label="New contextual Todo" placeholder={`Todo for ${workspace.navigatorNodeLabel(focused)}`} bind:value={todoDraft} />
              <button disabled={!todoDraft.trim()} aria-label="Add contextual Todo" title="Create a Todo for the focused item">+</button>
            </form>
          </section>
        {:else}
          <p class="empty context-empty">Select a structural item to establish a Navigator focus.</p>
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

{#if helpTopic}
  <div class="navigator-help-backdrop" role="presentation" onclick={() => helpTopic = null}>
    <div class="navigator-help" role="dialog" tabindex="-1" aria-modal="true" aria-label="Navigator instructions" onclick={(event) => event.stopPropagation()} onkeydown={(event) => event.stopPropagation()}>
      <button class="help-close" title="Close instructions" aria-label="Close instructions" onclick={() => helpTopic = null}>×</button>
      <div class="help-content">{@html helpContent}</div>
    </div>
  </div>
{/if}

<style>
  .navigator { position: sticky; top: 104px; display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; height: calc(100vh - 104px); border-right: 1px solid var(--line); background: color-mix(in srgb, var(--paper-deep) 70%, var(--canvas)); color: var(--ink-soft); }
  .navigator-header { display: grid; gap: 12px; padding: 16px 14px 12px; border-bottom: 1px solid var(--line); }
  .navigator-header > div:first-child { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .navigator-header strong { color: var(--ink); font: 700 11px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .navigator-header small { overflow: hidden; color: var(--muted); font: 10px/1.2 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
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
  .group-title { display: flex; width: 100%; align-items: center; justify-content: space-between; min-height: 30px; padding: 0 8px 0 58px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 700 9px/1 var(--font-ui); letter-spacing: .05em; text-align: left; text-transform: uppercase; }
  .group-title:hover { background: color-mix(in srgb, var(--paper) 72%, transparent); color: var(--ink-soft); }
  .group-title span:last-child { opacity: .55; font-size: 10px; }
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
  .neighbourhood-toggle { display: grid; flex: 0 0 24px; width: 24px; height: 25px; place-items: center; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 13px/1 var(--font-ui); }
  .neighbourhood-toggle:hover { background: var(--paper); color: var(--accent); }
  .neighbourhood { margin-left: 14px; padding-left: 5px; border-left: 1px solid var(--line); }
  .neighbourhood-todo { display: flex; width: calc(100% - 8px); align-items: center; gap: 7px; min-height: 29px; margin-left: calc(var(--depth, 0) * 14px + 40px); border: 0; background: transparent; color: var(--ink-soft); font: 500 10px/1.3 var(--font-ui); text-align: left; }
  .neighbourhood-todo.done { color: var(--muted); text-decoration: line-through; }
  .todo-list, .collection-contents { padding: 0 0 6px; }
  .todo-checkbox { display: grid; flex: 0 0 22px; width: 22px; place-items: center; }
  .todo-row { padding-left: 14px; }
  .todo-checkbox input { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); cursor: pointer; }
  .todo-row.done .todo-link > span { color: var(--muted); text-decoration: line-through; }
  .todo-link small { overflow: hidden; max-width: 72px; margin-left: auto; color: var(--muted); font: 8px/1 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
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
  .collection-form label { display: grid; gap: 4px; color: var(--ink-soft); font: 600 9px/1.2 var(--font-ui); }
  .collection-form label > span { justify-self: end; margin-top: -12px; color: var(--muted); font-weight: 400; }
  .collection-form label.numbering { display: flex; align-items: center; }
  .collection-form input:not([type='checkbox']), .collection-form select, .relation-form input, .relation-form select { width: 100%; height: 31px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: #fff; font: 10px/1 var(--font-ui); }
  .collection-form > div, .relation-form > div { display: flex; justify-content: flex-end; gap: 5px; }
  .collection-form .collection-edit-actions { align-items: center; }
  .collection-edit-actions span { flex: 1; }
  .collection-form button, .relation-form button { min-height: 28px; border: 1px solid var(--line); border-radius: 3px; background: transparent; font: 600 9px/1 var(--font-ui); }
  .collection-form button.primary, .relation-form button.primary { background: var(--accent); color: white; }
  .collection-form button.danger { color: #8d3329; }
  .delete-warning { margin: 0; padding: 7px 8px; border-left: 2px solid #8d3329; background: #8d33290b; color: #773129; font: 9px/1.45 var(--font-ui); }
  .context-view { padding-top: 7px; }
  .context-view section { padding: 6px 0 9px; border-bottom: 1px solid var(--line); }
  .context-label { margin: 0 6px 5px 40px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .1em; }
  .related-row { display: grid; grid-template-columns: 68px minmax(0, 1fr); align-items: center; }
  .related-row > small { overflow: hidden; color: var(--muted); font: 9px/1.2 var(--font-ui); text-align: right; text-overflow: ellipsis; white-space: nowrap; }
  .context-todo { display: block; width: calc(100% - 48px); margin: 5px 8px 5px 40px; padding: 0; border: 0; background: transparent; color: var(--ink-soft); font: 11px/1.35 var(--font-ui); text-align: left; }
  .context-todo.done { color: var(--muted); text-decoration: line-through; }
  .context-empty { margin-top: 16px; }
  .navigator-help-backdrop { position: fixed; z-index: 90; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(34 31 27 / .30); backdrop-filter: blur(2px); }
  .navigator-help { position: relative; width: min(560px, 100%); max-height: calc(100vh - 48px); overflow: auto; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); padding: 26px 30px; box-shadow: 0 24px 70px rgb(25 22 17 / .22); }
  .help-close { position: absolute; top: 12px; right: 12px; width: 28px; height: 28px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font-size: 22px; }
  .help-close:hover { background: var(--paper-deep); color: var(--ink); }
  .help-content :global(h2) { margin: 0 34px 14px 0; color: var(--ink); font: 500 25px/1.2 var(--font-reading); }
  .help-content :global(p), .help-content :global(li) { color: var(--ink-soft); font: 12px/1.6 var(--font-ui); }
  .help-content :global(ul) { margin: 14px 0 0; padding-left: 20px; }
  .help-content :global(li + li) { margin-top: 7px; }
  @media (max-width: 680px) { .navigator { position: static; height: auto; max-height: 42vh; border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
