<script lang="ts">
  import { makeId, categories, categoryMeta } from '$lib/domain';
  import { aiResponseContracts, type AIActionDefinition, type AIActionTargetScope } from '$lib/ai/actions';

  interface ProviderChoice { id: string; label: string; model?: string; available: boolean }
  interface Props {
    actions: AIActionDefinition[];
    providers: ProviderChoice[];
    onSave: (action: AIActionDefinition) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onRun: (id: string) => void;
    onClose: () => void;
  }

  let { actions, providers, onSave, onDelete, onRun, onClose }: Props = $props();
  let selectedId = $state('');
  let draft = $state<AIActionDefinition>(copy(undefined));
  let initialized = $state(false);
  let saving = $state(false);
  let error = $state('');
  let deleteArmed = $state(false);

  $effect(() => {
    if (initialized || !actions[0]) return;
    selectedId = actions[0].id;
    draft = copy(actions[0]);
    initialized = true;
  });

  function copy(action: AIActionDefinition | undefined): AIActionDefinition {
    return action ? JSON.parse(JSON.stringify(action)) as AIActionDefinition : {
      id: makeId('action'), name: '', description: '', version: 0, intent: 'review',
      instruction: '', allowedTargets: ['selection'], defaultTarget: 'selection', requiresSelection: true,
      context: { includeMaterial: true, includeRelationships: true, includeTodos: true, addedSourceIds: [] },
      responseContract: 'annotated_findings', optionCount: 3, includeExplanation: true,
      inputCategory: 'canon', maxOutputTokens: 15000
    };
  }

  function select(action: AIActionDefinition): void {
    selectedId = action.id;
    draft = copy(action);
    error = '';
    deleteArmed = false;
  }

  function add(): void {
    selectedId = '';
    draft = copy(undefined);
    error = '';
    deleteArmed = false;
  }

  function toggleTarget(scope: AIActionTargetScope, checked: boolean): void {
    const targets = checked ? [...new Set([...draft.allowedTargets, scope])] : draft.allowedTargets.filter((item) => item !== scope);
    draft = {
      ...draft,
      allowedTargets: targets,
      defaultTarget: targets.includes(draft.defaultTarget) ? draft.defaultTarget : targets[0] ?? 'selection',
      requiresSelection: targets.length === 1 && targets[0] === 'selection' ? true : draft.requiresSelection
    };
  }

  async function save(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    error = '';
    if (!draft.allowedTargets.length) { error = 'Select at least one target scope.'; return; }
    saving = true;
    try {
      await onSave(draft);
      selectedId = draft.id;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not save the action.';
    } finally {
      saving = false;
    }
  }

  async function remove(): Promise<void> {
    if (!selectedId) return;
    if (!deleteArmed) { deleteArmed = true; return; }
    saving = true;
    try {
      await onDelete(selectedId);
      const remaining = actions.filter((action) => action.id !== selectedId);
      selectedId = remaining[0]?.id ?? '';
      draft = copy(remaining[0]);
      deleteArmed = false;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not delete the action.';
    } finally {
      saving = false;
    }
  }
</script>

<div class="action-manager" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="action-manager-title" onclick={(event) => event.stopPropagation()} onkeydown={(event) => { event.stopPropagation(); if (event.key === 'Escape') onClose(); }}>
  <header><div><small>Project settings</small><h2 id="action-manager-title">AI actions</h2></div><button type="button" onclick={onClose}>×</button></header>
  <p class="intro">Actions belong to this project and travel with its compact export. Run them here or use <b>Perform action…</b> in Inputs or beside selected text.</p>
  <div class="body">
    <aside>
      {#each actions as action}
        <button type="button" class:active={selectedId === action.id} onclick={() => select(action)}><strong>{action.name}</strong><small>{action.responseContract.replaceAll('_', ' ')}</small></button>
      {/each}
      <button type="button" class="add" onclick={add}>+ New action</button>
    </aside>
    <form onsubmit={save}>
      <div class="two"><label>Name<input required bind:value={draft.name} /></label><label>Intent<select bind:value={draft.intent}><option value="review">Review</option><option value="revise">Revise</option><option value="discuss">Discuss</option><option value="generate">Generate</option></select></label></div>
      <label>Description<input bind:value={draft.description} placeholder="What this action is for" /></label>
      <label>Instructions<textarea required rows="6" bind:value={draft.instruction}></textarea></label>
      <div class="two"><label>Response contract<select bind:value={draft.responseContract}>{#each aiResponseContracts as contract}<option value={contract}>{contract.replaceAll('_', ' ')}</option>{/each}</select></label><label>Input category<select bind:value={draft.inputCategory}>{#each categories as category}<option value={category}>{categoryMeta[category].label}</option>{/each}</select></label></div>
      <fieldset><legend>Permitted target</legend><label><input type="checkbox" checked={draft.allowedTargets.includes('selection')} onchange={(event) => toggleTarget('selection', event.currentTarget.checked)} />Selection</label><label><input type="checkbox" checked={draft.allowedTargets.includes('document')} onchange={(event) => toggleTarget('document', event.currentTarget.checked)} />Document</label><label><input type="checkbox" disabled={!draft.allowedTargets.includes('selection')} bind:checked={draft.requiresSelection} />Require a selection</label></fieldset>
      <fieldset><legend>Default read-only context</legend><label><input type="checkbox" bind:checked={draft.context.includeMaterial} />Material</label><label><input type="checkbox" bind:checked={draft.context.includeRelationships} />Relationships</label><label><input type="checkbox" bind:checked={draft.context.includeTodos} />Open Todos</label></fieldset>
      <div class="two"><label>Preferred provider<select bind:value={draft.preferredSourceId}><option value={undefined}>Use enabled AI providers</option>{#each providers as provider}<option value={provider.id} disabled={!provider.available}>{provider.label}{provider.model ? ` — ${provider.model}` : ''}</option>{/each}</select></label><label>Maximum output tokens<input type="number" min="1000" max="50000" step="1000" bind:value={draft.maxOutputTokens} /></label></div>
      <div class="two"><label>Revision options<input type="number" min="1" max="5" disabled={draft.responseContract !== 'revision_options'} bind:value={draft.optionCount} /></label><label>Temperature <small>blank lets the provider decide</small><input type="number" min="0" max="2" step="0.1" value={draft.temperature ?? ''} oninput={(event) => draft.temperature = event.currentTarget.value === '' ? undefined : Number(event.currentTarget.value)} /></label></div>
      <label class="explanation"><input type="checkbox" bind:checked={draft.includeExplanation} />Request explanations where the contract supports them</label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <footer><div>{#if selectedId}<button type="button" class:danger={deleteArmed} disabled={saving} onclick={remove}>{deleteArmed ? 'Confirm delete' : 'Delete'}</button>{/if}</div>{#if selectedId}<button type="button" disabled={saving} onclick={() => onRun(selectedId)}>Run saved action</button>{/if}<button type="button" disabled={saving} onclick={onClose}>Close</button><button class="primary" disabled={saving || !draft.name.trim() || !draft.instruction.trim() || !draft.allowedTargets.length}>{saving ? 'Saving…' : 'Save action'}</button></footer>
    </form>
  </div>
</div>

<style>
  .action-manager { width: min(920px, 96vw); max-height: min(820px, 92vh); overflow: hidden; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); box-shadow: 0 24px 70px rgb(0 0 0 / .24); color: var(--ink); font-family: var(--font-ui); }
  .action-manager > header { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--line); }
  h2 { margin: 2px 0 0; font-size: 18px; } small, .intro { color: var(--muted); } header button { border: 0; background: transparent; font-size: 20px; cursor: pointer; }
  .intro { margin: 0; padding: 10px 18px; border-bottom: 1px solid var(--line); font-size: 11px; }
  .body { display: grid; grid-template-columns: 190px minmax(0, 1fr); min-height: 0; max-height: calc(92vh - 105px); }
  aside { overflow: auto; padding: 10px; border-right: 1px solid var(--line); background: var(--canvas); }
  aside button { display: grid; width: 100%; gap: 3px; margin-bottom: 5px; padding: 9px; border: 1px solid transparent; border-radius: 3px; background: transparent; text-align: left; cursor: pointer; }
  aside button.active { border-color: var(--accent); background: var(--paper); } aside .add { margin-top: 10px; color: var(--accent); }
  form { overflow: auto; padding: 16px 18px 20px; } label { display: grid; gap: 5px; margin-bottom: 11px; font-size: 10px; font-weight: 700; }
  input, select, textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--line-strong); border-radius: 3px; background: #fffdf8; padding: 8px; color: var(--ink); font: 12px/1.4 var(--font-ui); }
  textarea { resize: vertical; } .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  fieldset { display: flex; flex-wrap: wrap; gap: 12px; margin: 0 0 12px; border: 1px solid var(--line); } fieldset label, .explanation { display: flex; align-items: center; gap: 6px; margin: 0; font-weight: 500; } fieldset input, .explanation input { width: auto; }
  footer { display: flex; justify-content: flex-end; gap: 7px; padding-top: 12px; border-top: 1px solid var(--line); } footer div { margin-right: auto; }
  button { border: 1px solid var(--line-strong); border-radius: 3px; background: var(--paper); padding: 7px 10px; cursor: pointer; } button.primary { border-color: var(--accent); background: var(--accent); color: white; } button.danger, .error { color: var(--reject); }
  @media (max-width: 720px) { .body { grid-template-columns: 1fr; } aside { display: flex; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--line); } aside button { min-width: 150px; } .two { grid-template-columns: 1fr; } }
</style>
