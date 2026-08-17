<script lang="ts">
  import { onMount, tick } from 'svelte';
  import EditorShell from '$lib/editor/EditorShell.svelte';
  import SuggestionCard from '$lib/components/SuggestionCard.svelte';
  import LedgerTail from '$lib/components/LedgerTail.svelte';
  import { categories, categoryMeta, makeId, sourceCatalog, suggestionFingerprint, wordCount, type Branch, type Suggestion, type WritingBrief } from '$lib/domain';
  import { workspace } from '$lib/state/workspace.svelte';

  let editor: EditorShell;
  let selection = { from: 1, to: 1, text: '' };
  let selectedVariants: Record<string, number> = {};
  let settingsOpen = false;
  let ledgerOpen = false;
  let sourceLegendOpen = false;
  let briefDraft: WritingBrief = { ...workspace.brief };
  let sentinelInstruction = '';
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let editSession = { started: 0, characters: 0, text: '' };
  let editorReady = false;
  let documentText = '';
  let cardTops: Record<string, number> = {};
  let cardsHeight = 0;
  let cardsElement: HTMLDivElement;
  let undoDismiss: { suggestion: Suggestion; timer: ReturnType<typeof setTimeout> } | null = null;
  let liveSuggestions: Suggestion[] = [];
  let queuedCount = 0;
  let isPaused = false;

  $: activeSuggestion = workspace.suggestions.find((suggestion) => suggestion.id === workspace.activeSuggestionId) ?? null;
  $: selectedPrompt = workspace.prompts.find((prompt) => prompt.id === 'sentinel') ?? workspace.prompts[0];

  onMount(() => {
    void workspace.initialize().then(() => {
      briefDraft = { ...workspace.brief };
      sentinelInstruction = workspace.prompts.find((prompt) => prompt.id === 'sentinel')?.instruction ?? '';
    });
    const keydown = (event: KeyboardEvent) => handleReviewKeys(event);
    const relayout = () => layoutCards();
    window.addEventListener('keydown', keydown);
    window.addEventListener('resize', relayout);
    window.addEventListener('scroll', relayout, { passive: true });
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('scroll', relayout);
      if (editTimer) clearTimeout(editTimer);
      if (scanTimer) clearTimeout(scanTimer);
      if (noticeTimer) clearTimeout(noticeTimer);
    };
  });

  $: if (liveSuggestions.length && editorReady) void tick().then(layoutCards);

  function layoutCards(): void {
    if (!editor || !cardsElement || workspace.surface !== 'docked') return;
    const measuredHeights = new Map(
      Array.from(cardsElement.querySelectorAll<HTMLElement>('.card-slot'))
        .map((slot) => [slot.dataset.suggestionId ?? '', slot.offsetHeight])
    );
    const next: Record<string, number> = {};
    let floor = 18;
    for (const suggestion of liveSuggestions) {
      const anchored = editor.getSuggestionTop?.(suggestion) ?? floor;
      const top = Math.max(floor, anchored);
      next[suggestion.id] = top;
      const measuredHeight = measuredHeights.get(suggestion.id);
      const fallbackHeight = suggestion.variants.length ? 218 : 150;
      floor = top + (measuredHeight || fallbackHeight) + 20;
    }
    cardTops = next;
    cardsHeight = floor;
  }

  function observeCard(node: HTMLElement): { destroy: () => void } {
    const observer = new ResizeObserver(() => layoutCards());
    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  function refreshLiveSuggestions(): void {
    const seen = new Set<string>();
    liveSuggestions = workspace.mode === 'drafting' ? [] : workspace.suggestions
      .filter((suggestion) => suggestion.state === 'pending')
      .filter((suggestion) => workspace.categoryVisibility[suggestion.category])
      .filter((suggestion) => workspace.sourceStates[suggestion.source] === 'visible')
      .filter((suggestion) => {
        const fingerprint = suggestionFingerprint(suggestion);
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      })
      .sort((a, b) => a.order - b.order)
      .slice(0, workspace.densityCap);
    queuedCount = Math.max(0, workspace.suggestions.filter((suggestion) => suggestion.state === 'pending').length - liveSuggestions.length);
  }

  function showNotice(message: string): void {
    if (noticeTimer) clearTimeout(noticeTimer);
    workspace.notice = message;
    noticeTimer = setTimeout(() => {
      if (workspace.notice === message) workspace.notice = null;
      noticeTimer = null;
    }, 4000);
  }

  function dismissNotice(): void {
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    workspace.notice = null;
  }

  async function changeMode(mode: 'drafting' | 'revising'): Promise<void> {
    const change = workspace.setMode(mode);
    refreshLiveSuggestions();
    await change;
    await tick();
    layoutCards();
  }

  function changeCategory(category: (typeof categories)[number]): void {
    workspace.toggleCategory(category);
    refreshLiveSuggestions();
  }

  async function changeSource(sourceId: string): Promise<void> {
    await workspace.cycleSource(sourceId);
    refreshLiveSuggestions();
  }

  async function changePause(): Promise<void> {
    const change = workspace.togglePause();
    isPaused = workspace.paused;
    await change;
  }

  function textChanged(detail: { text: string; characters: number; origin?: unknown }): void {
    documentText = detail.text;
    if (!editorReady) {
      editorReady = true;
      return;
    }
    if (editor) {
      void workspace.reconcileSuggestionAnchors((suggestion) => editor.resolveSuggestionAnchor(suggestion));
      refreshLiveSuggestions();
    }
    if (detail.origin) return;
    const now = Date.now();
    if (!editSession.started) editSession.started = now;
    editSession.characters += detail.characters;
    editSession.text = detail.text;
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      const durationMs = Date.now() - editSession.started;
      void workspace.log('human_edit_session', { characters: editSession.characters, durationMs, wordCount: wordCount(editSession.text), mode: workspace.mode });
      editSession = { started: 0, characters: 0, text: '' };
    }, 1600);
    if (scanTimer) clearTimeout(scanTimer);
    if (workspace.mode === 'revising' && !workspace.paused) scanTimer = setTimeout(() => void runSentinels(), 5000);
  }

  async function runSentinels(): Promise<void> {
    if (!editor || !selectedPrompt || workspace.paused) return;
    await workspace.reconcileSuggestionAnchors((suggestion) => editor.resolveSuggestionAnchor(suggestion));
    const paragraphs = editor.getParagraphs();
    const results = await Promise.all(paragraphs.map((paragraph) => workspace.requestSuggestions({ ...paragraph, prompt: selectedPrompt }, `${workspace.branchId}:${paragraph.from}:${paragraph.to}`)));
    const incoming = results.flat();
    const valid = new Set<string>();
    for (const suggestion of incoming) {
      if (editor.getTextBetween(suggestion.anchor.from, suggestion.anchor.to) !== suggestion.anchor.text) {
        void workspace.resolveSuggestion(suggestion.id, 'stale', 'stale_on_arrival', { expected: suggestion.anchor.text });
        continue;
      }
      valid.add(suggestion.id);
      const relative = editor.getRelativeAnchor(suggestion.anchor.from, suggestion.anchor.to);
      workspace.suggestions = workspace.suggestions.map((item) => item.id === suggestion.id ? { ...item, anchor: { ...item.anchor, ...relative } } : item);
    }
    if (workspace.mode === 'drafting') showNotice(valid.size
      ? `${valid.size} new ${valid.size === 1 ? 'note' : 'notes'} added.`
      : 'Craft pass complete; no new notes.');
    refreshLiveSuggestions();
    await tick();
    layoutCards();
  }

  async function runSelection(promptId: string): Promise<void> {
    if (!selection.text.trim()) return;
    await workspace.reconcileSuggestionAnchors((suggestion) => editor.resolveSuggestionAnchor(suggestion));
    const prompt = workspace.prompts.find((item) => item.id === promptId) ?? { id: promptId, name: promptId, version: 1, instruction: `Offer a ${promptId} revision.` };
    const incoming = await workspace.requestSuggestions({ text: selection.text, from: selection.from, to: selection.to, prompt }, `${workspace.branchId}:selection:${selection.from}:${selection.to}`);
    for (const suggestion of incoming) {
      const relative = editor.getRelativeAnchor(suggestion.anchor.from, suggestion.anchor.to);
      workspace.suggestions = workspace.suggestions.map((item) => item.id === suggestion.id ? { ...item, anchor: { ...item.anchor, ...relative } } : item);
    }
    if (workspace.mode === 'drafting') await changeMode('revising');
    else {
      refreshLiveSuggestions();
      await tick();
      layoutCards();
    }
    if (incoming[0]) void activateCard(incoming[0].id);
  }

  function activateFromEditor(id: string): void {
    workspace.activate(id);
    void tick().then(layoutCards);
  }

  async function activateCard(id: string): Promise<void> {
    workspace.activate(id);
    await tick();
    cardsElement?.querySelector<HTMLElement>(`.card-slot[data-suggestion-id="${id}"] .card`)?.focus({ preventScroll: true });
    layoutCards();
  }

  function chooseVariant(id: string, index: number): void {
    selectedVariants = { ...selectedVariants, [id]: index };
    workspace.activate(id);
  }

  async function accept(suggestion: Suggestion, index: number, edit = false, viaKeyboard = false): Promise<void> {
    const variants = suggestion.variants.length ? suggestion.variants : suggestion.payload.text !== undefined ? [{ id: `${suggestion.id}_primary`, text: suggestion.payload.text }] : [];
    const variant = variants[index];
    if (!variant) return;
    if (variant.text === suggestion.anchor.text) {
      await workspace.resolveSuggestion(suggestion.id, 'stale', 'stale_on_arrival', { reason: 'no_op_replacement' });
      refreshLiveSuggestions();
      showNotice('That option matched the current text, so nothing was applied.');
      return;
    }
    workspace.clearPreview();
    const result = editor.acceptSuggestion(suggestion, variant.text);
    if (!result.ok) {
      await workspace.resolveSuggestion(suggestion.id, 'stale', 'stale_on_arrival', { reason: result.reason });
      showNotice('That note expired because its text changed.');
      return;
    }
    const eventType = edit ? 'accepted_then_edited' : viaKeyboard ? 'accepted_via_keyboard' : 'accepted_via_tick';
    await workspace.resolveSuggestion(suggestion.id, 'accepted', eventType, { variantId: variant.id, replacement: variant.text });
    await workspace.supersedeSiblings(suggestion, variant.id);
    refreshLiveSuggestions();
    if (edit && result.from != null && result.to != null) {
      if (variant.text) editor.selectRange(result.from, result.to);
      else editor.focusAt(result.to);
    }
  }

  async function reject(suggestion: Suggestion, viaDrag: boolean): Promise<void> {
    if (viaDrag) {
      await workspace.resolveSuggestion(suggestion.id, 'rejected', 'dismissed_via_drag', { gestureDistance: 40 });
      if (undoDismiss) clearTimeout(undoDismiss.timer);
      const timer = setTimeout(() => { undoDismiss = null; }, 5000);
      undoDismiss = { suggestion, timer };
    } else await workspace.resolveSuggestion(suggestion.id, 'rejected', 'rejected', { surface: workspace.surface });
    refreshLiveSuggestions();
  }

  async function undoDragDismiss(): Promise<void> {
    if (!undoDismiss) return;
    clearTimeout(undoDismiss.timer);
    const restored = undoDismiss.suggestion;
    workspace.suggestions = workspace.suggestions.map((item) => item.id === restored.id ? { ...item, state: 'pending' } : item);
    refreshLiveSuggestions();
    undoDismiss = null;
    await workspace.log('dismiss_undone', { restored: true }, restored.id);
  }

  function handleReviewKeys(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select') || target.isContentEditable || workspace.mode !== 'revising' || !liveSuggestions.length) return;
    const list = liveSuggestions;
    let index = list.findIndex((suggestion) => suggestion.id === workspace.activeSuggestionId);
    if (event.key === 'Tab') {
      event.preventDefault();
      index = index < 0 ? 0 : (index + (event.shiftKey ? -1 : 1) + list.length) % list.length;
      void activateCard(list[index].id);
      return;
    }
    const current = list[index < 0 ? 0 : index];
    if (!current) return;
    if (/^[123]$/.test(event.key)) {
      const variant = Number(event.key) - 1;
      if (variant < current.variants.length) { event.preventDefault(); chooseVariant(current.id, variant); workspace.setPreview(current.id, current.variants[variant].text); }
    } else if (event.key === 'Enter') { event.preventDefault(); void accept(current, selectedVariants[current.id] ?? 0, false, true); }
    else if (event.key === 'e') { event.preventDefault(); void accept(current, selectedVariants[current.id] ?? 0, true, true); }
    else if (event.key === 'x' || event.key === 'Escape') { event.preventDefault(); void reject(current, false); }
  }

  async function saveSettings(): Promise<void> {
    await workspace.saveBrief(briefDraft);
    const prompt = workspace.prompts.find((item) => item.id === 'sentinel');
    if (prompt && sentinelInstruction !== prompt.instruction) await workspace.savePrompt({ ...prompt, instruction: sentinelInstruction });
    settingsOpen = false;
    showNotice(`Brief v${workspace.brief.version} saved; older notes expired.`);
  }

  async function forkBranch(): Promise<void> {
    const name = window.prompt('Name this branch', `Alternative ${workspace.branches.length}`)?.trim();
    if (!name || !editor) return;
    const id = makeId('branch');
    await editor.forkTo(id);
    const branch: Branch = { id, name, parentId: workspace.branchId, createdAt: new Date().toISOString(), wordCount: wordCount(editor.getText()), lastEdited: new Date().toISOString() };
    await workspace.addBranch(branch);
    await workspace.switchBranch(id);
  }

  async function exportMarkdown(): Promise<void> {
    const result = await workspace.exportMarkdown(editor.getText(), workspace.branches.find((branch) => branch.id === workspace.branchId)?.name);
    const href = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(href);
  }
</script>

<svelte:head><title>Margin Note — writing support</title><meta name="description" content="A meta-first creative writing support workbench." /></svelte:head>

<div class="app-shell" class:revising={workspace.mode === 'revising'}>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Margin Note home"><span>¶</span><strong>Margin Note</strong><small>writing workbench</small></a>
    <div class="mode-switch" aria-label="Writing mode">
      <button class:active={workspace.mode === 'drafting'} on:click={() => changeMode('drafting')}>Drafting</button>
      <button class:active={workspace.mode === 'revising'} on:click={() => changeMode('revising')}>Revising {#if workspace.pendingCount}<span>{workspace.pendingCount}</span>{/if}</button>
    </div>
    <div class="top-actions">
      <button class:paused={isPaused} on:click={changePause} title="Pause timers and provider spend">{isPaused ? '▶ Resume' : 'Ⅱ Pause'}</button>
      <button on:click={() => { briefDraft = { ...workspace.brief }; settingsOpen = true; }}>Brief <span>v{workspace.brief.version}</span></button>
      <a href="/review">Compare</a>
      <button on:click={() => { ledgerOpen = !ledgerOpen; void workspace.refreshLedger(); }}>Ledger</button>
    </div>
  </header>

    <nav class="filterbar" class:mode-hidden={workspace.mode !== 'revising'} aria-label="Suggestion filters">
      <span class="filter-label">Show</span>
      {#each categories as category}
        <button class:off={!workspace.categoryVisibility[category]} style={`--category:${`var(--cat-${category})`}`} on:click={() => changeCategory(category)}>
          <i>{categoryMeta[category].icon}</i>{categoryMeta[category].label}
        </button>
      {/each}
      <label>Density <input type="range" min="1" max="20" bind:value={workspace.densityCap} on:input={refreshLiveSuggestions} /><output>{workspace.densityCap}</output></label>
      <span class="spacer"></span>
      <button class:active={workspace.surface === 'docked'} on:click={() => workspace.surface = 'docked'}>Margin</button>
      <button class:active={workspace.surface === 'tray'} on:click={() => workspace.surface = 'tray'}>Tray</button>
    </nav>

  <main>
    <section class="workspace">
      <div class="document-column">
        <div class="document-meta">
          <div>
            <select value={workspace.branchId} on:change={(event) => workspace.switchBranch((event.currentTarget as HTMLSelectElement).value)} aria-label="Branch">
              {#each workspace.branches as branch}<option value={branch.id}>{branch.name} · {branch.wordCount}w</option>{/each}
            </select>
            <button on:click={forkBranch}>Fork from here</button>
          </div>
          <div><span>{wordCount(documentText)} words</span><button on:click={exportMarkdown}>Export .md</button></div>
        </div>

        <div class="editor-wrap">
          {#key workspace.branchId}
            <EditorShell
              bind:this={editor}
              branchId={workspace.branchId}
              suggestions={liveSuggestions}
              activeSuggestionId={workspace.activeSuggestionId}
              preview={workspace.preview}
              paused={isPaused}
              onTextChange={textChanged}
              onSelectionChange={(detail) => selection = detail}
              onSuggestionActivate={activateFromEditor}
              onSuggestionHover={(id) => workspace.activate(id)}
              onUndoAcceptance={(origin) => workspace.log('reverted', { source: origin.source }, origin.suggestionId)}
            />
          {/key}

          {#if selection.text && !workspace.paused}
            <div class="selection-menu">
              <span>{selection.text.split(/\s+/).length}w selected</span>
              <button type="button" on:mousedown|preventDefault on:click={() => runSelection('heighten')}>Heighten</button>
              <button type="button" on:mousedown|preventDefault on:click={() => runSelection('cadence')}>Vary cadence</button>
              <button type="button" on:mousedown|preventDefault on:click={() => runSelection('distance')}>More distant</button>
              <button type="button" on:mousedown|preventDefault on:click={() => runSelection('synonyms')}>Synonyms</button>
            </div>
          {/if}
        </div>

        <div class="source-dock">
          <div class="source-heading"><span>Sources</span><button on:click={() => sourceLegendOpen = !sourceLegendOpen}>L/A key</button></div>
          <div class="source-buttons">
            {#each sourceCatalog as source}
              {@const state = workspace.sourceStates[source.id]}
              <button class:invisible={state === 'invisible'} class:off={state === 'off'} on:click={() => changeSource(source.id)} title={`${source.label}: ${state}`}>
                <span class="state-icon">{state === 'visible' ? '◉' : state === 'invisible' ? '⊘' : '○'}</span>
                <b>{source.kind === 'local' ? 'L' : 'A'}{source.number}</b>
                <span>{source.label}</span>
                <small>{state}</small>
              </button>
            {/each}
          </div>
          <div class="source-summary">
            <span>Session spend <strong>${workspace.costUsd.toFixed(4)}</strong> <em>includes invisible</em></span>
            <button class="scan" disabled={workspace.generating || workspace.paused} on:click={runSentinels}>{workspace.generating ? 'Reading…' : 'Run craft pass'}</button>
          </div>
          {#if sourceLegendOpen}<p class="legend"><b>L</b> local, offline craft tool · <b>A</b> AI or scripted model · source number identifies provenance without assigning it a hue. Click rapidly: visible → invisible → off.</p>{/if}
        </div>
      </div>

        <aside class:tray={workspace.surface === 'tray'} class:mode-hidden={workspace.mode !== 'revising'}>
          <header>
            <div><span>{workspace.surface === 'docked' ? 'Margin' : 'Triage tray'}</span><strong>{liveSuggestions.length} live</strong></div>
            {#if queuedCount}<small>+{queuedCount} queued by density cap</small>{/if}
          </header>
          <div
            class="cards"
            class:docked={workspace.surface === 'docked'}
            bind:this={cardsElement}
            style={workspace.surface === 'docked' ? `min-height:max(68vh, ${cardsHeight}px)` : ''}
          >
            {#if !liveSuggestions.length}
              <div class="empty-notes"><span>✓</span><p>No visible notes.</p><small>Run a craft pass, change filters, or bring an invisible source back.</small></div>
            {/if}
            {#each liveSuggestions as suggestion}
              <div
                class="card-slot"
                data-suggestion-id={suggestion.id}
                use:observeCard
                style={workspace.surface === 'docked' ? `top:${cardTops[suggestion.id] ?? 18}px` : ''}
              >
                <SuggestionCard
                  {suggestion}
                  active={workspace.activeSuggestionId === suggestion.id}
                  tray={workspace.surface === 'tray'}
                  selectedVariant={selectedVariants[suggestion.id] ?? 0}
                  onActivate={() => void activateCard(suggestion.id)}
                  onSelectVariant={(index) => chooseVariant(suggestion.id, index)}
                  onAccept={(index, edit) => accept(suggestion, index, edit)}
                  onReject={(viaDrag) => reject(suggestion, viaDrag)}
                  onPreview={(text) => text === null ? workspace.clearPreview() : workspace.setPreview(suggestion.id, text)}
                  onSourceHover={() => workspace.log('source_tooltip_hovered', { source: suggestion.source, sourceNumber: suggestion.sourceNumber }, suggestion.id)}
                  onMove={(direction) => workspace.reorder(suggestion.id, direction)}
                />
              </div>
            {/each}
          </div>
          {#if liveSuggestions.length}<p class="key-help">Card keys: <kbd>Tab</kbd> next · <kbd>1–3</kbd> variant · <kbd>Enter</kbd> accept · <kbd>E</kbd> accept/edit · <kbd>X</kbd> reject</p>{/if}
        </aside>
        <aside class="drafting-aside" class:mode-hidden={workspace.mode === 'revising'} aria-live="polite">
          <span class="quiet-count">{workspace.pendingCount}</span>
          <p>{workspace.pendingCount === 1 ? 'note is' : 'notes are'} waiting quietly.</p>
          <button on:click={() => changeMode('revising')}>Open revision margin</button>
          <small>Drafting mode keeps decorations hidden and analysis out of your way.</small>
        </aside>
    </section>

    {#if ledgerOpen}<div class="ledger-panel"><LedgerTail events={workspace.ledger} costUsd={workspace.costUsd} /></div>{/if}
  </main>

  <div class="pause-banner" class:mode-hidden={!isPaused}><b>Paused</b> — editing, dispatch timers, and provider spend are suspended.</div>
  {#if workspace.notice}<button class="notice" on:click={dismissNotice}>{workspace.notice}<span>×</span></button>{/if}
  {#if workspace.lastError}<button class="error" on:click={() => workspace.lastError = null}>{workspace.lastError}<span>×</span></button>{/if}
  {#if undoDismiss}<div class="undo-toast"><span>Suggestion dismissed</span><button on:click={undoDragDismiss}>Undo</button></div>{/if}

  {#if settingsOpen}
    <div class="modal-backdrop" role="presentation" on:click={() => settingsOpen = false}>
      <div class="settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="brief-title" on:click|stopPropagation on:keydown|stopPropagation>
        <header><div><small>Shared model context</small><h2 id="brief-title">Writing brief <span>v{workspace.brief.version}</span></h2></div><button on:click={() => settingsOpen = false}>×</button></header>
        <div class="form-grid">
          <label>Form<select bind:value={briefDraft.form}><option value="fiction">Fiction</option><option value="non-fiction">Non-fiction</option></select></label>
          <label>Point of view<input bind:value={briefDraft.pov} /></label>
          <label>Tense<input bind:value={briefDraft.tense} /></label>
          <label>Narrative distance<input bind:value={briefDraft.distance} /></label>
        </div>
        <label>Canon / background<textarea rows="7" bind:value={briefDraft.canon} placeholder="Characters, world rules, facts the suggesters must preserve…"></textarea><small>{briefDraft.canon.length} / 6000 characters sent in the POC</small></label>
        <label>Sentinel task prompt <span class="version">v{workspace.prompts.find((prompt) => prompt.id === 'sentinel')?.version ?? 1}</span><textarea rows="5" bind:value={sentinelInstruction}></textarea></label>
        <footer><p>Saving a material brief change expires live suggestions from older brief versions.</p><button on:click={() => settingsOpen = false}>Cancel</button><button class="primary" on:click={saveSettings}>Save new version</button></footer>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-shell { min-height: 100vh; }
  .topbar { position: sticky; z-index: 30; top: 0; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-height: 58px; padding: 0 24px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 91%, transparent); backdrop-filter: blur(14px); }
  .brand { display: flex; align-items: baseline; gap: 8px; text-decoration: none; }
  .brand > span { color: var(--accent); font: 700 25px/1 var(--font-reading); }
  .brand strong { font: 700 14px/1 var(--font-ui); letter-spacing: -.02em; }
  .brand small { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .09em; }
  .mode-switch { display: flex; padding: 3px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper-deep); }
  .mode-switch button { border: 0; border-radius: 999px; background: transparent; color: var(--muted); padding: 7px 14px; font-size: 11px; font-weight: 700; letter-spacing: .03em; cursor: pointer; }
  .mode-switch button.active { background: var(--paper); color: var(--ink); box-shadow: 0 1px 5px rgb(40 34 26 / .12); }
  .mode-switch button span { display: inline-grid; place-items: center; min-width: 17px; height: 17px; margin-left: 5px; border-radius: 9px; background: var(--accent); color: white; font-size: 9px; }
  .top-actions { display: flex; justify-content: flex-end; align-items: center; gap: 4px; }
  .top-actions button, .top-actions a { border: 0; background: transparent; color: var(--ink-soft); padding: 8px 9px; border-radius: 3px; text-decoration: none; font-size: 11px; cursor: pointer; }
  .top-actions button:hover, .top-actions a:hover { background: var(--paper-deep); color: var(--ink); }
  .top-actions span { color: var(--muted); }
  .top-actions .paused { color: var(--accept); font-weight: 700; }
  .filterbar { position: sticky; z-index: 25; top: 58px; display: flex; align-items: center; gap: 5px; min-height: 46px; padding: 7px max(24px, calc((100vw - 1390px) / 2)); border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--paper) 94%, transparent); backdrop-filter: blur(12px); }
  .mode-hidden { display: none !important; }
  .filterbar button { --category: var(--accent); display: flex; align-items: center; gap: 5px; border: 1px solid transparent; border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 6px 8px; font: 600 10px/1 var(--font-ui); cursor: pointer; }
  .filterbar button i { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: color-mix(in srgb, var(--category) 18%, transparent); color: var(--category); font-style: normal; font-size: 9px; }
  .filterbar button.off { opacity: .35; text-decoration: line-through; }
  .filterbar button.active { border-color: var(--line-strong); background: var(--paper-deep); color: var(--ink); }
  .filter-label { color: var(--muted); font: 700 9px/1 var(--font-ui); letter-spacing: .08em; text-transform: uppercase; margin-right: 4px; }
  .filterbar label { display: flex; align-items: center; gap: 7px; margin-left: 7px; color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .06em; }
  .filterbar input { width: 70px; accent-color: var(--accent); }
  .filterbar output { width: 16px; }
  .spacer { flex: 1; }
  main { width: min(1390px, calc(100% - 42px)); margin: 0 auto; padding: 34px 0 80px; }
  .workspace { display: grid; grid-template-columns: minmax(540px, 830px) minmax(260px, 350px); justify-content: center; gap: clamp(28px, 5vw, 72px); }
  .document-column { min-width: 0; }
  .document-meta { display: flex; justify-content: space-between; align-items: center; min-height: 34px; margin-bottom: 8px; color: var(--muted); font-size: 10px; }
  .document-meta > div { display: flex; align-items: center; gap: 7px; }
  .document-meta select, .document-meta button { border: 0; background: transparent; color: var(--muted); padding: 4px; font-size: 10px; cursor: pointer; }
  .document-meta select { color: var(--ink-soft); font-weight: 600; }
  .document-meta button:hover { color: var(--accent); }
  .editor-wrap { position: relative; }
  .selection-menu { position: sticky; z-index: 12; bottom: 22px; display: flex; align-items: center; gap: 3px; width: max-content; max-width: calc(100% - 40px); margin: -58px auto 17px; padding: 5px; border: 1px solid #34322e; border-radius: 4px; background: #282723; color: #f7f3e9; box-shadow: 0 10px 30px rgb(0 0 0 / .2); }
  .selection-menu span { padding: 0 8px; color: #a9a69f; font-size: 9px; }
  .selection-menu button { border: 0; border-radius: 2px; background: transparent; color: inherit; padding: 7px 9px; font-size: 10px; cursor: pointer; }
  .selection-menu button:hover { background: #3c3a35; }
  aside { min-width: 0; padding-top: 42px; }
  aside > header { display: flex; align-items: end; justify-content: space-between; min-height: 30px; padding: 0 0 9px; border-bottom: 1px solid var(--line); }
  aside > header div { display: flex; align-items: baseline; gap: 8px; }
  aside > header span { font: 700 10px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .09em; }
  aside > header strong, aside > header small { color: var(--muted); font: 500 9px/1 var(--font-ui); }
  .cards { position: relative; min-height: 68vh; }
  .cards.docked .card-slot { position: absolute; left: 0; width: 100%; transition: top .25s ease; }
  .cards:not(.docked) { display: grid; gap: 10px; padding-top: 14px; }
  aside.tray { background: color-mix(in srgb, var(--paper) 46%, transparent); border: 1px solid var(--line); border-radius: 4px; margin-top: 42px; padding: 18px; align-self: start; }
  aside.tray > header { padding-top: 0; }
  .empty-notes { display: grid; place-items: center; text-align: center; padding: 80px 24px; color: var(--muted); }
  .empty-notes > span { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--line); border-radius: 50%; color: var(--accept); }
  .empty-notes p { margin: 12px 0 5px; color: var(--ink-soft); font: 500 13px/1 var(--font-ui); }
  .empty-notes small { max-width: 230px; font: 10px/1.5 var(--font-ui); }
  .key-help { color: var(--muted); font: 9px/1.6 var(--font-ui); text-align: center; }
  kbd { display: inline-block; min-width: 18px; padding: 1px 4px; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 3px; background: var(--paper); font: 8px/1.4 var(--font-mono); }
  .drafting-aside { align-self: start; margin-top: 22vh; text-align: center; color: var(--muted); }
  .quiet-count { display: grid; place-items: center; width: 60px; height: 60px; margin: auto; border: 1px solid var(--line); border-radius: 50%; background: color-mix(in srgb, var(--paper) 70%, transparent); color: var(--accent); font: 500 25px/1 var(--font-reading); }
  .drafting-aside p { color: var(--ink-soft); font: 14px/1.4 var(--font-reading); }
  .drafting-aside button { border: 1px solid var(--line-strong); border-radius: 3px; background: var(--paper); color: var(--ink-soft); padding: 8px 12px; font-size: 10px; cursor: pointer; }
  .drafting-aside small { display: block; max-width: 240px; margin: 12px auto; font: 10px/1.5 var(--font-ui); }
  .source-dock { margin-top: 18px; border-top: 1px solid var(--line); padding-top: 11px; }
  .source-heading, .source-summary { display: flex; align-items: center; justify-content: space-between; }
  .source-heading span { color: var(--muted); font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .1em; }
  .source-heading button { border: 0; background: transparent; color: var(--muted); font-size: 9px; cursor: pointer; }
  .source-buttons { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
  .source-buttons button { display: grid; grid-template-columns: 18px auto; grid-template-areas: "icon code" "label label" "state state"; align-items: center; min-width: 115px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink-soft); padding: 7px 9px; text-align: left; cursor: pointer; }
  .source-buttons .state-icon { grid-area: icon; color: var(--accent); }
  .source-buttons b { grid-area: code; font-size: 11px; }
  .source-buttons button > span:nth-of-type(2) { grid-area: label; margin-top: 5px; font-size: 9px; }
  .source-buttons small { grid-area: state; margin-top: 3px; color: var(--accent); font-size: 8px; text-transform: uppercase; }
  .source-buttons button.invisible { border-style: dashed; opacity: .58; }
  .source-buttons button.invisible .state-icon, .source-buttons button.invisible small { color: #887b61; }
  .source-buttons button.off { background: transparent; opacity: .42; filter: grayscale(1); }
  .source-summary { color: var(--muted); font-size: 9px; }
  .source-summary strong { color: var(--ink-soft); }
  .source-summary em { font-style: normal; opacity: .7; }
  .scan { border: 0; border-radius: 3px; background: var(--accent); color: white; padding: 8px 12px; font: 700 9px/1 var(--font-ui); cursor: pointer; }
  .scan:disabled { opacity: .45; cursor: wait; }
  .legend { max-width: 680px; color: var(--muted); font: 9px/1.5 var(--font-ui); }
  .ledger-panel { margin-top: 28px; }
  .pause-banner { position: fixed; z-index: 45; top: 66px; left: 50%; transform: translateX(-50%); border: 1px solid #b5cbbf; border-radius: 3px; background: #eff8f2; color: #3f6250; padding: 8px 13px; box-shadow: 0 8px 30px rgb(20 45 30 / .12); font-size: 10px; }
  .notice, .error { position: fixed; z-index: 60; right: 18px; bottom: 18px; display: flex; gap: 16px; align-items: center; max-width: 420px; border: 1px solid #27433a; border-radius: 3px; background: #1f302a; color: #edf5f1; padding: 11px 13px; box-shadow: 0 12px 30px rgb(0 0 0 / .18); font-size: 10px; cursor: pointer; }
  .error { background: #5c2925; border-color: #743731; }
  .notice span, .error span { opacity: .6; }
  .undo-toast { position: fixed; z-index: 61; left: 50%; bottom: 22px; transform: translateX(-50%); display: flex; align-items: center; gap: 18px; border-radius: 3px; background: #282723; color: white; padding: 10px 13px; box-shadow: 0 10px 30px rgb(0 0 0 / .2); font-size: 10px; }
  .undo-toast button { border: 0; background: transparent; color: #8cd5bc; font-weight: 700; cursor: pointer; }
  .modal-backdrop { position: fixed; z-index: 80; inset: 0; display: grid; place-items: center; padding: 22px; background: rgb(34 31 27 / .38); backdrop-filter: blur(3px); }
  .settings { width: min(720px, 100%); max-height: calc(100vh - 44px); overflow: auto; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); box-shadow: 0 30px 80px rgb(26 22 17 / .22); padding: 25px; }
  .settings > header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px; }
  .settings h2 { margin: 3px 0 0; font: 500 24px/1.2 var(--font-reading); }
  .settings h2 span, .settings header small { color: var(--muted); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .settings header button { border: 0; background: transparent; color: var(--muted); font-size: 24px; cursor: pointer; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .settings label { display: grid; gap: 6px; margin-bottom: 12px; color: var(--ink-soft); font: 600 10px/1.3 var(--font-ui); }
  .settings input, .settings select, .settings textarea { width: 100%; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; color: var(--ink); padding: 9px 10px; outline: none; font: 12px/1.45 var(--font-ui); resize: vertical; }
  .settings input:focus, .settings textarea:focus, .settings select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .settings label small, .version { justify-self: end; color: var(--muted); font-size: 8px; }
  .settings > footer { display: flex; align-items: center; justify-content: flex-end; gap: 7px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
  .settings footer p { flex: 1; margin: 0; color: var(--muted); font: 9px/1.5 var(--font-ui); }
  .settings footer button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 8px 12px; font-size: 10px; cursor: pointer; }
  .settings footer .primary { background: var(--accent); border-color: var(--accent); color: white; }
  @media (max-width: 980px) {
    .workspace { grid-template-columns: minmax(0, 1fr); }
    aside { padding-top: 8px; }
    .cards.docked { display: grid; gap: 10px; min-height: 0; padding-top: 12px; }
    .cards.docked .card-slot { position: static; }
    .drafting-aside { margin: 20px 0; }
    .brand small { display: none; }
    .filterbar { overflow-x: auto; }
  }
  @media (max-width: 680px) {
    .topbar { grid-template-columns: 1fr auto; padding: 0 12px; }
    .mode-switch { order: 3; grid-column: 1 / -1; justify-self: center; margin: 5px; }
    .top-actions button:nth-last-child(n+3), .top-actions a { display: none; }
    .filterbar { top: 99px; }
    main { width: calc(100% - 20px); padding-top: 18px; }
    .form-grid { grid-template-columns: 1fr; }
  }
</style>
