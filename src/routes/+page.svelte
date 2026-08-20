<script lang="ts">
  import { onMount, tick } from 'svelte';
  import EditorShell from '$lib/editor/EditorShell.svelte';
  import SuggestionCard from '$lib/components/SuggestionCard.svelte';
  import LedgerTail from '$lib/components/LedgerTail.svelte';
  import Navigator from '$lib/components/Navigator.svelte';
  import { categories, categoryMeta, makeId, sourceCatalog, suggestionFingerprint, wordCount, type Branch, type SourceState, type Suggestion, type TaskPrompt, type WritingBrief } from '$lib/domain';
  import { targetLabel } from '$lib/workspace/attachments';
  import { workspace } from '$lib/state/workspace.svelte';
  import { settings as providerSettings } from '$lib/state/settings.svelte';
  import type { ContextBucket, ContextScope } from '$lib/workspace/model';

  type ContextDraft = Pick<ContextBucket, 'title' | 'role' | 'content'>;

  let editor = $state<EditorShell | null>(null);
  let selection = $state({ from: 1, to: 1, text: '' });
  let selectedVariants = $state<Record<string, number>>({});
  let settingsOpen = $state(false);
  let contextOpen = $state(false);
  let ledgerOpen = $state(false);
  let sourceLegendOpen = $state(false);
  let inputsOpen = $state(false);
  let displayedSourceStates = $state<Record<string, SourceState>>({ ...workspace.sourceStates });
  let inputStateFilter = $state('all');
  let inputSearch = $state('');
  let briefDraft = $state<WritingBrief>({ ...workspace.brief });
  let sentinelInstruction = $state('');
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let documentSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let editSession = { started: 0, characters: 0, text: '' };
  let editorReady = $state(false);
  let workspaceReady = $state(false);
  let displayedDocumentRevision = $state(1);
  let documentSaving = $state(false);
  let cardTops = $state<Record<string, number>>({});
  let cardsHeight = $state(0);
  let cardsElement = $state<HTMLDivElement>();
  let undoDismiss = $state<{ suggestion: Suggestion; timer: ReturnType<typeof setTimeout> } | null>(null);
  let liveSuggestions = $state<Suggestion[]>([]);
  let queuedCount = $state(0);
  let isPaused = $state(false);
  let contextDrafts = $state<Record<string, ContextDraft>>({});
  let newContextTitle = $state('');
  let newContextRole = $state('');
  let newContextScope = $state<ContextScope>('project');
  let revisionSuggestionId = $state<string | null>(null);
  let customRequestOpen = $state(false);
  let customRequest = $state('');
  let projectDialogKind = $state<'create' | 'rename' | 'reset' | null>(null);
  let projectDialogValue = $state('');

  let selectedPrompt = $derived(workspace.prompts.find((prompt) => prompt.id === 'sentinel') ?? workspace.prompts[0]);
  let currentDocumentText = $derived(workspace.currentDocument?.content ?? '');
  let revisionSuggestion = $derived(workspace.suggestions.find((suggestion) => suggestion.id === revisionSuggestionId) ?? null);
  let hasRevisionProvider = $derived(
    (workspace.sourceStates.openrouter === 'visible' && providerSettings.sourceAvailability.openrouter?.available === true)
    || (workspace.sourceStates.ollama === 'visible' && providerSettings.sourceAvailability.ollama?.available === true)
  );
  let managedInputs = $derived.by(() => workspace.inputs
    .filter((input) => inputStateFilter === 'all' || input.state === inputStateFilter)
    .filter((input) => !inputSearch.trim() || `${input.payload.comment} ${input.source} ${input.category} ${input.state}`.toLowerCase().includes(inputSearch.trim().toLowerCase()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));

  onMount(() => {
    void workspace.initialize().then(() => {
      briefDraft = { ...workspace.brief };
      sentinelInstruction = workspace.prompts.find((prompt) => prompt.id === 'sentinel')?.instruction ?? '';
      displayedSourceStates = { ...workspace.sourceStates };
      workspaceReady = true;
      displayedDocumentRevision = workspace.currentDocument?.revision ?? 1;
      refreshLiveSuggestions();
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
      if (documentSaveTimer) clearTimeout(documentSaveTimer);
      if (scanTimer) clearTimeout(scanTimer);
      if (noticeTimer) clearTimeout(noticeTimer);
    };
  });

  $effect(() => {
    if (liveSuggestions.length && editorReady) void tick().then(layoutCards);
  });

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
    liveSuggestions = workspace.suggestions
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
    if (editorReady) void tick().then(() => editor?.syncAttachments(liveSuggestions, workspace.formats));
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

  function changeCategory(category: (typeof categories)[number]): void {
    workspace.toggleCategory(category);
    refreshLiveSuggestions();
  }

  function preventDefault(event: Event): void { event.preventDefault(); }
  function stopPropagation(event: Event): void { event.stopPropagation(); }

  async function changeSource(sourceId: string): Promise<void> {
    if (sourceId === 'openrouter' && providerSettings.sourceAvailability.openrouter?.available !== true) {
      providerSettings.openOpenRouter();
      return;
    }
    await workspace.cycleSource(sourceId);
    displayedSourceStates = { ...workspace.sourceStates };
    refreshLiveSuggestions();
  }

  async function saveOpenRouter(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const key = String(form.get('openrouter-key') ?? '');
    const model = String(form.get('openrouter-model') ?? '');
    try {
      const configured = await providerSettings.saveOpenRouter({ key, model });
      workspace.enableConfiguredSource('openrouter');
      displayedSourceStates = { ...workspace.sourceStates };
      workspace.notice = `OpenRouter ${configured.model ?? providerSettings.openRouterModel} was saved locally and is now visible.`;
      refreshLiveSuggestions();
    } catch (error) {
      workspace.lastError = providerSettings.error ?? (error instanceof Error ? error.message : 'OpenRouter configuration failed');
    }
  }

  async function changePause(): Promise<void> {
    const change = workspace.togglePause();
    isPaused = workspace.paused;
    await change;
  }

  function textChanged(detail: { text: string; characters: number; origin?: unknown }): void {
    if (!editorReady) {
      editorReady = true;
      return;
    }
    refreshLiveSuggestions();
    const origin = detail.origin as { kind?: string } | undefined;
    const saveReason = origin?.kind === 'workspace_history'
      ? 'Undo or redo'
      : origin?.kind === 'input_acceptance'
        ? 'Accepted revision'
        : 'Editing session';
    scheduleDocumentSave(saveReason);
    if (origin && origin.kind !== 'human') return;
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
    if (!workspace.paused) scanTimer = setTimeout(() => void runSentinels(), 5000);
  }

  function undoWorkspace(): void {
    const snapshot = workspace.undoWorkspace();
    if (!snapshot || !editor) return;
    editor.restoreSnapshot(snapshot, 'undo');
    refreshLiveSuggestions();
  }

  function redoWorkspace(): void {
    const snapshot = workspace.redoWorkspace();
    if (!snapshot || !editor) return;
    editor.restoreSnapshot(snapshot, 'redo');
    refreshLiveSuggestions();
  }

  function strikeSelection(): void {
    const removing = workspace.selectionHasStrikethrough(selection.from, selection.to);
    if (workspace.toggleSelectionStrikethrough(selection.from, selection.to, selection.text)) {
      refreshLiveSuggestions();
      showNotice(removing ? 'Strikethrough removed from selection.' : 'Selection struck through.');
    }
  }

  function strikeWork(): void {
    const removing = workspace.workHasStrikethrough;
    if (workspace.toggleWorkStrikethrough()) {
      refreshLiveSuggestions();
      showNotice(removing ? 'Work strikethrough removed.' : 'Work struck through.');
    } else showNotice('The editor is still opening.');
  }

  function openInputs(): void {
    inputStateFilter = 'all';
    inputSearch = '';
    inputsOpen = true;
  }

  async function setManagedInputState(input: Suggestion, state: 'pending' | 'rejected'): Promise<void> {
    await workspace.setInputState(input.id, state, state === 'pending' ? 'Reopen input' : 'Dismiss input');
    refreshLiveSuggestions();
  }

  function scheduleDocumentSave(reason: string): void {
    if (documentSaveTimer) clearTimeout(documentSaveTimer);
    documentSaving = true;
    documentSaveTimer = setTimeout(async () => {
      documentSaveTimer = null;
      await workspace.persistCurrentDocument(reason);
      displayedDocumentRevision = workspace.currentDocument?.revision ?? displayedDocumentRevision;
      documentSaving = false;
    }, 1200);
  }

  async function runSentinels(): Promise<void> {
    if (!selectedPrompt || workspace.paused) return;
    workspace.notice = null;
    const incoming = await workspace.runCraftPass(selectedPrompt);
    if (!workspace.notice) showNotice(incoming.length
      ? `${incoming.length} new ${incoming.length === 1 ? 'input' : 'inputs'} added.`
      : 'Craft pass complete; no new inputs.');
    refreshLiveSuggestions();
    await tick();
    layoutCards();
  }

  async function runSelectionPrompt(prompt: TaskPrompt, pendingMessage?: string): Promise<Suggestion[]> {
    if (!selection.text.trim()) return [];
    workspace.notice = null;
    if (pendingMessage) showNotice(pendingMessage);
    const incoming = await workspace.runSelectionPass(selection, prompt);
    refreshLiveSuggestions();
    await tick();
    layoutCards();
    if (incoming[0]) void activateCard(incoming[0].id);
    return incoming;
  }

  async function runSelection(promptId: string): Promise<void> {
    const prompt = workspace.prompts.find((item) => item.id === promptId) ?? { id: promptId, name: promptId, version: 1, instruction: `Offer a ${promptId} revision.` };
    await runSelectionPrompt(prompt);
  }

  async function selectSuggestionForRevision(suggestion: Suggestion): Promise<void> {
    revisionSuggestionId = suggestion.id;
    customRequestOpen = false;
    workspace.activate(suggestion.id);
    editor?.focusSuggestion(suggestion);
    await tick();
    layoutCards();
  }

  async function suggestNoteRevisions(suggestion: Suggestion): Promise<void> {
    if (!hasRevisionProvider) {
      showNotice('Enable OpenRouter or Ollama to suggest contextual revisions.');
      return;
    }
    const label = categoryMeta[suggestion.category].label.toLowerCase();
    const pendingMessage = `Requesting ${label} revisions…`;
    const incoming = await runSelectionPrompt({
      id: `address-${suggestion.category}`,
      name: `Address ${categoryMeta[suggestion.category].label} note`,
      version: 1,
      instruction: `Offer two or three distinct replacement revisions for the selected passage that address this ${label} note: ${suggestion.payload.comment} Preserve established facts, voice, tense, and intended point of view. Return practical alternatives rather than repeating the diagnosis.`
    }, pendingMessage);
    if (workspace.notice === pendingMessage) {
      showNotice(incoming.length
        ? `${incoming.length} revision ${incoming.length === 1 ? 'option' : 'options'} returned.`
        : 'The provider returned no usable revision alternatives.');
    }
  }

  async function startSuggestionRevision(suggestion: Suggestion): Promise<void> {
    await selectSuggestionForRevision(suggestion);
    await suggestNoteRevisions(suggestion);
  }

  async function suggestCustomRevision(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const instruction = customRequest.trim();
    if (!instruction) return;
    if (!hasRevisionProvider) {
      showNotice('Enable OpenRouter or Ollama to use a custom revision request.');
      return;
    }
    customRequestOpen = false;
    const pendingMessage = 'Requesting custom revisions…';
    const incoming = await runSelectionPrompt({
      id: 'custom-revision',
      name: 'Custom revision',
      version: 1,
      instruction: `Offer two or three distinct replacement revisions for the selected passage. Follow this writer instruction: ${instruction} Preserve established facts and any narrative constraints not explicitly changed by the instruction.`
    }, pendingMessage);
    if (workspace.notice === pendingMessage) {
      showNotice(incoming.length
        ? `${incoming.length} custom revision ${incoming.length === 1 ? 'option' : 'options'} returned.`
        : 'The provider returned no usable custom revisions.');
    }
  }

  function selectionChanged(detail: { from: number; to: number; text: string }): void {
    selection = detail;
    if (revisionSuggestion && (detail.from !== revisionSuggestion.anchor.from || detail.to !== revisionSuggestion.anchor.to)) {
      revisionSuggestionId = null;
    }
    if (!detail.text) customRequestOpen = false;
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
    const currentEditor = editor;
    if (!currentEditor) return;
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
    const result = currentEditor.acceptSuggestion(suggestion, variant.text);
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
      if (variant.text) currentEditor.selectRange(result.from, result.to);
      else currentEditor.focusAt(result.to);
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
    await workspace.setInputState(restored.id, 'pending', 'Undo input dismissal');
    refreshLiveSuggestions();
    undoDismiss = null;
    await workspace.log('dismiss_undone', { restored: true }, restored.id);
  }

  function handleReviewKeys(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select') || target.isContentEditable || !liveSuggestions.length) return;
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
    if (!name) return;
    const id = makeId('branch');
    const content = workspace.currentDocument?.content ?? '';
    const branch: Branch = { id, name, parentId: workspace.branchId, createdAt: new Date().toISOString(), wordCount: wordCount(content), lastEdited: new Date().toISOString() };
    await workspace.addBranch(branch, content);
    await switchDocument(id);
  }

  async function switchDocument(id: string, navigation: 'push' | 'back' | 'forward' = 'push'): Promise<void> {
    if (id === workspace.branchId && navigation === 'push') {
      await workspace.openNavigatorNode(id, navigation);
      return;
    }
    if (documentSaveTimer) {
      clearTimeout(documentSaveTimer);
      documentSaveTimer = null;
      await workspace.persistCurrentDocument('Saved before switching document');
      documentSaving = false;
    }
    editorReady = false;
    selection = { from: 1, to: 1, text: '' };
    await workspace.openNavigatorNode(id, navigation);
    displayedDocumentRevision = workspace.currentDocument?.revision ?? 1;
    refreshLiveSuggestions();
  }

  async function switchProject(id: string): Promise<void> {
    if (id === workspace.projectId) return;
    if (documentSaveTimer) {
      clearTimeout(documentSaveTimer);
      documentSaveTimer = null;
      await workspace.persistCurrentDocument('Saved before switching project');
      documentSaving = false;
    }
    editorReady = false;
    selection = { from: 1, to: 1, text: '' };
    await workspace.switchProject(id);
    displayedDocumentRevision = workspace.currentDocument?.revision ?? 1;
    refreshLiveSuggestions();
  }

  function createProject(): void {
    projectDialogKind = 'create';
    projectDialogValue = '';
  }

  function renameProject(): void {
    const current = workspace.currentProject;
    if (!current) return;
    projectDialogKind = 'rename';
    projectDialogValue = current.title;
  }

  function resetProject(): void {
    const current = workspace.currentProject;
    if (!current) return;
    projectDialogKind = 'reset';
    projectDialogValue = '';
  }

  async function submitProjectDialog(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const kind = projectDialogKind;
    const value = projectDialogValue.trim();
    const current = workspace.currentProject;
    if (!kind || !current) return;
    if (kind === 'rename') {
      if (!value) return;
      await workspace.renameProject(value);
      projectDialogKind = null;
      return;
    }
    if (kind === 'create') {
      if (!value) return;
      if (documentSaveTimer) {
        clearTimeout(documentSaveTimer);
        documentSaveTimer = null;
        await workspace.persistCurrentDocument('Saved before creating project');
      }
      editorReady = false;
      await workspace.createProject(value);
      projectDialogKind = null;
      refreshLiveSuggestions();
      return;
    }
    if (value !== current.title) return;
    if (documentSaveTimer) clearTimeout(documentSaveTimer);
    documentSaveTimer = null;
    editorReady = false;
    selection = { from: 1, to: 1, text: '' };
    await workspace.resetCurrentProject();
    projectDialogKind = null;
    displayedDocumentRevision = workspace.currentDocument?.revision ?? 1;
    refreshLiveSuggestions();
  }

  async function createDocument(): Promise<void> {
    const title = window.prompt('Document name', 'Untitled draft')?.trim();
    if (!title) return;
    const document = await workspace.createDocument(title);
    await switchDocument(document.id);
  }

  async function renameDocument(): Promise<void> {
    const current = workspace.currentDocument;
    if (!current) return;
    const previous = workspace.navigatorNodeEditableTitle(current);
    const title = window.prompt('Document name', previous)?.trim();
    if (title === undefined || title === previous) return;
    if (!title && current.role !== 'navigator_node') return;
    await workspace.renameDocument(current.id, title);
  }

  function openContext(): void {
    contextDrafts = Object.fromEntries(workspace.currentContext.map((bucket) => [bucket.id, {
      title: bucket.title,
      role: bucket.role,
      content: bucket.content
    }]));
    newContextTitle = '';
    newContextRole = '';
    newContextScope = 'project';
    contextOpen = true;
  }

  async function addContextBucket(): Promise<void> {
    const title = newContextTitle.trim();
    if (!title) return;
    const bucket = await workspace.createContextBucket({ title, role: newContextRole.trim() || undefined, scope: newContextScope });
    contextDrafts = { ...contextDrafts, [bucket.id]: { title: bucket.title, role: bucket.role, content: bucket.content } };
    newContextTitle = '';
    newContextRole = '';
    showNotice(`${bucket.title} added to ${bucket.scope} context.`);
  }

  async function saveContextBucket(bucket: ContextBucket): Promise<void> {
    const draft = contextDrafts[bucket.id];
    if (!draft?.title.trim()) return;
    const saved = await workspace.saveContextBucket({ ...draft, id: bucket.id, title: draft.title.trim(), role: draft.role?.trim() || undefined });
    contextDrafts = { ...contextDrafts, [saved.id]: { title: saved.title, role: saved.role, content: saved.content } };
    showNotice(`${saved.title} saved as version ${saved.revision}.`);
  }

  async function deleteContextBucket(bucket: ContextBucket): Promise<void> {
    if (bucket.role === 'narrative_rules') return;
    if (!window.confirm(`Remove “${bucket.title}” from active context? Its version history will be retained.`)) return;
    await workspace.deleteContextBucket(bucket.id);
    const { [bucket.id]: _removed, ...remaining } = contextDrafts;
    contextDrafts = remaining;
  }

  async function exportMarkdown(): Promise<void> {
    const result = await workspace.exportMarkdown(currentDocumentText, workspace.branches.find((branch) => branch.id === workspace.branchId)?.name);
    const href = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = result.filename;
    anchor.click();
    URL.revokeObjectURL(href);
  }
</script>

<svelte:head><title>Margin Note — writing support</title><meta name="description" content="A meta-first creative writing support workbench." /></svelte:head>

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Margin Note home"><span>¶</span><strong>Margin Note</strong><small>writing workbench</small></a>
    <div class="top-actions">
      <button class:paused={isPaused} onclick={changePause} title="Pause timers and provider spend">{isPaused ? '▶ Resume' : 'Ⅱ Pause'}</button>
      <button onclick={openContext}>Context <span>{workspace.currentContext.length}</span></button>
      <button onclick={openInputs}>Inputs <span>{workspace.inputs.length}</span></button>
      <button onclick={() => { briefDraft = { ...workspace.brief }; settingsOpen = true; }}>Brief <span>v{workspace.brief.version}</span></button>
      <a href="/review">Compare</a>
      <button onclick={() => { ledgerOpen = !ledgerOpen; void workspace.refreshLedger(); }}>Ledger</button>
    </div>
  </header>

    <nav class="filterbar" aria-label="Input filters">
      <span class="filter-label">Show</span>
      {#each categories as category}
        <button class:off={!workspace.categoryVisibility[category]} style={`--category:${`var(--cat-${category})`}`} onclick={() => changeCategory(category)}>
          <i>{categoryMeta[category].icon}</i>{categoryMeta[category].label}
        </button>
      {/each}
      <label>Density <input type="range" min="1" max="20" bind:value={workspace.densityCap} oninput={refreshLiveSuggestions} /><output>{workspace.densityCap}</output></label>
      <span class="spacer"></span>
      <button class:active={workspace.surface === 'docked'} onclick={() => workspace.surface = 'docked'}>Margin</button>
      <button class:active={workspace.surface === 'tray'} onclick={() => workspace.surface = 'tray'}>Tray</button>
    </nav>

  <div class="workbench">
    <Navigator onOpenNode={switchDocument} />
    <main>
    <section class="workspace">
      <div class="document-column">
        <div class="document-meta">
          <div class="document-selectors">
            <select value={workspace.projectId} onchange={(event) => switchProject((event.currentTarget as HTMLSelectElement).value)} aria-label="Project">
              {#each workspace.projects as project}<option value={project.id}>{project.title}</option>{/each}
            </select>
            <button onclick={createProject} title="Create project">+ Project</button>
            <button onclick={renameProject} title="Rename current project">Rename project</button>
            <button onclick={resetProject} title="Remove this project's material and recreate an empty Spine and Todos">Start over</button>
            <span aria-hidden="true">/</span><small>Editing</small><strong>{workspace.currentDocument ? workspace.navigatorNodeLabel(workspace.currentDocument) : ''}</strong>
            {#if workspace.currentDocument && !['spine', 'todos'].includes(workspace.currentDocument.role ?? '')}<button onclick={renameDocument}>Rename</button>{/if}
            <button onclick={forkBranch}>Fork from here</button>
          </div>
          <div><span>{wordCount(currentDocumentText)} words · v{displayedDocumentRevision}{documentSaving ? ' · saving…' : ''}</span><button onclick={exportMarkdown}>Export .md</button></div>
          <div class="document-tools">
            <button disabled={!workspace.undoStack.length} onclick={undoWorkspace}>Undo</button>
            <button disabled={!workspace.redoStack.length} onclick={redoWorkspace}>Redo</button>
            <button onclick={strikeWork}>{workspace.workHasStrikethrough ? 'Remove work strikethrough' : 'Strike work'}</button>
          </div>
        </div>

        <div class="editor-wrap">
          {#if !workspaceReady || !workspace.currentDocument}
            <div class="editor-loading">Opening workspace…</div>
          {:else}
            {#key workspace.branchId}
              <EditorShell
                bind:this={editor}
                branchId={workspace.branchId}
                initialContent={workspace.currentDocument.content}
                suggestions={liveSuggestions}
                formats={workspace.formats}
                attachmentRevision={workspace.workspaceRevision}
                activeSuggestionId={workspace.activeSuggestionId}
                preview={workspace.preview}
                paused={isPaused}
                onTextChange={textChanged}
                onEditorReady={(snapshot) => workspace.setEditorReady(snapshot)}
                onEditorTransaction={(detail) => {
                  const projection = workspace.recordEditorTransaction(detail);
                  refreshLiveSuggestions();
                  return { suggestions: liveSuggestions, formats: projection.formats };
                }}
                onUndoRequest={undoWorkspace}
                onRedoRequest={redoWorkspace}
                onSelectionChange={selectionChanged}
                onSuggestionActivate={activateFromEditor}
                onSuggestionHover={(id) => workspace.activate(id)}
              />
            {/key}
          {/if}

          {#if selection.text && !workspace.paused}
            <div class="selection-menu">
              <span>{selection.text.split(/\s+/).length}w selected</span>
              {#if revisionSuggestion}
                <button class="contextual-revision" type="button" onmousedown={preventDefault} onclick={() => suggestNoteRevisions(revisionSuggestion!)}>Suggest more for {categoryMeta[revisionSuggestion.category].label}</button>
              {/if}
              <button type="button" onmousedown={preventDefault} onclick={() => runSelection('heighten')}>Heighten</button>
              <button type="button" onmousedown={preventDefault} onclick={() => runSelection('cadence')}>Vary cadence</button>
              <button type="button" onmousedown={preventDefault} onclick={() => runSelection('distance')}>More distant</button>
              <button type="button" onmousedown={preventDefault} onclick={() => runSelection('synonyms')}>Synonyms</button>
              <button type="button" onmousedown={preventDefault} onclick={strikeSelection}>{workspace.selectionHasStrikethrough(selection.from, selection.to) ? 'Remove strikethrough' : 'Strikethrough'}</button>
              <button type="button" onmousedown={preventDefault} onclick={() => customRequestOpen = !customRequestOpen}>Custom request…</button>
              {#if customRequestOpen}
                <form class="custom-request" onsubmit={suggestCustomRevision}>
                  <input bind:value={customRequest} aria-label="Custom revision request" placeholder="Describe the revision you want" />
                  {#if !customRequest.trim()}
                    <button class="request-example" type="button" onclick={() => customRequest = 'Keep Mara close but add to her anxiety'}>Use example: “Keep Mara close but add to her anxiety”</button>
                  {/if}
                  <button type="submit" disabled={!customRequest.trim()}>Suggest revisions</button>
                </form>
              {/if}
            </div>
          {/if}
        </div>

        <div class="source-dock">
          <div class="source-heading"><span>Sources</span><button onclick={() => sourceLegendOpen = !sourceLegendOpen}>L/A key</button></div>
          <div class="source-buttons">
            {#each sourceCatalog as source}
              {@const state = displayedSourceStates[source.id]}
              {@const availability = providerSettings.sourceAvailability[source.id]}
              {@const unavailable = availability?.available !== true}
              <button class:invisible={state === 'invisible'} class:off={state === 'off'} class:unavailable onclick={() => changeSource(source.id)} title={unavailable ? availability.reason : `${source.label}: ${state}${availability?.model ? ` · ${availability.model}` : ''}`}>
                <span class="state-icon">{unavailable ? '!' : state === 'visible' ? '◉' : state === 'invisible' ? '⊘' : '○'}</span>
                <b>{source.kind === 'local' ? 'L' : 'A'}{source.number}</b>
                <span>{source.label}</span>
                <small>{unavailable ? 'not configured' : state}</small>
              </button>
            {/each}
          </div>
          <div class="source-summary">
            <span>Session spend <strong>${workspace.costUsd.toFixed(4)}</strong> <em>includes invisible</em></span>
            {#if providerSettings.sourceAvailability.openrouter?.credentialHint}
              <span class="provider-identity">{providerSettings.sourceAvailability.openrouter.credentialHint} · {providerSettings.sourceAvailability.openrouter.model}</span>
            {/if}
            <button class="provider-config" onclick={() => providerSettings.openOpenRouter()}>{providerSettings.sourceAvailability.openrouter?.available === true ? 'OpenRouter settings' : 'Configure OpenRouter'}</button>
            <button class="scan" disabled={workspace.generating || workspace.paused} onclick={runSentinels}>{workspace.generating ? 'Reading…' : 'Run craft pass'}</button>
          </div>
          {#if sourceLegendOpen}<p class="legend"><b>L</b> local, offline craft tool · <b>A</b> AI or scripted model · source number identifies provenance without assigning it a hue. Click rapidly: visible → invisible → off.</p>{/if}
        </div>
      </div>

        <aside class:tray={workspace.surface === 'tray'}>
          <header>
            <div><span>{workspace.surface === 'docked' ? 'Inputs' : 'Input tray'}</span><strong>{liveSuggestions.length} live</strong></div>
            {#if queuedCount}<small>+{queuedCount} queued by density cap</small>{/if}
          </header>
          <div
            class="cards"
            class:docked={workspace.surface === 'docked'}
            bind:this={cardsElement}
            style={workspace.surface === 'docked' ? `min-height:max(68vh, ${cardsHeight}px)` : ''}
          >
            {#if !liveSuggestions.length}
              <div class="empty-notes"><span>✓</span><p>No visible inputs.</p><small>Run a craft pass, change filters, or bring an invisible source back.</small></div>
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
                  revisionBusy={workspace.generating && revisionSuggestionId === suggestion.id}
                  revisionAvailable={hasRevisionProvider}
                  onActivate={() => void activateCard(suggestion.id)}
                  onSelectVariant={(index) => chooseVariant(suggestion.id, index)}
                  onAccept={(index, edit) => accept(suggestion, index, edit)}
                  onReject={(viaDrag) => reject(suggestion, viaDrag)}
                  onPreview={(text) => text === null ? workspace.clearPreview() : workspace.setPreview(suggestion.id, text)}
                  onSuggestRevision={() => void startSuggestionRevision(suggestion)}
                  onSourceHover={() => workspace.log('source_tooltip_hovered', { source: suggestion.source, sourceNumber: suggestion.sourceNumber }, suggestion.id)}
                  onMove={(direction) => workspace.reorder(suggestion.id, direction)}
                />
              </div>
            {/each}
          </div>
          {#if liveSuggestions.length}<p class="key-help">Card keys: <kbd>Tab</kbd> next · <kbd>1–3</kbd> variant · <kbd>Enter</kbd> accept · <kbd>E</kbd> accept/edit · <kbd>X</kbd> reject</p>{/if}
        </aside>
    </section>

    {#if ledgerOpen}<div class="ledger-panel"><LedgerTail events={workspace.ledger} costUsd={workspace.costUsd} /></div>{/if}
    </main>
  </div>

  <div class="pause-banner" class:mode-hidden={!isPaused}><b>Paused</b> — editing, dispatch timers, and provider spend are suspended.</div>
  {#if workspace.notice}<button class="notice" onclick={dismissNotice}>{workspace.notice}<span>×</span></button>{/if}
  {#if workspace.lastError}<button class="error" onclick={() => workspace.lastError = null}>{workspace.lastError}<span>×</span></button>{/if}
  {#if undoDismiss}<div class="undo-toast"><span>Suggestion dismissed</span><button onclick={undoDragDismiss}>Undo</button></div>{/if}

  {#if providerSettings.openRouterDialogOpen}
    <div class="modal-backdrop" role="presentation">
      <div class="settings provider-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="provider-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>AI source A3</small><h2 id="provider-title">OpenRouter</h2></div><button onclick={() => providerSettings.closeOpenRouter()}>×</button></header>
        <form onsubmit={saveOpenRouter}>
          <p class="provider-intro">The key and model are saved in the local server's ignored provider-settings file, readable only by your operating-system user. They are not written to the work, browser storage, or event ledger.</p>
          <label>OpenRouter API key {#if providerSettings.sourceAvailability.openrouter?.credentialHint}<small>Saved as {providerSettings.sourceAvailability.openrouter.credentialHint}; leave blank to keep it</small>{/if}<input name="openrouter-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required={!providerSettings.sourceAvailability.openrouter?.available} bind:value={providerSettings.openRouterKey} placeholder={providerSettings.sourceAvailability.openrouter?.credentialHint ?? 'sk-or-…'} /></label>
          <label>OpenRouter model ID<small>Exact OpenRouter model slug</small><input name="openrouter-model" required bind:value={providerSettings.openRouterModel} /></label>
          {#if providerSettings.error}<p class="provider-error" role="alert">{providerSettings.error}</p>{/if}
          <footer><p>The masked key confirms which credential is active without exposing it.</p><button type="button" onclick={() => providerSettings.closeOpenRouter()}>Cancel</button><button type="submit" class="primary" disabled={providerSettings.savingProvider}>{providerSettings.savingProvider ? 'Saving…' : 'Save provider'}</button></footer>
        </form>
      </div>
    </div>
  {/if}

  {#if projectDialogKind}
    <div class="modal-backdrop" role="presentation" onclick={() => projectDialogKind = null}>
      <div class="settings project-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="project-dialog-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <form onsubmit={submitProjectDialog}>
          <header><div><small>Project</small><h2 id="project-dialog-title">{projectDialogKind === 'create' ? 'Create project' : projectDialogKind === 'rename' ? 'Rename project' : 'Start over'}</h2></div><button type="button" onclick={() => projectDialogKind = null}>×</button></header>
          {#if projectDialogKind === 'reset'}
            <p class="reset-warning">This permanently removes the current project's documents, Collections, Todo records and content, Inputs, formats, and context. The project will restart with empty Spine and Todos documents.</p>
            <label>Type <strong>{workspace.currentProject?.title}</strong> to confirm<input aria-label="Project name confirmation" autocomplete="off" bind:value={projectDialogValue} /></label>
          {:else}
            <label>Project name<input aria-label="Project name" autocomplete="off" bind:value={projectDialogValue} /></label>
          {/if}
          <footer><p>{projectDialogKind === 'reset' ? 'This cannot be undone.' : 'The project name is separate from its fixed Spine and Todos.'}</p><button type="button" onclick={() => projectDialogKind = null}>Cancel</button><button class:danger={projectDialogKind === 'reset'} class="primary" disabled={!projectDialogValue.trim() || (projectDialogKind === 'reset' && projectDialogValue.trim() !== workspace.currentProject?.title)}>{projectDialogKind === 'reset' ? 'Start over' : projectDialogKind === 'rename' ? 'Rename' : 'Create'}</button></footer>
        </form>
      </div>
    </div>
  {/if}

  {#if inputsOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => inputsOpen = false}>
      <div class="input-manager" role="dialog" tabindex="-1" aria-modal="true" aria-label="Manage inputs" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header>
          <div><small>Workspace</small><h2>Inputs</h2></div>
          <button class="close" onclick={() => inputsOpen = false}>×</button>
        </header>
        <div class="input-controls">
          <input aria-label="Search inputs" placeholder="Search inputs" bind:value={inputSearch} />
          <select aria-label="Filter input state" bind:value={inputStateFilter}>
            <option value="all">All states</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="target_changed">Target changed</option>
            <option value="target_removed">Target removed</option>
            <option value="stale">Stale</option>
          </select>
        </div>
        <p class="input-summary">{managedInputs.length} of {workspace.inputs.length} inputs</p>
        <div class="input-list">
          {#if !managedInputs.length}<p class="input-empty">No inputs match this view.</p>{/if}
          {#each managedInputs as input}
            <article>
              <header><strong>{categoryMeta[input.category].label}</strong><span class="state state-{input.state}">{input.state.replaceAll('_', ' ')}</span></header>
              <p>{input.payload.comment}</p>
              <small>{input.sourceKind === 'local' ? 'Local' : 'AI'} · {input.source} · {targetLabel(input.target)}</small>
              {#if input.events.length}<small>{input.events.length} target {input.events.length === 1 ? 'event' : 'events'} recorded</small>{/if}
              <footer>
                {#if input.target.targets.length}<button onclick={() => { editor?.focusSuggestion(input); inputsOpen = false; }}>Locate</button>{/if}
                {#if input.state !== 'pending' && input.target.targets.length}<button onclick={() => setManagedInputState(input, 'pending')}>Reopen</button>{/if}
                {#if input.state === 'pending'}<button onclick={() => setManagedInputState(input, 'rejected')}>Dismiss</button>{/if}
              </footer>
            </article>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if settingsOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => settingsOpen = false}>
      <div class="settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="brief-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>Shared model context</small><h2 id="brief-title">Writing brief <span>v{workspace.brief.version}</span></h2></div><button onclick={() => settingsOpen = false}>×</button></header>
        <div class="form-grid">
          <label>Form<select bind:value={briefDraft.form}><option value="fiction">Fiction</option><option value="non-fiction">Non-fiction</option></select></label>
          <label>Point of view<input bind:value={briefDraft.pov} /></label>
          <label>Tense<input bind:value={briefDraft.tense} /></label>
          <label>Narrative distance<input bind:value={briefDraft.distance} /></label>
        </div>
        <label>Canon / background<textarea rows="7" bind:value={briefDraft.canon} placeholder="Characters, world rules, facts the suggesters must preserve…"></textarea><small>{briefDraft.canon.length} / 6000 characters sent in the POC</small></label>
        <label>Sentinel task prompt <span class="version">v{workspace.prompts.find((prompt) => prompt.id === 'sentinel')?.version ?? 1}</span><textarea rows="5" bind:value={sentinelInstruction}></textarea></label>
        <footer><p>Saving a material brief change expires live suggestions from older brief versions.</p><button onclick={() => settingsOpen = false}>Cancel</button><button class="primary" onclick={saveSettings}>Save new version</button></footer>
      </div>
    </div>
  {/if}

  {#if contextOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => contextOpen = false}>
      <div class="settings context-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="context-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header>
          <div><small>Versioned project knowledge</small><h2 id="context-title">Context buckets</h2></div>
          <button onclick={() => contextOpen = false}>×</button>
        </header>
        <p class="context-intro">Project buckets follow every document. Document buckets apply only to <strong>{workspace.currentDocument?.title}</strong>. Names and roles are descriptive, not a fixed schema.</p>
        <div class="context-list">
          {#each workspace.currentContext as bucket}
            {@const draft = contextDrafts[bucket.id]}
            {#if draft}
              <article class="context-bucket">
                <header>
                  <span>{bucket.scope} context · v{bucket.revision}</span>
                  {#if bucket.role === 'narrative_rules'}<b>carried forward</b>{/if}
                </header>
                <div class="context-fields">
                  <label>Title<input bind:value={draft.title} /></label>
                  <label>Optional role<input bind:value={draft.role} placeholder="character, research, scene_state…" /></label>
                </div>
                <label>Content<textarea rows={bucket.role === 'narrative_rules' ? 9 : 6} bind:value={draft.content}></textarea></label>
                <footer>
                  <small>Saving creates a new version; earlier content remains recoverable.</small>
                  {#if bucket.role !== 'narrative_rules'}<button class="danger" onclick={() => deleteContextBucket(bucket)}>Remove</button>{/if}
                  <button class="primary" onclick={() => saveContextBucket(bucket)}>Save new version</button>
                </footer>
              </article>
            {/if}
          {/each}
        </div>
        <section class="new-context">
          <h3>Add a bucket</h3>
          <div class="context-fields">
            <label>Title<input bind:value={newContextTitle} placeholder="Characters, location, scene state…" /></label>
            <label>Optional role<input bind:value={newContextRole} placeholder="Free-form label" /></label>
          </div>
          <label>Scope<select bind:value={newContextScope}><option value="project">Entire project</option><option value="document">Current document only</option></select></label>
          <button class="primary" disabled={!newContextTitle.trim()} onclick={addContextBucket}>Add empty bucket</button>
        </section>
        <footer><p>Active buckets are included in AI craft requests. There is no required scene, chapter, character, or genre schema.</p><button onclick={() => contextOpen = false}>Done</button></footer>
      </div>
    </div>
  {/if}
</div>

<style>
  .app-shell { min-height: 100vh; }
  .topbar { position: sticky; z-index: 30; top: 0; display: grid; grid-template-columns: 1fr auto; align-items: center; min-height: 58px; padding: 0 24px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 91%, transparent); backdrop-filter: blur(14px); }
  .brand { display: flex; align-items: baseline; gap: 8px; text-decoration: none; }
  .brand > span { color: var(--accent); font: 700 25px/1 var(--font-reading); }
  .brand strong { font: 700 14px/1 var(--font-ui); letter-spacing: -.02em; }
  .brand small { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .09em; }
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
  .workbench { display: grid; grid-template-columns: 270px minmax(0, 1fr); align-items: start; }
  main { min-width: 0; width: min(1190px, calc(100% - 36px)); margin: 0 auto; padding: 34px 0 80px; }
  .workspace { display: grid; grid-template-columns: minmax(540px, 830px) minmax(260px, 350px); justify-content: center; gap: clamp(28px, 5vw, 72px); }
  .document-column { min-width: 0; }
  .document-meta { display: flex; justify-content: space-between; align-items: center; min-height: 34px; margin-bottom: 8px; color: var(--muted); font-size: 10px; }
  .document-meta > div { display: flex; align-items: center; gap: 7px; }
  .document-selectors { min-width: 0; flex-wrap: wrap; }
  .document-selectors > span { color: var(--line-strong); }
  .document-meta select, .document-meta button { border: 0; background: transparent; color: var(--muted); padding: 4px; font-size: 10px; cursor: pointer; }
  .document-meta button:disabled { opacity: .35; cursor: default; }
  .document-meta select { color: var(--ink-soft); font-weight: 600; }
  .document-meta button:hover { color: var(--accent); }
  .document-tools { padding-left: 6px; border-left: 1px solid var(--line); }
  .editor-wrap { position: relative; }
  .editor-loading { display: grid; place-items: center; min-height: 68vh; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--muted); font: 12px/1.5 var(--font-ui); }
  .selection-menu { position: sticky; z-index: 12; bottom: 22px; display: flex; flex-wrap: wrap; align-items: center; gap: 3px; width: max-content; max-width: calc(100% - 40px); margin: -58px auto 17px; padding: 5px; border: 1px solid #34322e; border-radius: 4px; background: #282723; color: #f7f3e9; box-shadow: 0 10px 30px rgb(0 0 0 / .2); }
  .selection-menu span { padding: 0 8px; color: #a9a69f; font-size: 9px; }
  .selection-menu button { border: 0; border-radius: 2px; background: transparent; color: inherit; padding: 7px 9px; font-size: 10px; cursor: pointer; }
  .selection-menu button:hover { background: #3c3a35; }
  .selection-menu .contextual-revision { background: #3c3a35; color: #fff; }
  .custom-request { display: flex; flex: 1 0 100%; gap: 4px; padding: 3px; }
  .custom-request input { min-width: 280px; flex: 1; border: 1px solid #55524c; border-radius: 2px; background: #f7f3e9; color: #25231f; padding: 7px 8px; font: 11px/1.2 var(--font-ui); }
  .custom-request .request-example { max-width: 260px; color: #d7d2c8; text-align: left; white-space: normal; }
  .custom-request button:disabled { opacity: .4; cursor: default; }
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
  .source-buttons button.unavailable { border-style: dotted; opacity: .66; filter: grayscale(.65); }
  .source-buttons button.unavailable .state-icon, .source-buttons button.unavailable small { color: var(--reject); }
  .source-summary { color: var(--muted); font-size: 9px; }
  .source-summary strong { color: var(--ink-soft); }
  .source-summary em { font-style: normal; opacity: .7; }
  .provider-config { margin-left: auto; border: 1px solid var(--line-strong); border-radius: 3px; background: var(--paper); color: var(--ink-soft); padding: 7px 10px; font: 700 9px/1 var(--font-ui); cursor: pointer; }
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
  .project-settings { width: min(500px, 100%); }
  .project-settings form > header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px; }
  .project-settings .reset-warning { margin: 0; padding: 12px; border-left: 3px solid #9a4439; background: #9a44390d; color: var(--ink-soft); font: 11px/1.55 var(--font-ui); }
  .project-settings footer button.danger { border-color: #8d3329; background: #8d3329; }
  .input-manager { width: min(820px, 100%); max-height: calc(100vh - 44px); overflow: hidden; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); border: 1px solid var(--line); border-radius: 5px; background: var(--paper); box-shadow: 0 30px 80px rgb(26 22 17 / .22); padding: 24px; }
  .input-manager > header, .input-list article > header, .input-list article > footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .input-manager h2 { margin: 3px 0 0; font: 500 24px/1.2 var(--font-reading); }
  .input-manager header small { color: var(--muted); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .input-manager .close { border: 0; background: transparent; color: var(--muted); font-size: 24px; cursor: pointer; }
  .input-controls { display: grid; grid-template-columns: 1fr 190px; gap: 9px; margin-top: 18px; }
  .input-controls input, .input-controls select { width: 100%; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; color: var(--ink); padding: 9px 10px; outline: none; font-size: 11px; }
  .input-summary { margin: 10px 0; color: var(--muted); font-size: 9px; }
  .input-list { overflow: auto; display: grid; gap: 8px; padding-right: 4px; }
  .input-list article { border: 1px solid var(--line); border-radius: 4px; background: #fffefa; padding: 12px; }
  .input-list article strong { font: 700 10px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .05em; }
  .input-list article p { margin: 9px 0; color: var(--ink-soft); font: 12px/1.45 var(--font-ui); }
  .input-list article small { display: block; margin-top: 4px; color: var(--muted); font: 9px/1.4 var(--font-ui); }
  .input-list article footer { justify-content: flex-end; margin-top: 9px; }
  .input-list article footer button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 6px 9px; font-size: 9px; cursor: pointer; }
  .state { border-radius: 999px; background: var(--paper-deep); color: var(--muted); padding: 4px 7px; font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .04em; }
  .state-pending { background: var(--accent-soft); color: var(--accent); }
  .state-target_changed, .state-target_removed { background: #f5dfdb; color: var(--reject); }
  .input-empty { padding: 48px 20px; text-align: center; color: var(--muted); }
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
  .settings > footer, .settings form > footer { display: flex; align-items: center; justify-content: flex-end; gap: 7px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
  .settings footer p { flex: 1; margin: 0; color: var(--muted); font: 9px/1.5 var(--font-ui); }
  .settings footer button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 8px 12px; font-size: 10px; cursor: pointer; }
  .settings footer .primary { background: var(--accent); border-color: var(--accent); color: white; }
  .settings footer button:disabled { opacity: .45; cursor: default; }
  .provider-settings { width: min(560px, 100%); }
  .provider-intro { margin: -6px 0 18px; color: var(--muted); font: 11px/1.6 var(--font-ui); }
  .provider-error { margin: 8px 0 0; color: var(--reject); font: 600 10px/1.4 var(--font-ui); }
  .provider-identity { color: var(--muted); font: 9px/1.2 var(--font-mono); }
  .context-settings { width: min(840px, 100%); }
  .context-intro { margin: -8px 0 20px; color: var(--muted); font: 11px/1.6 var(--font-ui); }
  .context-list { display: grid; gap: 14px; }
  .context-bucket { border: 1px solid var(--line); border-radius: 4px; background: #fffefa; padding: 14px; }
  .context-bucket > header { display: flex; justify-content: space-between; margin-bottom: 12px; color: var(--muted); font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .07em; }
  .context-bucket > header b { color: var(--accent); }
  .context-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .context-bucket > footer { display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding-top: 3px; }
  .context-bucket > footer small { flex: 1; color: var(--muted); font: 9px/1.4 var(--font-ui); }
  .settings footer .danger { border-color: #d9b9b3; color: var(--reject); }
  .project-settings footer button.primary.danger { border-color: #8d3329; background: #8d3329; color: #fff; }
  .new-context { margin-top: 18px; padding: 16px; border: 1px dashed var(--line-strong); border-radius: 4px; }
  .new-context h3 { margin: 0 0 12px; font: 600 14px/1.2 var(--font-ui); }
  .new-context > button { float: right; border: 1px solid var(--accent); border-radius: 3px; background: var(--accent); color: white; padding: 8px 12px; font-size: 10px; cursor: pointer; }
  .new-context > button:disabled { opacity: .45; cursor: default; }
  .new-context::after { display: block; clear: both; content: ''; }
  @media (max-width: 980px) {
    .workbench { grid-template-columns: 230px minmax(0, 1fr); }
    .workspace { grid-template-columns: minmax(0, 1fr); }
    aside { padding-top: 8px; }
    .cards.docked { display: grid; gap: 10px; min-height: 0; padding-top: 12px; }
    .cards.docked .card-slot { position: static; }
    .brand small { display: none; }
    .filterbar { overflow-x: auto; }
  }
  @media (max-width: 680px) {
    .topbar { grid-template-columns: 1fr auto; padding: 0 12px; }
    .top-actions button:nth-last-child(n+3), .top-actions a { display: none; }
    .filterbar { top: 58px; }
    .workbench { grid-template-columns: 1fr; }
    main { width: calc(100% - 20px); padding-top: 18px; }
    .form-grid { grid-template-columns: 1fr; }
    .context-fields { grid-template-columns: 1fr; }
  }
</style>
