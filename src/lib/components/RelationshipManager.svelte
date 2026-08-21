<script lang="ts">
  import { workspace } from '$lib/state/workspace.svelte';
  import { nodeArchived, type RelationshipDefinition } from '$lib/workspace/navigator';
  import {
    relationshipSetDrafts,
    relationshipSets,
    sameRelationshipDefinition,
    type RelationshipSetDraft
  } from '$lib/workspace/relationship-sets';

  let { open, sourceNodeId, onClose }: {
    open: boolean;
    sourceNodeId: string | null;
    onClose: () => void;
  } = $props();

  let expandedSetIds = $state<string[]>([]);
  let setDrafts = $state<Record<string, RelationshipSetDraft>>(relationshipSetDrafts());
  let applyingSets = $state(false);
  let customOpen = $state(false);
  let customForward = $state('');
  let customInverse = $state('');
  let customDescription = $state('');
  let customSymmetric = $state(false);
  let editingDefinitionId = $state<string | null>(null);
  let editForward = $state('');
  let editInverse = $state('');
  let editDescription = $state('');
  let editSymmetric = $state(false);
  let deletingDefinitionId = $state<string | null>(null);
  let targetNodeId = $state('');
  let definitionChoice = $state('');
  let scopeNodeIds = $state<string[]>([]);
  let relationshipNote = $state('');
  let unlinkingRelationshipId = $state<string | null>(null);

  let sourceNode = $derived(sourceNodeId ? workspace.projectNodes.find((node) => node.id === sourceNodeId) ?? null : null);
  let availableTargets = $derived(workspace.projectNodes
    .filter((node) => node.id !== sourceNodeId && !nodeArchived(node))
    .sort((left, right) => left.title.localeCompare(right.title)));
  let scopeTargets = $derived(workspace.projectNodes
    .filter((node) => !['todos', 'navigator_todo'].includes(node.role ?? '') && !nodeArchived(node))
    .sort((left, right) => left.title.localeCompare(right.title)));
  let selectedSetItemCount = $derived(Object.values(setDrafts).filter((item) => item.selected && !setTemplateExists(item.id)).length);
  let selectedSetHasErrors = $derived(Object.values(setDrafts).some((item) => item.selected && (
    !item.forwardLabel.trim() || !item.inverseLabel.trim() || draftConflict(item.id)
  )));
  let selectedDefinition = $derived.by(() => {
    const [id, direction] = definitionChoice.split('|');
    const definition = workspace.navigator.relationshipDefinitions.find((item) => item.id === id) ?? null;
    return definition ? { definition, direction: direction === 'inverse' ? 'inverse' as const : 'forward' as const } : null;
  });
  let sourceRelationships = $derived(sourceNodeId ? workspace.navigator.relationships.filter((relationship) =>
    relationship.sourceNodeId === sourceNodeId || relationship.targetNodeId === sourceNodeId) : []);

  $effect(() => {
    if (!open) return;
    if (!definitionChoice && workspace.navigator.relationshipDefinitions.length) {
      definitionChoice = `${[...workspace.navigator.relationshipDefinitions].sort((a, b) => a.order - b.order)[0].id}|forward`;
    }
  });

  function definitionExists(candidate: Pick<RelationshipDefinition, 'forwardLabel' | 'inverseLabel'>): boolean {
    return workspace.navigator.relationshipDefinitions.some((definition) => sameRelationshipDefinition(definition, candidate));
  }

  function templateForDraft(id: string): RelationshipSetDraft | null {
    return setDrafts[id] ?? null;
  }

  function setTemplateExists(id: string): boolean {
    const draft = templateForDraft(id);
    return draft ? definitionExists(draft) : false;
  }

  function draftConflict(id: string): boolean {
    const draft = setDrafts[id];
    if (!draft?.selected) return false;
    if (definitionExists(draft)) return true;
    return Object.values(setDrafts).some((candidate) => candidate.id !== id && candidate.selected && sameRelationshipDefinition(draft, candidate));
  }

  function setExpanded(setId: string, expanded: boolean): void {
    expandedSetIds = expanded
      ? [...new Set([...expandedSetIds, setId])]
      : expandedSetIds.filter((id) => id !== setId);
  }

  function setSelectionState(setId: string): { checked: boolean; indeterminate: boolean; disabled: boolean } {
    const set = relationshipSets.find((candidate) => candidate.id === setId);
    const available = set?.items
      .map((item) => setDrafts[`${set.id}:${item.id}`])
      .filter((item) => item && !setTemplateExists(item.id)) ?? [];
    const selected = available.filter((item) => item.selected).length;
    return {
      checked: Boolean(available.length) && selected === available.length,
      indeterminate: selected > 0 && selected < available.length,
      disabled: !available.length
    };
  }

  function toggleSetSelection(setId: string, selected: boolean): void {
    const set = relationshipSets.find((candidate) => candidate.id === setId);
    if (!set) return;
    setDrafts = { ...setDrafts };
    for (const item of set.items) {
      const id = `${set.id}:${item.id}`;
      const draft = setDrafts[id];
      if (draft && !setTemplateExists(id)) setDrafts[id] = { ...draft, selected };
    }
    if (selected) setExpanded(setId, true);
  }

  function updateDraft(id: string, update: Partial<RelationshipSetDraft>): void {
    const draft = setDrafts[id];
    if (!draft) return;
    const next = { ...draft, ...update };
    if (next.symmetric) next.inverseLabel = next.forwardLabel;
    setDrafts = { ...setDrafts, [id]: next };
  }

  async function applyRelationshipSets(): Promise<void> {
    if (!selectedSetItemCount || selectedSetHasErrors || applyingSets) return;
    applyingSets = true;
    try {
      await workspace.recordNavigatorChange('Add relationship set', async () => {
        for (const draft of Object.values(setDrafts).filter((item) => item.selected)) {
          if (definitionExists(draft)) continue;
          await workspace.createRelationshipDefinition({
            forwardLabel: draft.forwardLabel,
            inverseLabel: draft.inverseLabel,
            description: draft.description,
            symmetric: draft.symmetric === true
          });
        }
      });
      setDrafts = relationshipSetDrafts();
      expandedSetIds = [];
    } finally {
      applyingSets = false;
    }
  }

  async function createCustomDefinition(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const created = await workspace.recordNavigatorChange('Create relationship definition', () => workspace.createRelationshipDefinition({
      forwardLabel: customForward,
      inverseLabel: customSymmetric ? customForward : customInverse,
      description: customDescription,
      symmetric: customSymmetric
    }));
    if (!created) return;
    definitionChoice = `${created.id}|forward`;
    customForward = '';
    customInverse = '';
    customDescription = '';
    customSymmetric = false;
    customOpen = false;
  }

  function beginDefinitionEdit(definition: RelationshipDefinition): void {
    editingDefinitionId = definition.id;
    deletingDefinitionId = null;
    editForward = definition.forwardLabel;
    editInverse = definition.inverseLabel;
    editDescription = definition.description;
    editSymmetric = definition.symmetric;
  }

  async function saveDefinition(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!editingDefinitionId) return;
    await workspace.recordNavigatorChange(`Update relationship: ${editForward.trim()}`, () => workspace.updateRelationshipDefinition(editingDefinitionId!, {
      forwardLabel: editForward,
      inverseLabel: editSymmetric ? editForward : editInverse,
      description: editDescription,
      symmetric: editSymmetric
    }));
    editingDefinitionId = null;
  }

  async function deleteDefinition(definition: RelationshipDefinition): Promise<void> {
    if (deletingDefinitionId !== definition.id) {
      deletingDefinitionId = definition.id;
      return;
    }
    await workspace.recordNavigatorChange(`Delete relationship definition: ${definition.forwardLabel}`, () => workspace.deleteRelationshipDefinition(definition.id));
    deletingDefinitionId = null;
    if (editingDefinitionId === definition.id) editingDefinitionId = null;
    if (definitionChoice.startsWith(`${definition.id}|`)) definitionChoice = '';
  }

  function toggleScope(id: string, checked: boolean): void {
    scopeNodeIds = checked ? [...new Set([...scopeNodeIds, id])] : scopeNodeIds.filter((item) => item !== id);
  }

  async function createRelationship(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!sourceNode || !targetNodeId || !selectedDefinition) return;
    const { definition, direction } = selectedDefinition;
    const type = direction === 'forward' ? definition.forwardLabel : definition.inverseLabel;
    const inverseType = direction === 'forward' ? definition.inverseLabel : definition.forwardLabel;
    const created = await workspace.recordNavigatorChange(`Create relationship: ${type}`, () => workspace.createNavigatorRelationship({
      sourceNodeId: sourceNode.id,
      targetNodeId,
      definitionId: definition.id,
      type,
      inverseType,
      scopeNodeIds,
      note: relationshipNote
    }));
    if (!created) return;
    targetNodeId = '';
    scopeNodeIds = [];
    relationshipNote = '';
  }

  async function unlinkRelationship(id: string): Promise<void> {
    if (unlinkingRelationshipId !== id) {
      unlinkingRelationshipId = id;
      return;
    }
    await workspace.recordNavigatorChange('Unlink relationship', () => workspace.removeNavigatorEntries({ relationshipIds: [id] }));
    unlinkingRelationshipId = null;
  }

  function relationshipProjection(relationship: (typeof workspace.navigator.relationships)[number]): { otherId: string; label: string } {
    return relationship.sourceNodeId === sourceNodeId
      ? { otherId: relationship.targetNodeId, label: relationship.type }
      : { otherId: relationship.sourceNodeId, label: relationship.inverseType };
  }

  function labelsFor(ids: string[]): string {
    return ids.map((id) => workspace.projectNodes.find((node) => node.id === id)?.title ?? id).join(', ');
  }
</script>

{#if open}
  <div class="relationship-manager-backdrop" role="presentation" onclick={onClose}>
    <div class="relationship-manager" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="relationship-manager-title" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
      <header>
        <div><small>Navigator</small><h2 id="relationship-manager-title">Manage Relationships</h2></div>
        <button type="button" class="manager-close" title="Close Relationship Manager" aria-label="Close Relationship Manager" onclick={onClose}>×</button>
      </header>

      <div class="manager-body">
        <section class="manager-section relationship-sets-section">
          <div class="section-heading">
            <div><h3>Writing relationship sets</h3><p>Add project-owned vocabulary. Sets never create links or writing content.</p></div>
            <button type="button" onclick={() => customOpen = !customOpen}>{customOpen ? 'Hide custom form' : 'Create custom definition'}</button>
          </div>

          {#if customOpen}
            <form class="definition-form" onsubmit={createCustomDefinition}>
              <label>Forward label<input aria-label="Custom forward relationship label" placeholder="supports" bind:value={customForward} /></label>
              <label>Inverse label<input aria-label="Custom inverse relationship label" placeholder="is supported by" disabled={customSymmetric} value={customSymmetric ? customForward : customInverse} oninput={(event) => customInverse = event.currentTarget.value} /></label>
              <label class="symmetric"><input type="checkbox" bind:checked={customSymmetric} /> Same label in both directions</label>
              <label class="description">Writer and AI guidance<textarea aria-label="Custom relationship description" rows="2" bind:value={customDescription}></textarea></label>
              <div><button type="button" onclick={() => customOpen = false}>Cancel</button><button class="primary" disabled={!customForward.trim() || (!customSymmetric && !customInverse.trim())}>Create definition</button></div>
            </form>
          {/if}

          <div class="set-list">
            {#each relationshipSets as set (set.id)}
              {@const selection = setSelectionState(set.id)}
              {@const expanded = expandedSetIds.includes(set.id)}
              <article class="relationship-set">
                <div class="set-heading">
                  <button type="button" class="set-disclosure" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${set.name}`} title={`${expanded ? 'Collapse' : 'Expand'} ${set.name}`} onclick={() => setExpanded(set.id, !expanded)}>{expanded ? '⌄' : '›'}</button>
                  <input type="checkbox" aria-label={`Select all definitions in ${set.name}`} checked={selection.checked} indeterminate={selection.indeterminate} disabled={selection.disabled} onchange={(event) => toggleSetSelection(set.id, event.currentTarget.checked)} />
                  <button type="button" class="set-title" onclick={() => setExpanded(set.id, !expanded)}><strong>{set.name}</strong><span>{set.description}</span></button>
                  <small>{set.items.length}</small>
                </div>
                {#if expanded}
                  <div class="set-items">
                    {#each set.items as item (`${set.id}:${item.id}`)}
                      {@const id = `${set.id}:${item.id}`}
                      {@const draft = setDrafts[id]}
                      {@const exists = setTemplateExists(id)}
                      {@const conflict = !exists && draftConflict(id)}
                      <div class="set-item" class:existing={exists} class:conflict>
                        <input type="checkbox" aria-label={`Add relationship definition ${draft.forwardLabel}`} checked={draft.selected} disabled={exists} onchange={(event) => updateDraft(id, { selected: event.currentTarget.checked })} />
                        <label>Forward<input aria-label={`${set.name} ${item.forwardLabel} forward label`} value={draft.forwardLabel} disabled={!draft.selected || exists} oninput={(event) => updateDraft(id, { forwardLabel: event.currentTarget.value })} /></label>
                        <label>Inverse<input aria-label={`${set.name} ${item.forwardLabel} inverse label`} value={draft.inverseLabel} disabled={!draft.selected || exists || draft.symmetric} oninput={(event) => updateDraft(id, { inverseLabel: event.currentTarget.value })} /></label>
                        <label class="set-symmetric"><input type="checkbox" checked={draft.symmetric === true} disabled={!draft.selected || exists} onchange={(event) => updateDraft(id, { symmetric: event.currentTarget.checked })} /> Symmetric</label>
                        <label class="set-guidance">Guidance<textarea aria-label={`${set.name} ${item.forwardLabel} guidance`} rows="2" value={draft.description} disabled={!draft.selected || exists} oninput={(event) => updateDraft(id, { description: event.currentTarget.value })}></textarea></label>
                        {#if exists}<span class="already-added">Added</span>{:else if conflict}<span class="name-conflict">Duplicate</span>{/if}
                      </div>
                    {/each}
                  </div>
                {/if}
              </article>
            {/each}
          </div>
          <div class="set-actions"><span>{selectedSetHasErrors ? 'Resolve missing or duplicate labels' : `${selectedSetItemCount} definition${selectedSetItemCount === 1 ? '' : 's'} selected`}</span><button type="button" class="primary" disabled={!selectedSetItemCount || selectedSetHasErrors || applyingSets} onclick={applyRelationshipSets}>{applyingSets ? 'Adding…' : 'Add selected definitions'}</button></div>
        </section>

        <section class="manager-section installed-section">
          <div class="section-heading"><div><h3>Project vocabulary</h3><p>Definitions are editable project data. Deleting one preserves existing links as independent labels.</p></div></div>
          {#if workspace.navigator.relationshipDefinitions.length}
            <div class="installed-list">
              {#each [...workspace.navigator.relationshipDefinitions].sort((a, b) => a.order - b.order) as definition (definition.id)}
                <div class="installed-row"><strong>{definition.forwardLabel}</strong><span>↔</span><strong>{definition.inverseLabel}</strong><small>{definition.description}</small><button type="button" onclick={() => editingDefinitionId === definition.id ? editingDefinitionId = null : beginDefinitionEdit(definition)}>{editingDefinitionId === definition.id ? 'Close' : 'Edit'}</button></div>
                {#if editingDefinitionId === definition.id}
                  <form class="definition-form edit-definition" onsubmit={saveDefinition}>
                    <label>Forward label<input aria-label="Edit forward relationship label" bind:value={editForward} /></label>
                    <label>Inverse label<input aria-label="Edit inverse relationship label" disabled={editSymmetric} value={editSymmetric ? editForward : editInverse} oninput={(event) => editInverse = event.currentTarget.value} /></label>
                    <label class="symmetric"><input type="checkbox" bind:checked={editSymmetric} /> Same label in both directions</label>
                    <label class="description">Writer and AI guidance<textarea aria-label="Edit relationship description" rows="2" bind:value={editDescription}></textarea></label>
                    {#if deletingDefinitionId === definition.id}<p class="delete-warning">Delete this definition? Existing links keep their current labels but will no longer share this vocabulary definition.</p>{/if}
                    <div><button type="button" class="danger" onclick={() => deleteDefinition(definition)}>{deletingDefinitionId === definition.id ? 'Confirm delete' : 'Delete definition'}</button><span></span><button type="button" onclick={() => { editingDefinitionId = null; deletingDefinitionId = null; }}>Cancel</button><button class="primary" disabled={!editForward.trim() || (!editSymmetric && !editInverse.trim())}>Save</button></div>
                  </form>
                {/if}
              {/each}
            </div>
          {:else}<p class="empty-state">No relationship vocabulary yet. Select one or more writing sets above, or create a custom definition.</p>{/if}
        </section>

        <section class="manager-section links-section">
          <div class="section-heading"><div><h3>Relationships for {sourceNode?.title ?? 'the selected item'}</h3><p>Create scoped, explained links. Applicability can cover any combination of structural Nodes.</p></div></div>
          {#if sourceNode}
            {#if sourceRelationships.length}
              <div class="link-list">
                {#each sourceRelationships as relationship (relationship.id)}
                  {@const projection = relationshipProjection(relationship)}
                  {@const other = workspace.projectNodes.find((node) => node.id === projection.otherId)}
                  <article class="link-row">
                    <div><strong>{projection.label}</strong> <span>{other?.title ?? projection.otherId}</span></div>
                    {#if relationship.scopeNodeIds?.length}<small>Applies during: {labelsFor(relationship.scopeNodeIds)}</small>{/if}
                    {#if relationship.note}<p>{relationship.note}</p>{/if}
                    <button type="button" class:danger={unlinkingRelationshipId === relationship.id} onclick={() => unlinkRelationship(relationship.id)}>{unlinkingRelationshipId === relationship.id ? 'Confirm unlink' : 'Unlink'}</button>
                  </article>
                {/each}
              </div>
            {:else}<p class="empty-state">No relationships are attached to this item.</p>{/if}

            <form class="link-form" onsubmit={createRelationship}>
              <label>Related item<select aria-label="Relationship target" bind:value={targetNodeId}><option value="">Choose an item</option>{#each availableTargets as node}<option value={node.id}>{node.title} · {workspace.navigatorNodeType(node)}</option>{/each}</select></label>
              <label>Relationship<select aria-label="Relationship definition and direction" bind:value={definitionChoice}><option value="">Choose a definition</option>{#each [...workspace.navigator.relationshipDefinitions].sort((a, b) => a.order - b.order) as definition}<option value={`${definition.id}|forward`}>{sourceNode.title} {definition.forwardLabel} …</option>{#if !definition.symmetric}<option value={`${definition.id}|inverse`}>{sourceNode.title} {definition.inverseLabel} …</option>{/if}{/each}</select></label>
              {#if selectedDefinition}<p class="definition-guidance">{selectedDefinition.definition.description}</p>{/if}
              <fieldset><legend>Applies during <span>optional</span></legend><div class="scope-list">{#each scopeTargets as node}<label><input type="checkbox" checked={scopeNodeIds.includes(node.id)} onchange={(event) => toggleScope(node.id, event.currentTarget.checked)} /> <span>{node.title}</span><small>{workspace.navigatorNodeType(node)}</small></label>{/each}</div></fieldset>
              <label>Relationship note <span>optional</span><textarea aria-label="Relationship note" rows="3" placeholder="Explain the specific writing meaning or change over time" bind:value={relationshipNote}></textarea></label>
              <div><button class="primary" disabled={!targetNodeId || !selectedDefinition}>Create relationship</button></div>
            </form>
          {:else}<p class="empty-state">Select a structural item before creating a relationship.</p>{/if}
        </section>
      </div>

      <footer><span>Relationship definitions and links belong to this project.</span><button type="button" onclick={onClose}>Done</button></footer>
    </div>
  </div>
{/if}

<style>
  .relationship-manager-backdrop { position: fixed; z-index: 96; inset: 0; display: grid; place-items: center; padding: 24px; background: rgb(34 31 27 / .42); backdrop-filter: blur(3px); }
  .relationship-manager { display: flex; width: min(1040px, 100%); max-height: calc(100vh - 48px); flex-direction: column; overflow: hidden; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: var(--ink-soft); box-shadow: 0 24px 80px rgb(25 22 17 / .24); }
  .relationship-manager > header { display: flex; align-items: center; justify-content: space-between; padding: 19px 22px 16px; border-bottom: 1px solid var(--line); }
  header small { color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .12em; }
  h2 { margin: 4px 0 0; color: var(--ink); font: 500 25px/1.1 var(--font-reading); }
  .manager-close { width: 32px; height: 32px; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font: 24px/1 var(--font-ui); }
  .manager-close:hover { background: var(--paper-deep); color: var(--ink); }
  .manager-body { min-height: 0; overflow: auto; }
  .manager-section { padding: 18px 22px; }
  .manager-section + .manager-section { border-top: 1px solid var(--line); }
  .section-heading { display: flex; align-items: start; justify-content: space-between; gap: 18px; margin-bottom: 12px; }
  .section-heading h3 { margin: 0; color: var(--ink); font: 700 11px/1.2 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .section-heading p { margin: 4px 0 0; color: var(--muted); font: 10px/1.4 var(--font-ui); }
  .section-heading > button, .installed-row button { min-height: 28px; padding: 0 9px; border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); font: 600 9px/1 var(--font-ui); }
  .set-list { display: grid; gap: 7px; }
  .relationship-set { overflow: hidden; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--canvas) 45%, var(--paper)); }
  .set-heading { display: grid; grid-template-columns: 28px 22px minmax(0, 1fr) auto; min-height: 48px; align-items: center; padding: 0 11px 0 6px; }
  .set-disclosure { width: 28px; height: 32px; border: 0; background: transparent; color: var(--muted); font: 18px/1 var(--font-ui); }
  .set-heading > input, .set-item > input { width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
  .set-title { display: grid; min-width: 0; gap: 3px; padding: 7px 9px; border: 0; background: transparent; text-align: left; }
  .set-title strong { color: var(--ink); font: 700 11px/1.2 var(--font-ui); }
  .set-title span { overflow: hidden; color: var(--muted); font: 9px/1.25 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .set-heading > small { color: var(--muted); font: 9px/1 var(--font-ui); }
  .set-items { border-top: 1px solid var(--line); background: var(--paper); }
  .set-item { display: grid; grid-template-columns: 22px minmax(120px, 1fr) minmax(120px, 1fr) 82px minmax(160px, 1.4fr) auto; gap: 8px; align-items: center; padding: 9px 12px; border-bottom: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
  .set-item:last-child { border-bottom: 0; }
  .set-item label, .definition-form label, .link-form > label { display: grid; gap: 4px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .04em; }
  .set-item label.set-symmetric { display: flex; align-items: center; gap: 5px; text-transform: none; }
  .set-item label.set-symmetric input { width: 13px; height: 13px; }
  .set-item input:not([type='checkbox']), .set-item textarea, .definition-form input, .link-form select, .definition-form textarea, .link-form textarea { min-width: 0; width: 100%; padding: 0 7px; border: 1px solid var(--line); border-radius: 3px; background: #fff; color: var(--ink); font: 10px/1 var(--font-ui); text-transform: none; }
  .set-item input:not([type='checkbox']), .definition-form input, .link-form select { height: 30px; }
  textarea { padding-top: 7px !important; line-height: 1.4 !important; resize: vertical; }
  input:disabled, textarea:disabled { background: var(--paper-deep) !important; color: var(--muted) !important; }
  .already-added, .name-conflict { color: var(--accent); font: 700 8px/1 var(--font-ui); text-transform: uppercase; }
  .name-conflict { color: #8d3329; }
  .set-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding-top: 10px; }
  .set-actions span { margin-right: auto; color: var(--muted); font: 9px/1.3 var(--font-ui); }
  button.primary, .definition-form button, .link-form button, .set-actions button, footer button { min-height: 31px; padding: 0 10px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink-soft); font: 600 9px/1 var(--font-ui); }
  button.primary { border-color: var(--accent); background: var(--accent); color: white; }
  button:disabled { cursor: default; opacity: .4; }
  .definition-form, .link-form { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin: 10px 0; padding: 12px; border: 1px solid var(--line); border-radius: 4px; background: var(--canvas); }
  .definition-form .symmetric { display: flex; align-items: center; gap: 6px; align-self: end; min-height: 30px; text-transform: none; }
  .description, .definition-form > div, .delete-warning, .link-form fieldset, .link-form > p { grid-column: 1 / -1; }
  .definition-form > div, .link-form > div { display: flex; justify-content: flex-end; gap: 6px; }
  .definition-form > div span { flex: 1; }
  button.danger, .danger { color: #8d3329 !important; }
  .delete-warning { margin: 0; padding: 8px; border-left: 2px solid #8d3329; background: #8d33290b; color: #773129; font: 9px/1.45 var(--font-ui); }
  .installed-list, .link-list { display: grid; gap: 5px; }
  .installed-row { display: grid; grid-template-columns: minmax(90px, .8fr) 20px minmax(90px, .8fr) minmax(160px, 1.5fr) auto; gap: 7px; align-items: center; min-height: 37px; padding: 0 6px; border-bottom: 1px solid var(--line); }
  .installed-row strong { color: var(--ink); font: 600 10px/1.2 var(--font-ui); }
  .installed-row span { color: var(--muted); text-align: center; }
  .installed-row small { color: var(--muted); font: 9px/1.3 var(--font-ui); }
  .empty-state { margin: 5px 0; padding: 10px; background: var(--paper-deep); color: var(--muted); font: 10px/1.45 var(--font-ui); }
  .link-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); }
  .link-row > div strong { color: var(--accent); font: 700 10px/1.2 var(--font-ui); }
  .link-row > div span { color: var(--ink); font: 600 10px/1.2 var(--font-ui); }
  .link-row small, .link-row p { grid-column: 1; margin: 0; color: var(--muted); font: 9px/1.4 var(--font-ui); }
  .link-row button { grid-column: 2; grid-row: 1 / span 3; align-self: center; min-height: 27px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--muted); font: 600 8px/1 var(--font-ui); }
  .definition-guidance { margin: 0; padding: 7px 8px; background: var(--paper-deep); color: var(--muted); font: 9px/1.4 var(--font-ui); }
  .link-form fieldset { min-width: 0; margin: 0; padding: 8px; border: 1px solid var(--line); }
  .link-form legend { color: var(--ink-soft); font: 700 8px/1 var(--font-ui); text-transform: uppercase; }
  .link-form legend span, .link-form > label > span { color: var(--muted); font-weight: 400; text-transform: none; }
  .scope-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); max-height: 145px; overflow: auto; gap: 3px; }
  .scope-list label { display: grid; grid-template-columns: 15px minmax(0, 1fr) auto; align-items: center; gap: 5px; min-height: 25px; padding: 0 5px; border-radius: 3px; color: var(--ink-soft); font: 9px/1.2 var(--font-ui); }
  .scope-list label:hover { background: var(--paper); }
  .scope-list input { width: 13px; height: 13px; margin: 0; accent-color: var(--accent); }
  .scope-list span, .scope-list small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scope-list small { color: var(--muted); font-size: 8px; }
  .relationship-manager > footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-height: 56px; padding: 10px 22px; border-top: 1px solid var(--line); background: var(--paper-deep); }
  footer span { margin-right: auto; color: var(--muted); font: 9px/1.3 var(--font-ui); }
  @media (max-width: 760px) {
    .relationship-manager-backdrop { padding: 10px; }
    .relationship-manager { max-height: calc(100vh - 20px); }
    .set-item { grid-template-columns: 22px 1fr 1fr; }
    .set-guidance, .already-added, .name-conflict { grid-column: 2 / -1; }
    .installed-row { grid-template-columns: 1fr 20px 1fr auto; }
    .installed-row small { grid-column: 1 / -1; }
    .scope-list { grid-template-columns: 1fr; }
  }
</style>
