<script lang="ts">
  import { workspace } from '$lib/state/workspace.svelte';
  import { nodeCollectionId, type CollectionDefinition } from '$lib/workspace/navigator';
  import type { WorkspaceDocument } from '$lib/workspace/model';

  let { onOpenNode }: { onOpenNode: (id: string) => Promise<void> } = $props();

  let collectionFormOpen = $state(false);
  let collectionName = $state('');
  let itemName = $state('');
  let collectionIcon = $state<CollectionDefinition['icon']>('text');
  let nodeDrafts = $state<Record<string, string>>({});
  let todoDraft = $state('');
  let relationOpen = $state(false);
  let relationTarget = $state('');
  let relationType = $state('features');
  let relationInverseType = $state('appears in');
  let childCollection = $state('');
  let childTitle = $state('');

  let current = $derived(workspace.currentDocument);
  let availableRelationTargets = $derived(workspace.projectNodes.filter((node) => node.id !== workspace.branchId));

  function childrenOf(nodeId: string): WorkspaceDocument[] {
    return workspace.projectNodes.filter((node) => node.parentId === nodeId).sort((a, b) => a.order - b.order);
  }

  function rootsForCollection(collectionId: string): WorkspaceDocument[] {
    return workspace.navigatorNodes
      .filter((node) => nodeCollectionId(node) === collectionId)
      .filter((node) => !node.parentId || !workspace.projectNodes.some((candidate) => candidate.id === node.parentId))
      .sort((a, b) => a.order - b.order);
  }

  function iconFor(node: WorkspaceDocument): string {
    if (node.role === 'spine') return '◆';
    const collection = workspace.navigator.collections.find((item) => item.id === nodeCollectionId(node));
    return ({ text: '▤', character: '●', location: '◇', research: '⌕', note: '▪' } as const)[collection?.icon ?? 'text'];
  }

  function targetLabels(ids: string[]): string {
    const labels = ids.map((id) => workspace.projectNodes.find((node) => node.id === id)?.title).filter(Boolean);
    return labels.length ? labels.join(', ') : 'Work';
  }

  async function addCollection(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const created = await workspace.createCollection({
      name: collectionName,
      itemName,
      icon: collectionIcon
    });
    if (!created) return;
    collectionName = '';
    itemName = '';
    collectionIcon = 'text';
    collectionFormOpen = false;
  }

  async function addNode(collection: CollectionDefinition): Promise<void> {
    const created = await workspace.createNavigatorNode(collection.id, nodeDrafts[collection.id] ?? '');
    if (!created) return;
    nodeDrafts = { ...nodeDrafts, [collection.id]: '' };
    await onOpenNode(created.id);
  }

  async function addTodo(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!await workspace.createNavigatorTodo(todoDraft)) return;
    todoDraft = '';
  }

  async function addRelationship(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!await workspace.createNavigatorRelationship(relationTarget, relationType, relationInverseType)) return;
    relationTarget = '';
    relationOpen = false;
  }

  async function addChild(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!current) return;
    const created = await workspace.createNavigatorNode(childCollection, childTitle, current.id);
    if (!created) return;
    workspace.setNavigatorExpanded(`node:${current.id}`, true);
    childTitle = '';
  }
</script>

{#snippet nodeRow(node: WorkspaceDocument, depth = 0)}
  {@const children = childrenOf(node.id)}
  {@const key = `node:${node.id}`}
  <div class="navigator-node" class:selected={node.id === workspace.branchId} style={`--depth:${depth}`}>
    {#if children.length}
      <button class="disclosure" aria-label={`${workspace.navigatorExpanded(key) ? 'Collapse' : 'Expand'} ${node.title}`} onclick={() => workspace.toggleNavigatorExpanded(key)}>{workspace.navigatorExpanded(key) ? '⌄' : '›'}</button>
    {:else}
      <span class="disclosure placeholder"></span>
    {/if}
    <button class="node-link" onclick={() => onOpenNode(node.id)} title={node.title}>
      <span class="node-icon">{iconFor(node)}</span><span>{node.title}</span>
    </button>
  </div>
  {#if children.length && workspace.navigatorExpanded(key)}
    {#each children as child (child.id)}
      {@render nodeRow(child, depth + 1)}
    {/each}
  {/if}
{/snippet}

<nav class="navigator" aria-label="Project Navigator">
  <header class="navigator-header">
    <div><strong>Navigator</strong><small>{workspace.currentProject?.title}</small></div>
    <div class="mode-switch" aria-label="Navigator view">
      <button class:active={workspace.navigatorMemory.mode === 'traditional'} onclick={() => workspace.setNavigatorMode('traditional')}>Traditional</button>
      <button class:active={workspace.navigatorMemory.mode === 'context'} onclick={() => workspace.setNavigatorMode('context')}>Context</button>
    </div>
  </header>

  <div class="navigator-scroll">
    {#if workspace.spineNode}
      <section class="fixed-section">
        {@render nodeRow(workspace.spineNode)}
      </section>
    {/if}

    <section class="todo-section">
      <div class="section-heading">
        <button class="disclosure" onclick={() => workspace.toggleNavigatorExpanded('fixed:todos')}>{workspace.navigatorExpanded('fixed:todos') ? '⌄' : '›'}</button>
        <button class="heading-label" onclick={() => workspace.toggleNavigatorExpanded('fixed:todos')}><span>✓</span> Todos <em>{workspace.navigator.todos.filter((todo) => todo.state === 'open').length}</em></button>
      </div>
      {#if workspace.navigatorExpanded('fixed:todos')}
        <div class="todo-list">
          {#each workspace.navigator.todos as todo (todo.id)}
            <label class:done={todo.state === 'done'}>
              <input type="checkbox" checked={todo.state === 'done'} onchange={() => workspace.toggleNavigatorTodo(todo.id)} />
              <span>{todo.title}<small>{targetLabels(todo.targetNodeIds)}</small></span>
            </label>
          {/each}
          {#if !workspace.navigator.todos.length}<p class="empty">No work recorded yet.</p>{/if}
          <form class="quick-add" onsubmit={addTodo}>
            <input aria-label="New Todo" placeholder={current ? `Todo for ${current.title}` : 'New Todo'} bind:value={todoDraft} />
            <button disabled={!todoDraft.trim()} aria-label="Add Todo">+</button>
          </form>
        </div>
      {/if}
    </section>

    {#if workspace.navigatorMemory.mode === 'traditional'}
      <div class="collection-list">
        {#each [...workspace.navigator.collections].sort((a, b) => a.order - b.order) as collection (collection.id)}
          {@const collectionKey = `collection:${collection.id}`}
          {@const roots = rootsForCollection(collection.id)}
          <section class="collection">
            <div class="section-heading">
              <button class="disclosure" onclick={() => workspace.toggleNavigatorExpanded(collectionKey)}>{workspace.navigatorExpanded(collectionKey) ? '⌄' : '›'}</button>
              <button class="heading-label" onclick={() => workspace.toggleNavigatorExpanded(collectionKey)}>{collection.name} <em>{workspace.navigatorNodes.filter((node) => nodeCollectionId(node) === collection.id).length}</em></button>
            </div>
            {#if workspace.navigatorExpanded(collectionKey)}
              <div class="collection-contents">
                {#each roots as node (node.id)}{@render nodeRow(node)}{/each}
                {#if !roots.length}<p class="empty">No {collection.name.toLowerCase()} yet.</p>{/if}
                <div class="quick-add">
                  <input aria-label={`New ${collection.itemName}`} placeholder={`New ${collection.itemName.toLowerCase()}`} value={nodeDrafts[collection.id] ?? ''} oninput={(event) => nodeDrafts = { ...nodeDrafts, [collection.id]: event.currentTarget.value }} onkeydown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void addNode(collection); } }} />
                  <button disabled={!nodeDrafts[collection.id]?.trim()} onclick={() => addNode(collection)} aria-label={`Add ${collection.itemName}`}>+</button>
                </div>
              </div>
            {/if}
          </section>
        {/each}

        {#if workspace.uncollectedNodes.length}
          <section class="collection uncollected">
            <div class="section-heading"><span class="disclosure placeholder"></span><span class="heading-label">Uncollected <em>{workspace.uncollectedNodes.length}</em></span></div>
            {#each workspace.uncollectedNodes as node (node.id)}{@render nodeRow(node)}{/each}
          </section>
        {/if}

        {#if collectionFormOpen}
          <form class="collection-form" onsubmit={addCollection}>
            <input aria-label="Collection name" placeholder="Collection name, e.g. Characters" bind:value={collectionName} />
            <input aria-label="Collection item name" placeholder="Item name, e.g. Character" bind:value={itemName} />
            <select aria-label="Collection icon" bind:value={collectionIcon}>
              <option value="text">Text</option><option value="character">Character</option><option value="location">Location</option><option value="research">Research</option><option value="note">Note</option>
            </select>
            <div><button type="button" onclick={() => collectionFormOpen = false}>Cancel</button><button class="primary" disabled={!collectionName.trim() || !itemName.trim()}>Create</button></div>
          </form>
        {:else}
          <button class="new-collection" onclick={() => collectionFormOpen = true}>+ New Collection</button>
        {/if}
      </div>
    {:else}
      <div class="context-view">
        <section>
          <div class="context-label">Focused</div>
          {#if current}{@render nodeRow(current)}{/if}
        </section>

        {#if workspace.selectedNodeAncestors.length}
          <section><div class="context-label">Inside</div>{#each workspace.selectedNodeAncestors as node (node.id)}{@render nodeRow(node)}{/each}</section>
        {/if}

        {#if workspace.selectedNodeChildren.length}
          <section><div class="context-label">Contains</div>{#each workspace.selectedNodeChildren as node (node.id)}{@render nodeRow(node)}{/each}</section>
        {/if}

        <section>
          <div class="context-label">Related</div>
          {#each workspace.selectedNodeRelations as relation (relation.relationshipId)}
            <div class="related-row"><small>{relation.label}</small>{@render nodeRow(relation.node)}</div>
          {/each}
          {#if !workspace.selectedNodeRelations.length}<p class="empty">No confirmed relationships.</p>{/if}
          {#if relationOpen}
            <form class="relation-form" onsubmit={addRelationship}>
              <select aria-label="Related item" bind:value={relationTarget}><option value="">Choose an item</option>{#each availableRelationTargets as node}<option value={node.id}>{node.title}</option>{/each}</select>
              <input aria-label="Relationship" bind:value={relationType} />
              <input aria-label="Inverse relationship" bind:value={relationInverseType} />
              <div><button type="button" onclick={() => relationOpen = false}>Cancel</button><button class="primary" disabled={!relationTarget || !relationType.trim() || !relationInverseType.trim()}>Link</button></div>
            </form>
          {:else if availableRelationTargets.length}
            <button class="new-collection" onclick={() => relationOpen = true}>+ Link related material</button>
          {/if}
        </section>

        {#if current && workspace.navigator.collections.length}
          <section>
            <div class="context-label">Add inside {current.title}</div>
            <form class="relation-form" onsubmit={addChild}>
              <select aria-label="Child collection" bind:value={childCollection}>
                <option value="">Choose a Collection</option>
                {#each workspace.navigator.collections as collection}<option value={collection.id}>{collection.itemName}</option>{/each}
              </select>
              <input aria-label="Child title" placeholder="Title" bind:value={childTitle} />
              <div><button class="primary" disabled={!childCollection || !childTitle.trim()}>Add inside</button></div>
            </form>
          </section>
        {/if}

        <section>
          <div class="context-label">Applicable Todos</div>
          {#each workspace.selectedNodeTodos as todo (todo.id)}<p class="context-todo" class:done={todo.state === 'done'}>{todo.title}</p>{/each}
          {#if !workspace.selectedNodeTodos.length}<p class="empty">No Todos target this item.</p>{/if}
        </section>
      </div>
    {/if}
  </div>
</nav>

<style>
  .navigator { position: sticky; top: 104px; display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; height: calc(100vh - 104px); border-right: 1px solid var(--line); background: color-mix(in srgb, var(--paper-deep) 70%, var(--canvas)); color: var(--ink-soft); }
  .navigator-header { display: grid; gap: 12px; padding: 16px 14px 12px; border-bottom: 1px solid var(--line); }
  .navigator-header > div:first-child { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .navigator-header strong { color: var(--ink); font: 700 11px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .navigator-header small { overflow: hidden; color: var(--muted); font: 10px/1.2 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .mode-switch { display: grid; grid-template-columns: 1fr 1fr; padding: 2px; border: 1px solid var(--line); border-radius: 5px; background: var(--canvas); }
  .mode-switch button { min-height: 27px; border: 0; border-radius: 3px; background: transparent; color: var(--muted); font: 600 9px/1 var(--font-ui); cursor: pointer; }
  .mode-switch button.active { background: var(--paper); color: var(--accent); box-shadow: 0 1px 3px #3f392714; }
  .navigator-scroll { min-height: 0; overflow: auto; padding: 10px 8px 24px; }
  section { margin: 0 0 4px; }
  .fixed-section { padding-bottom: 5px; border-bottom: 1px solid var(--line); }
  .todo-section { padding: 5px 0; border-bottom: 1px solid var(--line); }
  .section-heading, .navigator-node { display: flex; align-items: center; min-height: 30px; padding-left: calc(var(--depth, 0) * 14px); border-radius: 4px; }
  .navigator-node.selected { background: var(--accent-soft); color: var(--accent); }
  .navigator-node:hover { background: color-mix(in srgb, var(--accent-soft) 55%, transparent); }
  button { cursor: pointer; }
  .disclosure { display: grid; flex: 0 0 22px; width: 22px; height: 25px; place-items: center; border: 0; background: transparent; color: var(--muted); font: 16px/1 var(--font-ui); }
  .disclosure.placeholder { display: block; }
  .heading-label, .node-link { display: flex; min-width: 0; flex: 1; align-items: center; gap: 7px; border: 0; background: transparent; color: inherit; text-align: left; }
  .heading-label { min-height: 30px; font: 700 10px/1.2 var(--font-ui); text-transform: uppercase; letter-spacing: .055em; }
  .heading-label em { margin-left: auto; color: var(--muted); font-style: normal; font-weight: 500; }
  .node-link { min-height: 30px; overflow: hidden; font: 500 12px/1.25 var(--font-ui); }
  .node-link span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .node-icon { width: 14px; color: var(--muted); text-align: center; }
  .todo-list, .collection-contents { padding: 0 0 7px 22px; }
  .todo-list label { display: flex; gap: 7px; align-items: flex-start; padding: 5px 3px; font: 11px/1.3 var(--font-ui); }
  .todo-list label.done span { color: var(--muted); text-decoration: line-through; }
  .todo-list label small { display: block; margin-top: 2px; color: var(--muted); font: 9px/1.2 var(--font-ui); text-decoration: none; }
  .todo-list input[type='checkbox'] { margin: 1px 0 0; accent-color: var(--accent); }
  .empty { margin: 5px 8px 8px 24px; color: var(--muted); font: 10px/1.4 var(--font-ui); }
  .quick-add { display: flex; gap: 4px; margin: 4px 5px 0 0; }
  .quick-add input { min-width: 0; flex: 1; height: 29px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); font: 10px/1 var(--font-ui); }
  .quick-add button { width: 29px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--accent); }
  .collection-list { padding-top: 5px; }
  .uncollected { margin-top: 8px; border-top: 1px dashed var(--line); padding-top: 6px; }
  .new-collection { width: 100%; margin-top: 7px; padding: 8px; border: 1px dashed var(--line-strong); border-radius: 4px; background: transparent; color: var(--muted); font: 600 10px/1 var(--font-ui); text-align: left; }
  .collection-form, .relation-form { display: grid; gap: 6px; margin: 8px 4px; padding: 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); }
  .collection-form input, .collection-form select, .relation-form input, .relation-form select { width: 100%; height: 31px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: #fff; font: 10px/1 var(--font-ui); }
  .collection-form > div, .relation-form > div { display: flex; justify-content: flex-end; gap: 5px; }
  .collection-form button, .relation-form button { min-height: 28px; border: 1px solid var(--line); border-radius: 3px; background: transparent; font: 600 9px/1 var(--font-ui); }
  .collection-form button.primary, .relation-form button.primary { background: var(--accent); color: white; }
  .context-view { padding-top: 7px; }
  .context-view section { padding: 6px 0 9px; border-bottom: 1px solid var(--line); }
  .context-label { margin: 0 6px 5px 24px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .1em; }
  .related-row { display: grid; grid-template-columns: 68px minmax(0, 1fr); align-items: center; }
  .related-row > small { overflow: hidden; color: var(--muted); font: 9px/1.2 var(--font-ui); text-align: right; text-overflow: ellipsis; white-space: nowrap; }
  .context-todo { margin: 5px 8px 5px 24px; font: 11px/1.35 var(--font-ui); }
  .context-todo.done { color: var(--muted); text-decoration: line-through; }
  @media (max-width: 680px) { .navigator { position: static; height: auto; max-height: 42vh; border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
