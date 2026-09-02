<script lang="ts">
  import { onMount, tick } from 'svelte';
  import EditorShell from '$lib/editor/EditorShell.svelte';
  import SuggestionCard from '$lib/components/SuggestionCard.svelte';
  import LedgerTail from '$lib/components/LedgerTail.svelte';
  import Navigator from '$lib/components/Navigator.svelte';
  import AIActionManager from '$lib/components/AIActionManager.svelte';
  import { categories, categoryMeta, makeId, wordCount, type Branch, type ProviderProtocol, type Suggestion, type TaskPrompt } from '$lib/domain';
  import { targetLabel } from '$lib/workspace/attachments';
  import { workspace } from '$lib/state/workspace.svelte';
  import { providerPresetFor, settings as providerSettings } from '$lib/state/settings.svelte';
  import type { ContextBucket, ContextScope } from '$lib/workspace/model';
  import { clampEditorZoom, clampInputsWidth, clampNavigatorWidth, DEFAULT_EDITOR_ZOOM, DEFAULT_INPUTS_WIDTH, DEFAULT_NAVIGATOR_WIDTH, maxInputsWidth, maxNavigatorWidth, MAX_EDITOR_ZOOM, MIN_EDITOR_ZOOM, MIN_INPUTS_WIDTH, MIN_NAVIGATOR_WIDTH } from '$lib/workspace/layout';
  import { selectDisplayedInputs, summarizeLatestCraftActivity, type CraftActivityState } from '$lib/workspace/input-panel';
  import { latestProviderReconfigurationIssue, summarizeProviderHealth } from '$lib/workspace/run-management';
  import type { AIContextSelection } from '$lib/ai/contracts';
  import { prosePatternAuditActionId, type AIActionDefinition, type AIActionTargetScope } from '$lib/ai/actions';
  import type { ProjectExportMode, ProjectImportPreview } from '$lib/workspace/project-transfer';
  import type { StorageAnalysis } from '$lib/workspace/retention';
  import { groupAIContextMaterials, type AIContextMaterialGroup } from '$lib/workspace/context-materials';

  type ContextDraft = Pick<ContextBucket, 'title' | 'role' | 'content'>;

  let editor = $state<EditorShell | null>(null);
  let selection = $state({ from: 1, to: 1, text: '' });
  let selectedVariants = $state<Record<string, number>>({});
  let contextOpen = $state(false);
  let ledgerOpen = $state(false);
  let inputsOpen = $state(false);
  let inputControlsOpen = $state(false);
  let runManagerOpen = $state(false);
  let inputStateFilter = $state('all');
  let inputSearch = $state('');
  let sentinelInstruction = $state('');
  let editTimer: ReturnType<typeof setTimeout> | null = null;
  let documentSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let scanTimer: ReturnType<typeof setTimeout> | null = null;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let editSession = { started: 0, characters: 0, text: '' };
  let editorReady = $state(false);
  let workspaceReady = $state(false);
  let cardsElement = $state<HTMLDivElement>();
  let undoDismiss = $state<{ suggestion: Suggestion; timer: ReturnType<typeof setTimeout> } | null>(null);
  let liveSuggestions = $state<Suggestion[]>([]);
  let pendingInputCount = $state(0);
  let inputsHiddenByFilters = $state(0);
  let duplicateInputsCombined = $state(0);
  let inputsBeyondLimit = $state(0);
  let displayableInputCount = $state(0);
  let reviewsEnabled = $derived(workspace.reviewsEnabled);
  let actionsEnabled = $derived(workspace.actionsEnabled);
  let contextDrafts = $state<Record<string, ContextDraft>>({});
  let newContextTitle = $state('');
  let newContextRole = $state('');
  let newContextScope = $state<ContextScope>('project');
  let revisionSuggestionId = $state<string | null>(null);
  let revisionBusyInputId = $state<string | null>(null);
  let customRequestOpen = $state(false);
  let customRequest = $state('');
  let projectDialogKind = $state<'create' | 'rename' | 'reset' | 'delete' | null>(null);
  let projectDialogValue = $state('');
  let projectDialogPending = $state(false);
  let projectExporting = $state(false);
  let projectImportInput = $state<HTMLInputElement>();
  let projectImportFile = $state<File | null>(null);
  let projectImportPreview = $state<ProjectImportPreview | null>(null);
  let projectImportOpen = $state(false);
  let projectImportPending = $state(false);
  let storageAnalysisOpen = $state(false);
  let storageAnalysisLoading = $state(false);
  let storageAnalysis = $state<StorageAnalysis | null>(null);
  let navigatorVisible = $state(true);
  let reviewPanelVisible = $state(true);
  let navigatorWidth = $state(DEFAULT_NAVIGATOR_WIDTH);
  let inputsWidth = $state(DEFAULT_INPUTS_WIDTH);
  let editorZoom = $state(DEFAULT_EDITOR_ZOOM);
  let viewportWidth = $state(1440);
  let draggedInputId = $state<string | null>(null);
  let inputDropTarget = $state<{ id: string; position: 'before' | 'after' } | null>(null);
  let navigatorResizeCleanup: (() => void) | null = null;
  let inputsResizeCleanup: (() => void) | null = null;
  let inputDragCleanup: (() => void) | null = null;
  let dismissedProviderIssueKey = $state<string | null>(null);
  let contextPreflightOpen = $state(false);
  let contextPickerOpen = $state(false);
  let contextPreflightLocked = $state(false);
  let contextPreflightTargetId = $state<string | null>(null);
  let reviewContextSelection = $state<AIContextSelection>({ includeMaterial: true, includeRelationships: true, includeTodos: true, addedSourceIds: [] });
  let clearInputsConfirmOpen = $state(false);
  let actionManagerOpen = $state(false);
  let actionRunnerOpen = $state(false);
  let actionRunnerId = $state('');
  let actionRunnerScope = $state<AIActionTargetScope>('selection');
  let actionRunnerRange = $state<{ from: number; to: number; text: string } | null>(null);
  let actionRunnerContext = $state<AIContextSelection>({ includeMaterial: true, includeRelationships: true, includeTodos: true, addedSourceIds: [] });
  let actionRunnerLocked = $state(false);
  let actionContextPickerOpen = $state(false);
  let manualReviewActive = $state(false);
  let manualActionLabel = $state<string | null>(null);
  let aiWaitDismissed = $state(false);

  const layoutStorageKey = 'margin-note:workbench-layout';

  let selectedPrompt = $derived(workspace.prompts.find((prompt) => prompt.id === 'sentinel') ?? workspace.prompts[0]);
  let reviewPrompt = $derived(selectedPrompt ? { ...selectedPrompt, instruction: sentinelInstruction.trim() || selectedPrompt.instruction } : null);
  let currentDocumentText = $derived(workspace.currentDocument?.content ?? '');
  let documentSaveState = $derived(workspace.workspaceSaveState);
  let unsavedDocumentCount = $derived(workspace.unsavedDocumentCount);
  let revisionSuggestion = $derived(workspace.suggestions.find((suggestion) => suggestion.id === revisionSuggestionId) ?? null);
  let hasRevisionProvider = $derived(
    providerSettings.sources.some((source) => source.number >= 3
      && workspace.sourceStates[source.id] === 'visible'
      && providerSettings.sourceAvailability[source.id]?.available === true)
  );
  let managedInputs = $derived.by(() => workspace.inputs
    .filter((input) => inputStateFilter === 'all' || input.state === inputStateFilter)
    .filter((input) => !inputSearch.trim() || `${input.payload.comment} ${input.source} ${input.category} ${input.state}`.toLowerCase().includes(inputSearch.trim().toLowerCase()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)));
  let latestCraftActivity = $derived(summarizeLatestCraftActivity(workspace.runs, workspace.branchId));
  let editingProviderAvailability = $derived(providerSettings.providerForm.id ? providerSettings.sourceAvailability[providerSettings.providerForm.id] : undefined);
  let activeProviderPreset = $derived(providerPresetFor(providerSettings.providerForm));
  let enabledRunSourceCount = $derived(providerSettings.sources.filter((source) => workspace.sourceStates[source.id] !== 'off' && providerSettings.sourceAvailability[source.id]?.available === true).length);
  let hiddenInputFilterCount = $derived(
    categories.filter((category) => !workspace.categoryVisibility[category]).length
    + providerSettings.sources.filter((source) => workspace.inputSourceVisibility[source.id] === false).length
  );
  let providerConfigurationIssue = $derived.by(() => {
    const issue = latestProviderReconfigurationIssue(
      workspace.runs,
      workspace.branchId,
      providerSettings.sources
        .filter((source) => source.number >= 3 && workspace.sourceStates[source.id] !== undefined && workspace.sourceStates[source.id] !== 'off')
        .map((source) => source.id)
    );
    if (!issue) return null;
    const key = `${issue.runId}:${issue.sourceId}:${issue.error.message}`;
    return key === dismissedProviderIssueKey ? null : { ...issue, key };
  });
  let reviewContextManifest = $derived(reviewPrompt && contextPreflightOpen
    ? workspace.reviewContextPreview(reviewPrompt, reviewContextSelection)
    : null);
  let interruptedRuns = $derived(workspace.runs.filter((run) =>
    run.documentId === workspace.branchId
    && run.errors.some((error) => error.classification === 'interrupted' && !error.recovered)));
  let clearableInputCount = $derived(workspace.inputs.filter((input) => input.state === 'pending' || input.state === 'hidden').length);
  let selectedAction = $derived(workspace.actions.find((action) => action.id === actionRunnerId) ?? null);
  let actionContextManifest = $derived(selectedAction && actionRunnerOpen
    ? workspace.actionContextPreview(selectedAction, actionRunnerScope, actionRunnerRange, actionRunnerContext)
    : null);
  let reviewContextMaterialGroups = $derived(groupAIContextMaterials(
    workspace.aiContextMaterials,
    workspace.navigator.collections,
    contextPreflightTargetId
  ));
  let actionContextMaterialGroups = $derived(groupAIContextMaterials(
    workspace.aiContextMaterials,
    workspace.navigator.collections,
    workspace.branchId
  ));
  let aiWaitLabel = $derived(manualActionLabel ?? (manualReviewActive ? 'Reviewing document…' : null));

  const activityLabels: Record<CraftActivityState, string> = {
    running: 'Running',
    completed: 'Complete',
    partial: 'Partially complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
    discarded: 'Superseded by edits'
  };

  onMount(() => {
    viewportWidth = window.innerWidth;
    try {
      const saved = JSON.parse(localStorage.getItem(layoutStorageKey) ?? '{}') as {
        navigatorVisible?: boolean;
        reviewPanelVisible?: boolean;
        navigatorWidth?: number;
        inputsWidth?: number;
        editorZoom?: number;
      };
      navigatorVisible = saved.navigatorVisible !== false;
      reviewPanelVisible = saved.reviewPanelVisible !== false;
      navigatorWidth = clampNavigatorWidth(saved.navigatorWidth ?? DEFAULT_NAVIGATOR_WIDTH, window.innerWidth);
      inputsWidth = clampInputsWidth(saved.inputsWidth ?? DEFAULT_INPUTS_WIDTH, window.innerWidth);
      editorZoom = clampEditorZoom(saved.editorZoom ?? DEFAULT_EDITOR_ZOOM);
    } catch {
      navigatorWidth = clampNavigatorWidth(DEFAULT_NAVIGATOR_WIDTH, window.innerWidth);
      inputsWidth = clampInputsWidth(DEFAULT_INPUTS_WIDTH, window.innerWidth);
      editorZoom = DEFAULT_EDITOR_ZOOM;
    }
    void workspace.initialize().then(() => {
      sentinelInstruction = workspace.prompts.find((prompt) => prompt.id === 'sentinel')?.instruction ?? '';
      workspaceReady = true;
      refreshLiveSuggestions();
    });
    const keydown = (event: KeyboardEvent) => handleReviewKeys(event);
    const relayout = () => {
      viewportWidth = window.innerWidth;
      navigatorWidth = clampNavigatorWidth(navigatorWidth, window.innerWidth);
      inputsWidth = clampInputsWidth(inputsWidth, window.innerWidth);
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('resize', relayout);
    window.addEventListener('scroll', relayout, { passive: true });
    return () => {
      window.removeEventListener('keydown', keydown);
      window.removeEventListener('resize', relayout);
      window.removeEventListener('scroll', relayout);
      navigatorResizeCleanup?.();
      inputsResizeCleanup?.();
      inputDragCleanup?.();
      if (editTimer) clearTimeout(editTimer);
      if (documentSaveTimer) clearTimeout(documentSaveTimer);
      if (scanTimer) clearTimeout(scanTimer);
      if (noticeTimer) clearTimeout(noticeTimer);
    };
  });

  function persistWorkbenchLayout(): void {
    localStorage.setItem(layoutStorageKey, JSON.stringify({ navigatorVisible, reviewPanelVisible, navigatorWidth, inputsWidth, editorZoom }));
  }

  function toggleNavigatorPane(): void {
    navigatorVisible = !navigatorVisible;
    persistWorkbenchLayout();
  }

  function toggleReviewPanel(): void {
    reviewPanelVisible = !reviewPanelVisible;
    persistWorkbenchLayout();
  }

  function setNavigatorWidth(width: number): void {
    navigatorWidth = clampNavigatorWidth(width, window.innerWidth);
  }

  function setInputsWidth(width: number): void {
    inputsWidth = clampInputsWidth(width, window.innerWidth);
  }

  function setEditorZoom(zoom: number): void {
    editorZoom = clampEditorZoom(zoom);
    persistWorkbenchLayout();
  }

  function startNavigatorResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = navigatorWidth;
    document.body.classList.add('resizing-navigator');
    const move = (moveEvent: PointerEvent) => setNavigatorWidth(startWidth + moveEvent.clientX - startX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.classList.remove('resizing-navigator');
      navigatorResizeCleanup = null;
      persistWorkbenchLayout();
    };
    navigatorResizeCleanup?.();
    inputsResizeCleanup?.();
    navigatorResizeCleanup = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function resizeNavigatorWithKeyboard(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setNavigatorWidth(navigatorWidth + (event.key === 'ArrowLeft' ? -20 : 20));
    persistWorkbenchLayout();
  }

  function startInputsResize(event: PointerEvent): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inputsWidth;
    document.body.classList.add('resizing-inputs');
    const move = (moveEvent: PointerEvent) => setInputsWidth(startWidth + startX - moveEvent.clientX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      document.body.classList.remove('resizing-inputs');
      inputsResizeCleanup = null;
      persistWorkbenchLayout();
    };
    navigatorResizeCleanup?.();
    inputsResizeCleanup?.();
    inputsResizeCleanup = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function resizeInputsWithKeyboard(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    setInputsWidth(inputsWidth + (event.key === 'ArrowLeft' ? 20 : -20));
    persistWorkbenchLayout();
  }

  function refreshLiveSuggestions(): void {
    const display = selectDisplayedInputs(
      workspace.suggestions,
      workspace.categoryVisibility,
      workspace.inputSourceVisibility,
      workspace.densityCap
    );
    liveSuggestions = display.displayed;
    pendingInputCount = display.pendingCount;
    inputsHiddenByFilters = display.hiddenByFilters;
    duplicateInputsCombined = display.duplicatesCombined;
    inputsBeyondLimit = display.beyondLimit;
    displayableInputCount = display.displayableCount;
    if (editorReady) void tick().then(() => editor?.syncAttachments(liveSuggestions, workspace.formats));
  }

  function showMoreInputs(): void {
    workspace.densityCap = Math.min(displayableInputCount, workspace.densityCap + 8);
    refreshLiveSuggestions();
  }

  function showAllInputs(): void {
    workspace.densityCap = Math.max(1, displayableInputCount);
    refreshLiveSuggestions();
  }

  function fixProviderIssue(): void {
    const issue = providerConfigurationIssue;
    if (!issue) return;
    dismissedProviderIssueKey = issue.key;
    providerSettings.openProviders(issue.sourceId);
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

  async function toggleRunSource(sourceId: string): Promise<void> {
    if (providerSettings.sourceAvailability[sourceId]?.available !== true) providerSettings.openProviders(sourceId);
    else {
      const enabling = workspace.sourceStates[sourceId] === 'off';
      await workspace.toggleRunSource(sourceId);
      if (enabling && !workspace.reviewsEnabled) {
        const name = providerSettings.sourceAvailability[sourceId]?.name ?? sourceId;
        workspace.notice = `${name} is selected for future reviews, but Reviews are paused. Enable Reviews, then use Document review for existing text.`;
      }
    }
  }

  async function toggleInputSource(sourceId: string): Promise<void> {
    const saving = workspace.toggleInputSourceVisibility(sourceId);
    refreshLiveSuggestions();
    await tick();
    await saving;
  }

  async function saveProvider(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const keepOpen = (event.submitter as HTMLButtonElement | null)?.value === 'add-another';
    try {
      const configured = await providerSettings.saveProvider({
        id: String(form.get('provider-id') ?? '').trim() || undefined,
        name: String(form.get('provider-name') ?? ''),
        protocol: String(form.get('provider-protocol') ?? 'openai_compatible') as ProviderProtocol,
        baseUrl: String(form.get('provider-base-url') ?? ''),
        key: String(form.get('provider-key') ?? ''),
        model: String(form.get('provider-model') ?? '')
      }, { keepOpen });
      workspace.syncAvailableSources();
      workspace.enableConfiguredSource(configured.id);
      workspace.notice = `${configured.availability.name ?? configured.id} ${configured.availability.model ?? ''} was saved locally and enabled for future requests.`;
      refreshLiveSuggestions();
    } catch (error) {
      workspace.lastError = providerSettings.error ?? (error instanceof Error ? error.message : 'Provider configuration failed');
    }
  }

  async function startCodexLogin(): Promise<void> {
    const loginWindow = window.open('about:blank', 'margin-note-codex-login');
    try {
      const login = await providerSettings.startCodexLogin();
      if (loginWindow) loginWindow.location.href = login.authUrl;
      else workspace.notice = 'ChatGPT sign-in is ready. Use the Continue sign-in link in Providers.';
    } catch (error) {
      loginWindow?.close();
      workspace.lastError = providerSettings.error ?? (error instanceof Error ? error.message : 'Could not start ChatGPT sign-in');
    }
  }

  async function refreshCodexStatus(): Promise<void> {
    const status = await providerSettings.refreshCodex();
    workspace.notice = status.connected
      ? `ChatGPT connected${status.email ? ` as ${status.email}` : ''}${status.planType ? ` (${status.planType})` : ''}.`
      : status.reason ?? 'ChatGPT is not connected.';
  }

  async function deleteProvider(sourceId: string): Promise<void> {
    if (!confirm(`Remove provider profile “${providerSettings.sourceAvailability[sourceId]?.name ?? sourceId}”?`)) return;
    try {
      await providerSettings.deleteProvider(sourceId);
      workspace.sourceStates[sourceId] = 'off';
      workspace.notice = 'Provider profile removed. Existing run and Input provenance was retained.';
    } catch (error) {
      workspace.lastError = providerSettings.error ?? (error instanceof Error ? error.message : 'Provider removal failed');
    }
  }

  async function retryFailedRun(runId: string): Promise<void> {
    await workspace.retryRun(runId);
  }

  function openReviewPreflight(): void {
    if (!selectedPrompt) return;
    sentinelInstruction = selectedPrompt.instruction;
    reviewContextSelection = workspace.contextSelection(selectedPrompt.id);
    contextPreflightTargetId = workspace.branchId;
    contextPickerOpen = false;
    contextPreflightOpen = true;
  }

  function toggleAddedContext(sourceId: string): void {
    if (contextPreflightLocked) return;
    reviewContextSelection = {
      ...reviewContextSelection,
      addedSourceIds: reviewContextSelection.addedSourceIds.includes(sourceId)
        ? reviewContextSelection.addedSourceIds.filter((id) => id !== sourceId)
        : [...reviewContextSelection.addedSourceIds, sourceId]
    };
  }

  async function openContextSource(sourceId: string): Promise<void> {
    if (contextPreflightLocked) return;
    contextPreflightOpen = false;
    if (workspace.projectNodes.some((document) => document.id === sourceId)) await workspace.switchBranch(sourceId);
  }

  async function runReviewFromPreflight(): Promise<void> {
    if (!selectedPrompt || contextPreflightTargetId !== workspace.branchId) return;
    contextPreflightLocked = true;
    manualReviewActive = true;
    aiWaitDismissed = false;
    try {
      let prompt = selectedPrompt;
      const instruction = sentinelInstruction.trim();
      if (!instruction) return;
      if (instruction !== prompt.instruction) {
        await workspace.savePrompt({ ...prompt, instruction });
        prompt = workspace.prompts.find((item) => item.id === prompt.id) ?? { ...prompt, instruction };
      }
      await workspace.saveContextSelection(prompt.id, reviewContextSelection);
      const running = runSentinels(reviewContextSelection, prompt);
      contextPreflightOpen = false;
      await running;
    } finally {
      manualReviewActive = false;
      contextPreflightLocked = false;
    }
  }

  function openActionRunner(scope: AIActionTargetScope = selection.text.trim() ? 'selection' : 'document', actionId?: string): void {
    const available = workspace.actions.filter((action) => action.allowedTargets.includes(scope)
      && (!action.requiresSelection || Boolean(selection.text.trim())));
    const action = available.find((item) => item.id === actionId) ?? available[0];
    if (!action) {
      showNotice(scope === 'selection' ? 'No project action can run on this selection.' : 'No project action can run on the current document.');
      return;
    }
    actionRunnerId = action.id;
    actionRunnerScope = scope;
    actionRunnerRange = scope === 'selection' ? { ...selection } : null;
    actionRunnerContext = workspace.actionContextSelection(action);
    actionContextPickerOpen = false;
    actionRunnerOpen = true;
  }

  function chooseAction(id: string): void {
    const action = workspace.actions.find((item) => item.id === id);
    if (!action) return;
    actionRunnerId = id;
    const defaultAvailable = action.allowedTargets.includes(action.defaultTarget)
      && (action.defaultTarget !== 'selection' || Boolean(selection.text.trim()));
    const scope = defaultAvailable
      ? action.defaultTarget
      : action.allowedTargets.includes('document') && !action.requiresSelection
        ? 'document'
        : 'selection';
    changeActionScope(scope);
    actionRunnerContext = workspace.actionContextSelection(action);
  }

  function changeActionScope(scope: AIActionTargetScope): void {
    actionRunnerScope = scope;
    actionRunnerRange = scope === 'selection' ? { ...selection } : null;
  }

  function toggleActionContext(sourceId: string): void {
    if (actionRunnerLocked) return;
    actionRunnerContext = {
      ...actionRunnerContext,
      addedSourceIds: actionRunnerContext.addedSourceIds.includes(sourceId)
        ? actionRunnerContext.addedSourceIds.filter((id) => id !== sourceId)
        : [...actionRunnerContext.addedSourceIds, sourceId]
    };
  }

  async function runConfiguredAction(): Promise<void> {
    const action = selectedAction;
    if (!action || !actionContextManifest) return;
    actionRunnerLocked = true;
    manualActionLabel = `Performing ${action.name}…`;
    aiWaitDismissed = false;
    try {
      await workspace.saveContextSelection(action.id, actionRunnerContext);
      const activityIdsBefore = new Set(workspace.activities.map((activity) => activity.id));
      const running = workspace.runAIAction(action, actionRunnerScope, actionRunnerRange, actionRunnerContext, () => refreshLiveSuggestions());
      const actionActivityId = workspace.activities.find((activity) => !activityIdsBefore.has(activity.id))?.id;
      actionRunnerOpen = false;
      const incoming = await running;
      const activity = workspace.activities.find((candidate) => candidate.id === actionActivityId);
      const proposalCount = activity?.runIds.reduce((total, runId) =>
        total + (workspace.runs.find((run) => run.id === runId)?.proposalIds.length ?? 0), 0) ?? 0;
      refreshLiveSuggestions();
      if (incoming[0]) void activateCard(incoming[0].id);
      if (!workspace.notice) {
        if (incoming.length) {
          showNotice(`${action.name}: ${incoming.length} new ${incoming.length === 1 ? 'Input' : 'Inputs'}.`);
        } else if (activity?.state === 'completed' && action.id === prosePatternAuditActionId) {
          showNotice(proposalCount ? 'No new prose pattern issues found.' : 'No prose pattern issues found.');
        } else if (activity && activity.state !== 'completed') {
          showNotice(`${action.name} ${activity.state === 'partial' ? 'completed only partially' : `ended ${activity.state}`}; check History for details.`);
        } else {
          showNotice(`${action.name} completed without a usable Input.`);
        }
      }
    } finally {
      manualActionLabel = null;
      actionRunnerLocked = false;
    }
  }

  async function saveAction(action: AIActionDefinition): Promise<void> {
    const saved = await workspace.saveAIAction(action);
    actionRunnerId = saved.id;
  }

  async function deleteAction(id: string): Promise<void> {
    await workspace.deleteAIAction(id);
  }

  async function retryInterrupted(): Promise<void> {
    for (const run of interruptedRuns) await workspace.retryRun(run.id);
    refreshLiveSuggestions();
  }

  async function recoverFailedRun(runId: string): Promise<void> {
    const recovered = await workspace.recoverRun(runId);
    refreshLiveSuggestions();
    if (recovered[0]) void activateCard(recovered[0].id);
  }

  async function completeInterrupted(): Promise<void> {
    for (const run of interruptedRuns) await workspace.completeInterruptedRun(run.id);
  }

  async function changeReviews(): Promise<void> {
    const enabling = !workspace.reviewsEnabled;
    await workspace.toggleReviews();
    if (enabling) workspace.notice = 'Reviews enabled. Use Document review to review existing text; automatic reviews run after the next edit.';
  }

  async function changeActions(): Promise<void> {
    await workspace.toggleActions();
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
    if (!detail.characters) return;
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
    if (workspace.reviewsEnabled) scanTimer = setTimeout(() => void runSentinels(), 5000);
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
    const saving = workspace.setInputState(input.id, state, state === 'pending' ? 'Reopen input' : 'Dismiss input');
    refreshLiveSuggestions();
    await tick();
    await saving;
  }

  async function clearPendingInputs(): Promise<void> {
    const cleared = await workspace.clearPendingInputs();
    clearInputsConfirmOpen = false;
    refreshLiveSuggestions();
    showNotice(cleared ? `${cleared} pending ${cleared === 1 ? 'Input was' : 'Inputs were'} cleared. Runs and history were retained.` : 'There are no pending Inputs to clear.');
  }

  function scheduleDocumentSave(reason: string): void {
    if (documentSaveTimer) clearTimeout(documentSaveTimer);
    workspace.markCurrentDocumentDirty();
    documentSaveTimer = setTimeout(() => {
      documentSaveTimer = null;
      void workspace.persistCurrentDocument(reason);
    }, 1200);
  }

  function enqueueScheduledDocumentSave(reason: string): void {
    if (!documentSaveTimer) return;
    clearTimeout(documentSaveTimer);
    documentSaveTimer = null;
    void workspace.persistCurrentDocument(reason);
  }

  async function runSentinels(contextSelection?: AIContextSelection, prompt: TaskPrompt | null = selectedPrompt): Promise<void> {
    if (!prompt || !workspace.reviewsEnabled) return;
    workspace.notice = null;
    const incoming = await workspace.runCraftPass(prompt, contextSelection, () => refreshLiveSuggestions());
    if (!workspace.notice) showNotice(incoming.length
      ? `${incoming.length} new ${incoming.length === 1 ? 'input' : 'inputs'} added.`
      : 'Review complete; no new inputs.');
    refreshLiveSuggestions();
  }

  async function runSelectionPrompt(prompt: TaskPrompt, pendingMessage?: string): Promise<Suggestion[]> {
    if (!selection.text.trim()) return [];
    workspace.notice = null;
    if (pendingMessage) showNotice(pendingMessage);
    const incoming = await workspace.runSelectionPass(selection, prompt);
    refreshLiveSuggestions();
    await tick();
    if (incoming[0]) void activateCard(incoming[0].id);
    return incoming;
  }

  async function runSelection(promptId: string): Promise<void> {
    const prompt = workspace.prompts.find((item) => item.id === promptId) ?? { id: promptId, name: promptId, version: 1, instruction: `Offer a ${promptId} revision.` };
    await runSelectionPrompt(prompt);
  }

  function inputCardLabel(suggestion: Suggestion): string {
    return workspace.actions.find((action) => action.id === suggestion.provenance.actionId)?.name
      ?? categoryMeta[suggestion.category].label;
  }

  async function selectSuggestionForRevision(suggestion: Suggestion): Promise<void> {
    revisionSuggestionId = suggestion.id;
    customRequestOpen = false;
    workspace.activate(suggestion.id);
    editor?.focusSuggestion(suggestion);
    await tick();
  }

  async function suggestNoteRevisions(suggestion: Suggestion): Promise<void> {
    if (!hasRevisionProvider) {
      showNotice('Enable OpenRouter or Ollama to suggest contextual revisions.');
      return;
    }
    const label = categoryMeta[suggestion.category].label.toLowerCase();
    const pendingMessage = `Requesting ${label} revisions…`;
    revisionBusyInputId = suggestion.id;
    workspace.notice = null;
    showNotice(pendingMessage);
    try {
      const incoming = await workspace.runInputRevisionPass(suggestion.id, {
        id: `address-${suggestion.category}`,
        name: `Address ${categoryMeta[suggestion.category].label} note`,
        version: 1,
        instruction: `Offer two or three distinct replacement revisions for the selected passage that address this ${label} note: ${suggestion.payload.comment} Preserve established facts, voice, tense, and intended point of view. Return practical alternatives rather than repeating the diagnosis.`
      });
      refreshLiveSuggestions();
      await tick();
      if (incoming[0]) void activateCard(incoming[0].id);
      if (workspace.notice === pendingMessage) {
        showNotice(incoming.length
          ? `${incoming.length} revision ${incoming.length === 1 ? 'option' : 'options'} returned.`
          : 'The provider returned no usable revision alternatives.');
      }
    } finally {
      if (revisionBusyInputId === suggestion.id) revisionBusyInputId = null;
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
  }

  async function activateCard(id: string): Promise<void> {
    const suggestion = liveSuggestions.find((item) => item.id === id);
    workspace.activate(id);
    await tick();
    if (suggestion?.anchorStatus === 'unanchored') showNotice('This Input is unanchored. Select the relevant text, then choose Attach to selection.');
    else if (suggestion) editor?.focusSuggestion(suggestion);
    cardsElement?.querySelector<HTMLElement>(`.card-slot[data-suggestion-id="${id}"] .card`)?.focus({ preventScroll: true });
  }

  async function bindInputToSelection(suggestion: Suggestion): Promise<void> {
    if (!selection.text.trim()) {
      showNotice('Select the text this Input should apply to, then choose Attach to selection.');
      return;
    }
    if (!await workspace.bindInputToSelection(suggestion.id, selection.from, selection.to, selection.text)) return;
    refreshLiveSuggestions();
    await tick();
    const rebound = workspace.inputs.find((item) => item.id === suggestion.id);
    if (rebound) editor?.focusSuggestion(rebound);
    showNotice('Input attached to the selected text. Choose a revision to apply it.');
  }

  function chooseVariant(id: string, index: number): void {
    selectedVariants = { ...selectedVariants, [id]: index };
    workspace.activate(id);
  }

  async function accept(suggestion: Suggestion, index: number, viaKeyboard = false): Promise<void> {
    const currentEditor = editor;
    if (!currentEditor) return;
    if (suggestion.anchorStatus === 'unanchored') {
      showNotice('Select the intended text and attach this Input before accepting a revision.');
      return;
    }
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
    const eventType = viaKeyboard ? 'accepted_via_keyboard' : 'accepted_via_tick';
    await workspace.resolveSuggestion(suggestion.id, 'accepted', eventType, { variantId: variant.id, replacement: variant.text });
    await workspace.supersedeSiblings(suggestion, variant.id);
    refreshLiveSuggestions();
  }

  async function reject(suggestion: Suggestion, viaDrag: boolean): Promise<void> {
    let resolution: Promise<void>;
    if (viaDrag) {
      resolution = workspace.resolveSuggestion(suggestion.id, 'rejected', 'dismissed_via_drag', { gestureDistance: 40 });
      if (undoDismiss) clearTimeout(undoDismiss.timer);
      const timer = setTimeout(() => { undoDismiss = null; }, 5000);
      undoDismiss = { suggestion, timer };
    } else resolution = workspace.resolveSuggestion(suggestion.id, 'rejected', 'rejected');
    refreshLiveSuggestions();
    await tick();
    await resolution;
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
    } else if (event.key === 'Enter') { event.preventDefault(); void accept(current, selectedVariants[current.id] ?? 0, true); }
    else if (event.key === 'x' || event.key === 'Escape') { event.preventDefault(); void reject(current, false); }
  }

  function beginInputDrag(id: string, event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
    inputDragCleanup?.();
    draggedInputId = id;
    inputDropTarget = null;
    const move = (moveEvent: PointerEvent) => {
      const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)?.closest<HTMLElement>('.card-slot');
      const targetId = target?.dataset.suggestionId;
      if (!target || !targetId || targetId === id) {
        inputDropTarget = null;
        return;
      }
      const bounds = target.getBoundingClientRect();
      inputDropTarget = { id: targetId, position: moveEvent.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' };
    };
    const finish = (commit: boolean) => {
      const target = inputDropTarget;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', pointerUp);
      window.removeEventListener('pointercancel', pointerCancel);
      inputDragCleanup = null;
      draggedInputId = null;
      inputDropTarget = null;
      if (commit && target) void workspace.moveInput(id, target.id, target.position).then(refreshLiveSuggestions);
    };
    const pointerUp = () => finish(true);
    const pointerCancel = () => finish(false);
    inputDragCleanup = () => finish(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerCancel);
  }

  async function moveInputOneStep(id: string, direction: -1 | 1): Promise<void> {
    await workspace.moveInputOneStep(id, direction);
    refreshLiveSuggestions();
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
    enqueueScheduledDocumentSave('Background save before switching document');
    editorReady = false;
    selection = { from: 1, to: 1, text: '' };
    await workspace.openNavigatorNode(id, navigation);
    refreshLiveSuggestions();
  }

  async function switchProject(id: string): Promise<void> {
    if (id === workspace.projectId) return;
    enqueueScheduledDocumentSave('Background save before switching project');
    editorReady = false;
    selection = { from: 1, to: 1, text: '' };
    await workspace.switchProject(id);
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

  function deleteProject(): void {
    const current = workspace.currentProject;
    if (!current || workspace.projects.length <= 1) return;
    projectDialogKind = 'delete';
    projectDialogValue = '';
  }

  function chooseProjectImport(): void {
    projectImportInput?.click();
  }

  async function inspectProjectImport(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    projectImportFile = file;
    projectImportPreview = null;
    projectImportOpen = true;
    projectImportPending = true;
    workspace.lastError = null;
    try {
      projectImportPreview = await workspace.inspectProjectImport(file);
    } catch (error) {
      projectImportOpen = false;
      projectImportFile = null;
      workspace.lastError = error instanceof Error ? `Project import failed: ${error.message}` : 'Project import failed.';
    } finally {
      projectImportPending = false;
    }
  }

  function closeProjectImport(): void {
    if (projectImportPending) return;
    projectImportOpen = false;
    projectImportFile = null;
    projectImportPreview = null;
  }

  async function confirmProjectImport(): Promise<void> {
    if (!projectImportFile || !projectImportPreview || projectImportPending) return;
    projectImportPending = true;
    workspace.lastError = null;
    try {
      enqueueScheduledDocumentSave('Background save before importing project');
      editorReady = false;
      selection = { from: 1, to: 1, text: '' };
      const preview = await workspace.importProject(projectImportFile);
      projectImportPending = false;
      closeProjectImport();
      refreshLiveSuggestions();
      showNotice(`${preview.title} imported as a new project.`);
    } catch (error) {
      workspace.lastError = error instanceof Error ? `Project import failed: ${error.message}` : 'Project import failed.';
    } finally {
      projectImportPending = false;
    }
  }

  async function submitProjectDialog(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const kind = projectDialogKind;
    const value = projectDialogValue.trim();
    const current = workspace.currentProject;
    if (!kind || projectDialogPending) return;
    projectDialogPending = true;
    workspace.lastError = null;
    try {
      if (kind === 'rename') {
        if (!value) return;
        await workspace.renameProject(value);
        projectDialogKind = null;
        showNotice(`Project renamed to ${value}.`);
        return;
      }
      if (kind === 'create') {
        if (!value) return;
        enqueueScheduledDocumentSave('Background save before creating project');
        editorReady = false;
        selection = { from: 1, to: 1, text: '' };
        await workspace.createProject(value);
        projectDialogKind = null;
        refreshLiveSuggestions();
        showNotice(`${value} created. Its Spine is open and ready.`);
        return;
      }
      if (!current || value !== current.title) return;
      if (documentSaveTimer) clearTimeout(documentSaveTimer);
      documentSaveTimer = null;
      editorReady = false;
      selection = { from: 1, to: 1, text: '' };
      if (kind === 'delete') await workspace.deleteCurrentProject();
      else await workspace.resetCurrentProject();
      projectDialogKind = null;
      refreshLiveSuggestions();
      showNotice(kind === 'delete' ? `${current.title} was permanently deleted.` : `${current.title} started over. Its new Spine is open.`);
    } catch (error) {
      workspace.lastError = error instanceof Error ? error.message : `Could not ${kind === 'reset' ? 'start over' : `${kind} project`}`;
    } finally {
      projectDialogPending = false;
    }
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

  async function exportProject(mode: ProjectExportMode = 'compact'): Promise<void> {
    if (projectExporting) return;
    if (mode === 'forensic' && !window.confirm('A forensic archive includes every autosave and audit revision. It may be hundreds of megabytes or fail in the browser. Continue?')) return;
    projectExporting = true;
    if (noticeTimer) clearTimeout(noticeTimer);
    noticeTimer = null;
    workspace.notice = mode === 'compact' ? 'Preparing compact project archive…' : 'Preparing forensic project archive…';
    try {
      const result = await workspace.exportProject(mode);
      const href = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = href;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
      showNotice(`Project exported as ${result.filename}.`);
    } catch (error) {
      workspace.notice = null;
      workspace.lastError = error instanceof Error ? `Project export failed: ${error.message}` : 'Project export failed.';
    } finally {
      projectExporting = false;
    }
  }

  function readableBytes(value: number): string {
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let unit = units[0];
    for (let index = 1; size >= 1024 && index < units.length; index += 1) {
      size /= 1024;
      unit = units[index];
    }
    return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
  }

  async function openStorageAnalysis(): Promise<void> {
    storageAnalysisOpen = true;
    storageAnalysisLoading = true;
    storageAnalysis = null;
    workspace.lastError = null;
    try {
      storageAnalysis = await workspace.storageAnalysis();
    } catch (error) {
      workspace.lastError = error instanceof Error ? `Storage report failed: ${error.message}` : 'Storage report failed.';
    } finally {
      storageAnalysisLoading = false;
    }
  }

</script>

{#snippet contextMaterialPicker(
  groups: AIContextMaterialGroup[],
  contextSelection: AIContextSelection,
  disabled: boolean,
  toggle: (sourceId: string) => void
)}
  <div class="context-picker">
    {#each groups as group (group.id)}
      <section class="context-picker-group">
        <header>
          <strong>{group.label}</strong>
          <span>{group.items.filter((item) => contextSelection.addedSourceIds.includes(item.id)).length}/{group.items.length}</span>
        </header>
        <div>
          {#each group.items as item (item.id)}
            <label title={workspace.navigatorNodeLabel(item)}>
              <input
                type="checkbox"
                checked={contextSelection.addedSourceIds.includes(item.id)}
                {disabled}
                onchange={() => toggle(item.id)}
              />
              <span>{workspace.navigatorNodeLabel(item)}</span>
            </label>
          {/each}
        </div>
      </section>
    {:else}
      <p>No other Material exists in this project.</p>
    {/each}
  </div>
{/snippet}

<svelte:head><title>Margin Note — writing support</title><meta name="description" content="A meta-first creative writing support workbench." /></svelte:head>

<input class="visually-hidden" bind:this={projectImportInput} type="file" accept=".mnote.zip,application/zip" aria-label="Import Margin Note project" onchange={inspectProjectImport} />

<div class="app-shell">
  <header class="topbar">
    <a class="brand" href="/" aria-label="Margin Note home"><span>¶</span><strong>Margin Note</strong><small>writing workbench</small></a>
    <div class="top-actions">
      <button class:paused={!reviewsEnabled} onclick={changeReviews} title={reviewsEnabled ? 'Pause automatic and document reviews' : 'Enable automatic and document reviews'}>{reviewsEnabled ? 'Ⅱ Pause Reviews' : '▶ Enable Reviews'}</button>
      <button class:paused={!actionsEnabled} onclick={changeActions} title={actionsEnabled ? 'Pause selection and document actions' : 'Enable selection and document actions'}>{actionsEnabled ? 'Ⅱ Pause Actions' : '▶ Enable Actions'}</button>
      <button onclick={openContext}>Context <span>{workspace.currentContext.length}</span></button>
      <a href="/review">Compare</a>
      <button onclick={() => { ledgerOpen = !ledgerOpen; void workspace.refreshLedger(); }}>Ledger</button>
      <button class="layout-toggle" class:active={navigatorVisible} aria-label={navigatorVisible ? 'Hide Navigator' : 'Show Navigator'} aria-pressed={navigatorVisible} title={navigatorVisible ? 'Hide Navigator' : 'Show Navigator'} onclick={toggleNavigatorPane}><span class="pane-icon pane-icon-left" aria-hidden="true"></span></button>
      <button class="layout-toggle" class:active={reviewPanelVisible} aria-label={reviewPanelVisible ? 'Hide Inputs panel' : 'Show Inputs panel'} aria-pressed={reviewPanelVisible} title={reviewPanelVisible ? 'Hide Inputs panel' : 'Show Inputs panel'} onclick={toggleReviewPanel}><span class="pane-icon pane-icon-right" aria-hidden="true"></span></button>
    </div>
  </header>

  <div class="workbench" class:navigator-hidden={!navigatorVisible} style={`--navigator-width:${navigatorWidth}px;--inputs-width:${inputsWidth}px`}>
    {#if navigatorVisible}
      <div class="navigator-pane"><Navigator onOpenNode={switchDocument} onSwitchProject={switchProject} onCreateProject={createProject} onRenameProject={renameProject} onResetProject={resetProject} onDeleteProject={deleteProject} onImportProject={chooseProjectImport} onExportProject={exportProject} onStorageAnalysis={openStorageAnalysis} {projectExporting} /></div>
      <button
        type="button"
        class="navigator-resizer"
        aria-label={`Resize Navigator, currently ${navigatorWidth} pixels wide`}
        title={`Drag to resize the Navigator between ${MIN_NAVIGATOR_WIDTH} and ${maxNavigatorWidth(viewportWidth)} pixels`}
        onpointerdown={startNavigatorResize}
        onkeydown={resizeNavigatorWithKeyboard}
      ><span aria-hidden="true"></span></button>
    {/if}
    <main>
    <section class="workspace" class:review-hidden={!reviewPanelVisible}>
      <div class="document-column">
        <header class="editor-pane-header">
          <div class="pane-identity">
            <small>{workspace.currentDocument ? workspace.navigatorNodeType(workspace.currentDocument) : 'Document'}</small>
            <strong>{workspace.currentDocument ? workspace.navigatorNodeLabel(workspace.currentDocument) : 'Opening…'}</strong>
          </div>
          <div class="pane-status">
            <span>{wordCount(currentDocumentText)} words</span>
            <span>v{workspace.currentDocument?.revision ?? 1}</span>
            <span class="save-status save-{documentSaveState}" aria-live="polite" title={documentSaveState === 'failed' ? 'A background save failed; the affected document remains in Svelte workspace state' : documentSaveState === 'saved' ? 'All changes saved' : `${unsavedDocumentCount} ${unsavedDocumentCount === 1 ? 'document is' : 'documents are'} saving in the background`}>
              <svg viewBox="0 0 30 20" aria-hidden="true">
                <path class="save-book" d="M2 4.5c4.2-1.5 8.2-.8 13 2v10c-4.8-2.8-8.8-3.5-13-2zM28 4.5c-4.2-1.5-8.2-.8-13 2v10c4.8-2.8 8.8-3.5 13-2z" />
                <g class="save-pen"><path d="M9 11.5l8.5-8.5 2 2-8.5 8.5-3 .9z" /><path d="M17.5 3l2 2" /></g>
              </svg>
              <span>{documentSaveState === 'failed' ? 'Save failed' : documentSaveState === 'saved' ? 'Saved' : `Saving${unsavedDocumentCount > 1 ? ` ${unsavedDocumentCount}` : ''}…`}</span>
            </span>
          </div>
          <div class="pane-actions">
            <div class="history-actions" aria-label="Writing undo and redo">
              <button disabled={!workspace.undoStack.length} title="Undo writing change" aria-label="Undo writing change" onclick={undoWorkspace}>↶</button>
              <button disabled={!workspace.redoStack.length} title="Redo writing change" aria-label="Redo writing change" onclick={redoWorkspace}>↷</button>
            </div>
            <div class="zoom-actions" aria-label="Editor zoom">
              <button disabled={editorZoom <= MIN_EDITOR_ZOOM} title="Zoom out" aria-label="Zoom out" onclick={() => setEditorZoom(editorZoom - 10)}>−</button>
              <button title="Reset editor zoom" aria-label={`Reset editor zoom, currently ${editorZoom}%`} onclick={() => setEditorZoom(DEFAULT_EDITOR_ZOOM)}>{editorZoom}%</button>
              <button disabled={editorZoom >= MAX_EDITOR_ZOOM} title="Zoom in" aria-label="Zoom in" onclick={() => setEditorZoom(editorZoom + 10)}>+</button>
            </div>
            <details class="pane-menu">
              <summary aria-label="Document actions" title="Document actions">•••</summary>
              <div>
                {#if workspace.currentDocument && !['spine', 'todos'].includes(workspace.currentDocument.role ?? '')}<button type="button" onclick={renameDocument}>Rename document</button>{/if}
                <button type="button" onclick={forkBranch}>Fork from here</button>
                <button type="button" onclick={strikeWork}>{workspace.workHasStrikethrough ? 'Remove work strikethrough' : 'Strike work'}</button>
                <button type="button" onclick={exportMarkdown}>Export Markdown</button>
              </div>
            </details>
          </div>
        </header>

        <div class="editor-wrap">
          {#if !workspaceReady || !workspace.currentDocument}
            <div class="editor-loading">Opening workspace…</div>
          {:else}
            {#key workspace.branchId}
              <EditorShell
                bind:this={editor}
                branchId={workspace.branchId}
                initialContent={workspace.currentDocument.content}
                initialDocument={workspace.richDocument}
                zoomPercent={editorZoom}
                suggestions={liveSuggestions}
                formats={workspace.formats}
                attachmentRevision={workspace.workspaceRevision}
                activeSuggestionId={workspace.activeSuggestionId}
                preview={workspace.preview}
                onTextChange={textChanged}
                onEditorReady={(snapshot) => workspace.setEditorReady(snapshot)}
                onAssetUpload={(file) => workspace.uploadAsset(file)}
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

          {#if selection.text}
            <div class="selection-menu">
              <span>{selection.text.split(/\s+/).length}w selected</span>
              {#if workspace.actionsEnabled}
                {#if revisionSuggestion}
                  <button class="contextual-revision" type="button" onmousedown={preventDefault} onclick={() => suggestNoteRevisions(revisionSuggestion!)}>Suggest more for {categoryMeta[revisionSuggestion.category].label}</button>
                {/if}
                <button class="contextual-revision" type="button" onmousedown={preventDefault} onclick={() => openActionRunner('selection')}>Perform action…</button>
                <button type="button" onmousedown={preventDefault} onclick={() => runSelection('heighten')}>Heighten</button>
                <button type="button" onmousedown={preventDefault} onclick={() => runSelection('cadence')}>Vary cadence</button>
                <button type="button" onmousedown={preventDefault} onclick={() => runSelection('distance')}>More distant</button>
                <button type="button" onmousedown={preventDefault} onclick={() => runSelection('synonyms')}>Synonyms</button>
              {/if}
              <button type="button" onmousedown={preventDefault} onclick={strikeSelection}>{workspace.selectionHasStrikethrough(selection.from, selection.to) ? 'Remove strikethrough' : 'Strikethrough'}</button>
              {#if workspace.actionsEnabled}
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
              {/if}
            </div>
          {/if}
        </div>

      </div>

        {#if reviewPanelVisible}
          <button
            type="button"
            class="inputs-resizer"
            aria-label={`Resize Inputs panel, currently ${inputsWidth} pixels wide`}
            title={`Drag to resize Inputs between ${MIN_INPUTS_WIDTH} and ${maxInputsWidth(viewportWidth)} pixels`}
            onpointerdown={startInputsResize}
            onkeydown={resizeInputsWithKeyboard}
          ><span aria-hidden="true"></span></button>
          <aside class="inputs-panel">
          <header class="inputs-panel-header">
            <div class="inputs-heading">
              <div><span>Inputs</span><strong>{liveSuggestions.length} shown</strong></div>
              <small>
                {pendingInputCount} pending
                {#if inputsHiddenByFilters} · {inputsHiddenByFilters} hidden by filters{/if}
                {#if duplicateInputsCombined} · {duplicateInputsCombined} similar combined{/if}
                {#if inputsBeyondLimit} · {inputsBeyondLimit} beyond display limit{/if}
              </small>
            </div>
            <div class="inputs-header-actions">
              <div class="inputs-management-actions">
                <span>Manage</span>
                <button
                  type="button"
                  class:active={inputControlsOpen}
                  aria-expanded={inputControlsOpen}
                  onclick={() => inputControlsOpen = !inputControlsOpen}
                >Filters{hiddenInputFilterCount ? ` ${hiddenInputFilterCount}` : ''}</button>
                <button type="button" aria-label="Manage actions" title="Manage project AI actions" onclick={() => actionManagerOpen = true}>Actions</button>
              </div>
              <div class="inputs-execution-actions">
                <span>Perform</span>
                <button type="button" aria-label="Perform action…" title={!workspace.actionsEnabled ? 'Enable Actions to perform an action' : !enabledRunSourceCount ? 'Enable at least one configured AI provider to perform an action' : selection.text.trim() ? 'Perform a project action on the current selection' : 'Perform a project action on the current document'} disabled={workspace.actionsGenerating || !workspace.actionsEnabled || !enabledRunSourceCount} onclick={() => openActionRunner(selection.text.trim() ? 'selection' : 'document')}>Action…</button>
                <button
                  type="button"
                  class="review-document"
                  aria-label="Review document"
                  disabled={workspace.reviewsGenerating || !workspace.reviewsEnabled || !enabledRunSourceCount}
                  onclick={openReviewPreflight}
                >{workspace.reviewsGenerating ? 'Reviewing…' : 'Document review'}</button>
              </div>
            </div>
          </header>

          {#if contextPreflightOpen && reviewContextManifest}
            <section class="context-preflight" aria-label="Writing Context preflight">
              <header><div><strong>Writing Context</strong><small>Review document preflight</small></div><span>{contextPreflightLocked ? 'Locked while running' : 'Check before sending'}</span></header>
              <label class="review-instructions"><b>Review Instructions</b><textarea rows="4" disabled={contextPreflightLocked} bind:value={sentinelInstruction}></textarea><small>Tell the selected reviewers what to examine in this run.</small></label>
              <div class="context-required">
                <b>Always included</b>
                {#each reviewContextManifest.items.filter((item) => item.inclusion === 'required' && item.sourceType !== 'action') as item}
                  <button type="button" disabled={contextPreflightLocked} onclick={() => void openContextSource(item.sourceId)}><span>🔒 {item.title}</span><small>{item.sourceRevision ? `v${item.sourceRevision}` : 'current'} · open source</small></button>
                {/each}
              </div>
              <div class="context-options">
                <b>Include applicable context</b>
                <label><input type="checkbox" checked={reviewContextSelection.includeMaterial} disabled={contextPreflightLocked} onchange={(event) => reviewContextSelection = { ...reviewContextSelection, includeMaterial: event.currentTarget.checked }} />Material</label>
                <label><input type="checkbox" checked={reviewContextSelection.includeRelationships} disabled={contextPreflightLocked} onchange={(event) => reviewContextSelection = { ...reviewContextSelection, includeRelationships: event.currentTarget.checked }} />Relationships</label>
                <label><input type="checkbox" checked={reviewContextSelection.includeTodos} disabled={contextPreflightLocked} onchange={(event) => reviewContextSelection = { ...reviewContextSelection, includeTodos: event.currentTarget.checked }} />Open Todos</label>
              </div>
              <button class="add-context" type="button" disabled={contextPreflightLocked} aria-expanded={contextPickerOpen} onclick={() => contextPickerOpen = !contextPickerOpen}>+ Add context…</button>
              {#if contextPickerOpen}
                {@render contextMaterialPicker(reviewContextMaterialGroups, reviewContextSelection, contextPreflightLocked, toggleAddedContext)}
              {/if}
              <div class="context-manifest-summary">
                <span>{reviewContextManifest.items.filter((item) => item.sent).length} included</span>
                <span>{reviewContextManifest.items.filter((item) => !item.sent).length} omitted</span>
                <span>0 trimmed</span>
              </div>
              {#if contextPreflightTargetId !== workspace.branchId}<p class="context-warning">Return to the original review document before running.</p>{/if}
              <footer><button type="button" disabled={contextPreflightLocked} onclick={() => contextPreflightOpen = false}>Cancel</button><button type="button" class="primary" disabled={contextPreflightLocked || !sentinelInstruction.trim() || contextPreflightTargetId !== workspace.branchId} onclick={() => void runReviewFromPreflight()}>{contextPreflightLocked ? 'Reviewing…' : 'Start review'}</button></footer>
            </section>
          {/if}

          {#if latestCraftActivity}
            <section class={`craft-activity activity-${latestCraftActivity.state}`} aria-live="polite">
              <header>
                <strong>{latestCraftActivity.scope === 'document' ? 'Document review' : 'Selection revision'}</strong>
                <span>{activityLabels[latestCraftActivity.state]}</span>
              </header>
              <p>
                {latestCraftActivity.completedCount}/{latestCraftActivity.requestCount} checks complete
                · {latestCraftActivity.proposalCount} {latestCraftActivity.proposalCount === 1 ? 'input' : 'inputs'} generated
                {#if latestCraftActivity.runningCount} · {latestCraftActivity.runningCount} running{/if}
              </p>
              {#if latestCraftActivity.firstError}<small>{latestCraftActivity.firstError}</small>{/if}
              {#if interruptedRuns.length}
                <div class="interrupted-actions">
                  <button type="button" disabled={workspace.reviewsGenerating} onclick={() => void retryInterrupted()}>Retry {interruptedRuns.length} interrupted {interruptedRuns.length === 1 ? 'passage' : 'passages'}</button>
                  <button type="button" disabled={workspace.reviewsGenerating} onclick={() => void completeInterrupted()}>Complete without {interruptedRuns.length === 1 ? 'it' : 'them'}</button>
                </div>
              {/if}
            </section>
          {/if}

          {#if inputControlsOpen}
            <section class="inputs-controls" aria-label="Input controls">
              <div class="control-group">
                <header><strong>Show categories</strong><small>Existing Inputs</small></header>
                <div class="category-controls">
                  {#each categories as category}
                    <button
                      type="button"
                      class:off={!workspace.categoryVisibility[category]}
                      aria-pressed={workspace.categoryVisibility[category]}
                      onclick={() => changeCategory(category)}
                    ><i>{categoryMeta[category].icon}</i>{categoryMeta[category].label}</button>
                  {/each}
                </div>
                <label class="density-control">Cards shown at once
                  <input type="range" min="1" max={Math.max(20, displayableInputCount)} bind:value={workspace.densityCap} oninput={refreshLiveSuggestions} />
                  <output>{workspace.densityCap}</output>
                </label>
              </div>

              <div class="control-group">
                <header><strong>Sources</strong><small>Future reviews / existing Inputs</small></header>
                <p class="control-explanation"><b>Use</b> chooses sources for future reviews; it does not start one. <b>Show</b> only filters Inputs already returned.</p>
                <div class="source-controls">
                  {#each providerSettings.sources as source}
                    {@const availability = providerSettings.sourceAvailability[source.id]}
                    <div class="source-row">
                      <div><b>A{source.number}</b><span>{source.label}</span>{#if availability?.model}<small>{availability.model}</small>{/if}</div>
                      <button
                        type="button"
                        class:active={workspace.sourceStates[source.id] !== 'off'}
                        aria-pressed={workspace.sourceStates[source.id] !== 'off'}
                        disabled={availability?.available !== true}
                        title={availability?.available === true ? 'Include this source in future reviews' : availability?.reason ?? 'Source is not configured'}
                        onclick={() => toggleRunSource(source.id)}
                      >Use</button>
                      <button
                        type="button"
                        class:active={workspace.inputSourceVisibility[source.id] !== false}
                        aria-pressed={workspace.inputSourceVisibility[source.id] !== false}
                        title="Show or hide existing Inputs from this source"
                        onclick={() => toggleInputSource(source.id)}
                      >Show</button>
                      {#if availability?.protocol}
                        <button class="configure-source" type="button" onclick={() => providerSettings.openProviders(source.id)}>Edit</button>
                      {/if}
                    </div>
                  {/each}
                </div>
                <button class="add-provider" type="button" onclick={() => providerSettings.openProviders()}>Add provider…</button>
              </div>
            </section>
          {/if}

          <div
            class="cards"
            role="list"
            bind:this={cardsElement}
          >
            {#if !liveSuggestions.length}
              <div class="empty-notes"><span>✓</span><p>No visible Inputs.</p><small>Review the current document or change the Input filters.</small></div>
            {/if}
            {#each liveSuggestions as suggestion}
              <div
                class="card-slot"
                class:dragging={draggedInputId === suggestion.id}
                class:drop-before={inputDropTarget?.id === suggestion.id && inputDropTarget.position === 'before'}
                class:drop-after={inputDropTarget?.id === suggestion.id && inputDropTarget.position === 'after'}
                role="listitem"
                data-suggestion-id={suggestion.id}
              >
                <SuggestionCard
                  {suggestion}
                  label={inputCardLabel(suggestion)}
                  active={workspace.activeSuggestionId === suggestion.id}
                  selectedVariant={selectedVariants[suggestion.id] ?? 0}
                  revisionBusy={revisionBusyInputId === suggestion.id}
                  revisionAvailable={hasRevisionProvider}
                  canBindSelection={Boolean(selection.text.trim())}
                  onActivate={() => void activateCard(suggestion.id)}
                  onSelectVariant={(index) => chooseVariant(suggestion.id, index)}
                  onAccept={(index) => accept(suggestion, index)}
                  onReject={(viaDrag) => reject(suggestion, viaDrag)}
                  onPreview={(text) => text === null ? workspace.clearPreview() : workspace.setPreview(suggestion.id, text)}
                  onSuggestRevision={() => void startSuggestionRevision(suggestion)}
                  onBindSelection={() => void bindInputToSelection(suggestion)}
                  onSourceHover={() => workspace.log('source_tooltip_hovered', { source: suggestion.source, sourceNumber: suggestion.sourceNumber }, suggestion.id)}
                  onMove={(direction) => void moveInputOneStep(suggestion.id, direction)}
                  onOrderPointerDown={(event) => beginInputDrag(suggestion.id, event)}
                />
              </div>
            {/each}
          </div>
          {#if inputsBeyondLimit}
            <div class="display-limit-actions">
              <span>{inputsBeyondLimit} more visible Inputs are ready.</span>
              <button type="button" onclick={showMoreInputs}>Show next {Math.min(8, inputsBeyondLimit)}</button>
              <button type="button" onclick={showAllInputs}>Show all {displayableInputCount}</button>
            </div>
          {/if}
          {#if liveSuggestions.length}<p class="key-help">Card keys: <kbd>Tab</kbd> next · <kbd>1–3</kbd> variant · <kbd>Enter</kbd> accept · <kbd>X</kbd> reject</p>{/if}
          <footer class="inputs-panel-footer">
            <div>
              <strong>≈${workspace.costUsd.toFixed(4)}</strong><span>tracked provider spend</span>
              <small>{(workspace.codexTokens / 1_000_000).toFixed(3)}M Codex tokens</small>
              <small>{providerSettings.sources.filter((source) => source.number >= 3).length} configured provider {providerSettings.sources.filter((source) => source.number >= 3).length === 1 ? 'profile' : 'profiles'}</small>
            </div>
            <button type="button" onclick={() => providerSettings.openProviders()}>Providers</button>
            <button type="button" onclick={() => runManagerOpen = true}>Runs</button>
            <button type="button" onclick={openInputs}>History</button>
          </footer>
        </aside>{/if}
    </section>

    {#if ledgerOpen}<div class="ledger-panel"><LedgerTail events={workspace.ledger} costUsd={workspace.costUsd} codexTokens={workspace.codexTokens} /></div>{/if}
    </main>
  </div>

  {#if !reviewsEnabled || !actionsEnabled}
    <div class="pause-banner">
      {#if !reviewsEnabled && !actionsEnabled}
        <b>Reviews and Actions paused</b> — automatic reviews and requested AI actions are suspended. Writing remains available.
      {:else if !reviewsEnabled}
        <b>Reviews paused</b> — automatic and document reviews are suspended. Actions and writing remain available.
      {:else}
        <b>Actions paused</b> — selection and document actions are suspended. Reviews and writing remain available.
      {/if}
    </div>
  {/if}
  {#if providerConfigurationIssue}
    <section class="provider-alert" role="alert" aria-live="assertive">
      <div>
        <strong>Provider needs attention</strong>
        <span>{providerSettings.sourceAvailability[providerConfigurationIssue.sourceId]?.name ?? providerConfigurationIssue.sourceId} · {providerSettings.sourceAvailability[providerConfigurationIssue.sourceId]?.model ?? 'model not reported'}</span>
        <p>{providerConfigurationIssue.error.classification === 'authentication' ? 'The API key was rejected or is missing.' : providerConfigurationIssue.error.message}</p>
      </div>
      <button type="button" class="primary" onclick={fixProviderIssue}>Fix provider</button>
      <button type="button" onclick={() => dismissedProviderIssueKey = providerConfigurationIssue?.key ?? null}>Dismiss</button>
    </section>
  {/if}
  {#if aiWaitLabel && !aiWaitDismissed}
    <section class="ai-wait-indicator" role="status" aria-live="polite">
      <svg viewBox="0 0 30 20" aria-hidden="true">
        <path class="save-book" d="M2 4.5c4.2-1.5 8.2-.8 13 2v10c-4.8-2.8-8.8-3.5-13-2zM28 4.5c-4.2-1.5-8.2-.8-13 2v10c4.8-2.8 8.8-3.5 13-2z" />
        <g class="save-pen"><path d="M9 11.5l8.5-8.5 2 2-8.5 8.5-3 .9z" /><path d="M17.5 3l2 2" /></g>
      </svg>
      <div><strong>{aiWaitLabel}</strong><span>You can continue writing while this runs.</span></div>
      <button type="button" aria-label="Hide AI activity; the work will continue" title="Hide; work continues" onclick={() => aiWaitDismissed = true}>×</button>
    </section>
  {/if}
  {#if workspace.notice}<button class="notice" onclick={dismissNotice}>{workspace.notice}<span>×</span></button>{/if}
  {#if workspace.lastError}<button class="error" onclick={() => workspace.lastError = null}>{workspace.lastError}<span>×</span></button>{/if}
  {#if undoDismiss}<div class="undo-toast"><span>Suggestion dismissed</span><button onclick={undoDragDismiss}>Undo</button></div>{/if}

  {#if actionRunnerOpen && selectedAction}
    <div class="modal-backdrop" role="presentation" onclick={() => { if (!actionRunnerLocked) actionRunnerOpen = false; }}>
      <div class="settings action-runner" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="action-runner-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>Project AI action</small><h2 id="action-runner-title">Perform action</h2></div><button type="button" disabled={actionRunnerLocked} onclick={() => actionRunnerOpen = false}>×</button></header>
        <label>Action<select value={selectedAction.id} disabled={actionRunnerLocked} onchange={(event) => chooseAction(event.currentTarget.value)}>{#each workspace.actions as action}<option value={action.id}>{action.name}</option>{/each}</select></label>
        <p class="provider-intro"><strong>{selectedAction.description || selectedAction.name}</strong><br />{selectedAction.instruction}</p>
        <fieldset class="action-targets"><legend>Target — choose carefully</legend>{#if selectedAction.allowedTargets.includes('selection')}<label><input type="radio" name="action-target" value="selection" checked={actionRunnerScope === 'selection'} disabled={actionRunnerLocked || !selection.text.trim()} onchange={() => changeActionScope('selection')} />Selection only{actionRunnerRange ? ` · ${actionRunnerRange.text.trim().split(/\s+/).length} words` : ''}</label>{/if}{#if selectedAction.allowedTargets.includes('document')}<label><input type="radio" name="action-target" value="document" checked={actionRunnerScope === 'document'} disabled={actionRunnerLocked || selectedAction.requiresSelection} onchange={() => changeActionScope('document')} />Entire current document</label>{/if}</fieldset>
        <p class="action-target-summary">{actionRunnerScope === 'document' ? `This run will inspect the entire current document (${currentDocumentText.trim() ? currentDocumentText.trim().split(/\s+/).length : 0} words).` : `This run will inspect only the captured ${actionRunnerRange?.text.trim().split(/\s+/).length ?? 0}-word selection.`}</p>
        <div class="action-contract"><span>Response</span><strong>{selectedAction.responseContract.replaceAll('_', ' ')}</strong><span>Maximum</span><strong>{selectedAction.maxOutputTokens.toLocaleString()} tokens</strong></div>
        {#if actionContextManifest}
          <section class="context-preflight embedded" aria-label="Action Writing Context">
            <header><div><strong>Writing Context</strong><small>Target plus explicitly included read-only context</small></div><span>{actionRunnerLocked ? 'Locked while running' : 'Check before sending'}</span></header>
            <div class="context-required"><b>Always included</b>{#each actionContextManifest.items.filter((item) => item.inclusion === 'required' && item.sourceType !== 'action') as item}<div class="required-context-row"><span>🔒 {item.title}</span><small>v{item.sourceRevision}</small></div>{/each}</div>
            <div class="context-options"><b>Include applicable context</b><label><input type="checkbox" bind:checked={actionRunnerContext.includeMaterial} disabled={actionRunnerLocked} />Material</label><label><input type="checkbox" bind:checked={actionRunnerContext.includeRelationships} disabled={actionRunnerLocked} />Relationships</label><label><input type="checkbox" bind:checked={actionRunnerContext.includeTodos} disabled={actionRunnerLocked} />Open Todos</label></div>
            <button class="add-context" type="button" disabled={actionRunnerLocked} aria-expanded={actionContextPickerOpen} onclick={() => actionContextPickerOpen = !actionContextPickerOpen}>+ Add context…</button>
            {#if actionContextPickerOpen}{@render contextMaterialPicker(actionContextMaterialGroups, actionRunnerContext, actionRunnerLocked, toggleActionContext)}{/if}
            <div class="context-manifest-summary"><span>{actionContextManifest.items.filter((item) => item.sent).length} included</span><span>{actionContextManifest.items.filter((item) => !item.sent).length} omitted</span></div>
          </section>
        {:else}<p class="reset-warning">The selected target is empty or no longer matches the editor.</p>{/if}
        <footer><p>Only the target can receive a proposed change. Included Material, relationships and Todos are read-only.</p><button type="button" disabled={actionRunnerLocked} onclick={() => actionRunnerOpen = false}>Cancel</button><button type="button" class="primary" disabled={actionRunnerLocked || !actionContextManifest} onclick={() => void runConfiguredAction()}>{actionRunnerLocked ? 'Running…' : `Run ${selectedAction.name} on ${actionRunnerScope === 'document' ? 'entire document' : 'selection only'}`}</button></footer>
      </div>
    </div>
  {/if}

  {#if actionManagerOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => actionManagerOpen = false}>
      <AIActionManager
        actions={workspace.actions}
        providers={providerSettings.sources.filter((source) => source.number >= 3).map((source) => ({ id: source.id, label: providerSettings.sourceAvailability[source.id]?.name ?? source.label, model: providerSettings.sourceAvailability[source.id]?.model, available: providerSettings.sourceAvailability[source.id]?.available === true }))}
        onSave={saveAction}
        onDelete={deleteAction}
        onRun={(id) => {
          const action = workspace.actions.find((item) => item.id === id);
          if (!action) return;
          actionManagerOpen = false;
          const scope = action.defaultTarget === 'selection' && selection.text.trim() && action.allowedTargets.includes('selection')
            ? 'selection'
            : action.allowedTargets.includes('document') && !action.requiresSelection
              ? 'document'
              : 'selection';
          openActionRunner(scope, id);
        }}
        onClose={() => actionManagerOpen = false}
      />
    </div>
  {/if}

  {#if providerSettings.providerDialogOpen}
    <div class="modal-backdrop" role="presentation">
      <div class="settings provider-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="provider-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>AI provider profiles</small><h2 id="provider-title">Providers</h2></div><button onclick={() => providerSettings.closeProviders()}>×</button></header>
        {#if providerSettings.sources.some((source) => source.number >= 3)}
          <div class="provider-list">
            {#each providerSettings.sources.filter((source) => source.number >= 3) as source}
              {@const configured = providerSettings.sourceAvailability[source.id]}
              {@const health = summarizeProviderHealth(workspace.runs, source.id)}
              <article>
                <div><strong>{configured.name ?? source.label}</strong><span>{configured.model}</span><small>{configured.protocol?.replace('_', ' ')} · {configured.credentialHint ?? 'no key'} · {health.state.replaceAll('_', ' ')}</small></div>
                <button type="button" onclick={() => providerSettings.openProviders(source.id)}>Edit</button>
                {#if configured.configurable}<button type="button" class="danger" onclick={() => void deleteProvider(source.id)}>Remove</button>{/if}
              </article>
            {/each}
          </div>
        {/if}
        <div class="provider-presets" aria-label="Provider service">
          <span>Provider service:</span>
          <button type="button" class:active={activeProviderPreset === 'openrouter'} aria-pressed={activeProviderPreset === 'openrouter'} onclick={() => providerSettings.usePreset('openrouter')}>OpenRouter</button>
          <button type="button" class:active={activeProviderPreset === 'openai'} aria-pressed={activeProviderPreset === 'openai'} onclick={() => providerSettings.usePreset('openai')}>OpenAI</button>
          <button type="button" class:active={activeProviderPreset === 'anthropic'} aria-pressed={activeProviderPreset === 'anthropic'} onclick={() => providerSettings.usePreset('anthropic')}>Anthropic</button>
          <button type="button" class:active={activeProviderPreset === 'ollama'} aria-pressed={activeProviderPreset === 'ollama'} onclick={() => providerSettings.usePreset('ollama')}>Ollama/local</button>
          <button type="button" class:active={activeProviderPreset === 'codex'} aria-pressed={activeProviderPreset === 'codex'} onclick={() => providerSettings.usePreset('codex')}>Codex / ChatGPT</button>
          {#if !activeProviderPreset}<small>Custom endpoint</small>{/if}
        </div>
        <form onsubmit={saveProvider}>
          <p class="provider-intro">Provider profiles are saved in the local server's ignored settings file. API keys stay there; Codex uses the local Codex app-server's ChatGPT session instead. Neither is written to the project, browser storage, run history, or event ledger.</p>
          <input name="provider-id" type="hidden" value={providerSettings.providerForm.id} />
          <div class="form-grid">
            <label>Profile name<input name="provider-name" required value={providerSettings.providerForm.name} oninput={(event) => providerSettings.setProviderField('name', event.currentTarget.value)} /></label>
            {#if activeProviderPreset === 'codex'}
              <label>Protocol<input value="Codex app-server (ChatGPT)" disabled /><input name="provider-protocol" type="hidden" value="codex_app_server" /></label>
            {:else}
              <label>Protocol<select name="provider-protocol" value={providerSettings.providerForm.protocol} onchange={(event) => providerSettings.setProviderField('protocol', event.currentTarget.value as ProviderProtocol)}><option value="openai_compatible">OpenAI compatible</option><option value="anthropic">Anthropic Messages</option><option value="codex_app_server">Codex app-server</option></select></label>
            {/if}
          </div>
          {#if activeProviderPreset === 'codex'}
            <input name="provider-base-url" type="hidden" value="local://codex-app-server" />
            <input name="provider-key" type="hidden" value="" />
            <section class="codex-connection" class:connected={providerSettings.codexStatus?.connected}>
              <div>
                <strong>{providerSettings.codexStatus?.connected ? 'ChatGPT connected' : providerSettings.checkingCodex ? 'Checking Codex…' : 'ChatGPT connection'}</strong>
                <small>{providerSettings.codexStatus?.connected
                  ? [providerSettings.codexStatus.email, providerSettings.codexStatus.planType].filter(Boolean).join(' · ') || 'Local Codex session'
                  : providerSettings.codexStatus?.reason ?? 'Uses your local Codex sign-in; no API key is stored by Margin Note.'}</small>
              </div>
              {#if !providerSettings.codexStatus?.connected}<button type="button" onclick={() => void startCodexLogin()} disabled={providerSettings.checkingCodex}>Sign in with ChatGPT</button>{/if}
              <button type="button" onclick={() => void refreshCodexStatus()} disabled={providerSettings.checkingCodex}>Refresh</button>
              {#if providerSettings.codexLoginUrl}<a href={providerSettings.codexLoginUrl} target="_blank" rel="noreferrer">Continue sign-in</a>{/if}
            </section>
          {:else}
            <label>Base URL<input name="provider-base-url" required value={providerSettings.providerForm.baseUrl} oninput={(event) => providerSettings.setProviderField('baseUrl', event.currentTarget.value)} /></label>
            <label>API key {#if editingProviderAvailability?.credentialHint}<small>Saved as {editingProviderAvailability.credentialHint}; leave blank to keep it</small>{:else if activeProviderPreset === 'openrouter'}<small>Use an OpenRouter key, normally beginning sk-or-</small>{:else if activeProviderPreset === 'openai'}<small>Use an OpenAI project key</small>{:else if activeProviderPreset === 'anthropic'}<small>Use an Anthropic API key</small>{/if}<input name="provider-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder={editingProviderAvailability?.credentialHint ?? 'Provider API key; optional for localhost'} /></label>
          {/if}
          <label>Model ID<small>{activeProviderPreset === 'openrouter' ? 'Use the complete namespaced ID, for example openai/gpt-5.6-terra' : 'Exact model identifier accepted by this provider'}</small><input name="provider-model" required value={providerSettings.providerForm.model} oninput={(event) => providerSettings.setProviderField('model', event.currentTarget.value)} /></label>
          {#if providerSettings.error}<p class="provider-error" role="alert">{providerSettings.error}</p>{/if}
          <footer><p>Saving a profile enables it for the next request; <b>Use</b> can turn participation off independently.</p><button type="button" onclick={() => providerSettings.closeProviders()}>Close</button><button type="submit" value="add-another" disabled={providerSettings.savingProvider}>Save and add another</button><button type="submit" class="primary" value="close" disabled={providerSettings.savingProvider}>{providerSettings.savingProvider ? 'Saving…' : 'Save provider'}</button></footer>
        </form>
      </div>
    </div>
  {/if}

  {#if runManagerOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => runManagerOpen = false}>
      <div class="settings run-manager" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="run-manager-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>Recovery and diagnostics</small><h2 id="run-manager-title">AI runs</h2></div><button onclick={() => runManagerOpen = false}>×</button></header>
        <p class="provider-intro">Runs retain the captured action, Writing Context, provider attempts, recovery decisions, and final outcome. Retry creates a new run against the current unchanged target and current provider configuration.</p>
        <div class="run-list">
          {#each [...workspace.runs].reverse().slice(0, 50) as run}
            {@const participatingSources = providerSettings.sources
              .filter((source) => run.sourceStates[source.id] && run.sourceStates[source.id] !== 'off')
              .map((source) => providerSettings.sourceAvailability[source.id]?.name ?? source.label)
              .join(', ')}
            <article class={`run-${run.state}`}>
              <header><div><strong>{run.promptId}</strong><span>{run.scope ?? 'selection'} · {run.originalText.length} characters</span></div><b>{run.state}</b></header>
              <p>{new Date(run.createdAt).toLocaleString()} · {participatingSources || 'No recorded sources'} · {run.proposalIds.length} Inputs · {workspace.runContextManifest(run)?.items.filter((item) => item.sent).length ?? 0} context items</p>
              {#each run.errors as error}
                <div class="run-diagnostic"><b>{error.source}</b><span>{error.classification?.replaceAll('_', ' ') ?? error.kind ?? 'error'}{#if error.attempt} · attempt {error.attempt}/{error.maxAttempts ?? error.attempt}{/if}{#if error.recovered} · recovered{/if}</span><small>{error.message}</small></div>
              {/each}
              {#if workspace.canRecoverRun(run.id)}<button type="button" onclick={() => void recoverFailedRun(run.id)}>Recover retained responses</button>{/if}
              {#if run.request && (run.state === 'failed' || run.state === 'partial') && run.errors.some((error) => !error.recovered && providerSettings.sourceAvailability[error.source]?.available)}<button type="button" onclick={() => void retryFailedRun(run.id)}>Retry failed providers</button>{/if}
              {#if run.errors.some((error) => error.classification === 'interrupted' && !error.recovered)}<button type="button" onclick={() => void workspace.completeInterruptedRun(run.id)}>Complete without this passage</button>{/if}
            </article>
          {:else}
            <p class="input-empty">No AI runs have been recorded for this document.</p>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if projectDialogKind}
    <div class="modal-backdrop" role="presentation" onclick={() => { if (!projectDialogPending) projectDialogKind = null; }}>
      <div class="settings project-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="project-dialog-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <form onsubmit={submitProjectDialog}>
          <header><div><small>Project</small><h2 id="project-dialog-title">{projectDialogKind === 'create' ? 'Create project' : projectDialogKind === 'rename' ? 'Rename project' : projectDialogKind === 'delete' ? 'Delete project' : 'Start over'}</h2></div><button type="button" disabled={projectDialogPending} onclick={() => projectDialogKind = null}>×</button></header>
          {#if projectDialogKind === 'reset' || projectDialogKind === 'delete'}
            <p class="reset-warning">{projectDialogKind === 'delete' ? 'This permanently removes the complete project, including documents, revisions, Collections, Todos, Inputs, context, assets, ledger records, and this browser’s recovery mirrors. Export it first if it may be needed again.' : 'This permanently removes the current project’s documents, Collections, Todo records and content, Inputs, formats, and context. The project will restart with empty Spine and Todos documents.'}</p>
            <label>Type <strong>{workspace.currentProject?.title}</strong> to confirm<input aria-label="Project name confirmation" autocomplete="off" bind:value={projectDialogValue} /></label>
          {:else}
            <label>Project name<input aria-label="Project name" autocomplete="off" bind:value={projectDialogValue} /></label>
          {/if}
          <footer><p>{projectDialogPending ? 'Updating the project…' : projectDialogKind === 'reset' || projectDialogKind === 'delete' ? 'This cannot be undone.' : 'The project name is separate from its fixed Spine and Todos.'}</p><button type="button" disabled={projectDialogPending} onclick={() => projectDialogKind = null}>Cancel</button><button class:danger={projectDialogKind === 'reset' || projectDialogKind === 'delete'} class="primary" disabled={projectDialogPending || !projectDialogValue.trim() || ((projectDialogKind === 'reset' || projectDialogKind === 'delete') && projectDialogValue.trim() !== workspace.currentProject?.title)}>{projectDialogPending ? projectDialogKind === 'reset' ? 'Starting over…' : projectDialogKind === 'delete' ? 'Deleting…' : projectDialogKind === 'rename' ? 'Renaming…' : 'Creating…' : projectDialogKind === 'reset' ? 'Start over' : projectDialogKind === 'delete' ? 'Delete project' : projectDialogKind === 'rename' ? 'Rename' : 'Create'}</button></footer>
        </form>
      </div>
    </div>
  {/if}

  {#if projectImportOpen}
    <div class="modal-backdrop" role="presentation" onclick={closeProjectImport}>
      <div class="settings project-import-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="project-import-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>Native project archive</small><h2 id="project-import-title">Import project</h2></div><button type="button" disabled={projectImportPending} onclick={closeProjectImport}>×</button></header>
        {#if projectImportPending && !projectImportPreview}
          <p class="storage-loading">Validating the archive without changing the workspace…</p>
        {:else if projectImportPreview}
          <p class="provider-intro"><strong>{projectImportPreview.title}</strong> will be created as a new project. Existing projects will not be replaced or merged.</p>
          <div class="storage-summary">
            <div><small>Documents</small><strong>{projectImportPreview.documents}</strong></div>
            <div><small>Context items</small><strong>{projectImportPreview.contextBuckets}</strong></div>
            <div><small>Assets</small><strong>{projectImportPreview.assets}</strong></div>
            <div><small>Archive</small><strong>{readableBytes(projectImportPreview.archiveBytes)}</strong></div>
          </div>
          {#if projectImportPreview.warnings.length}
            <div class="import-warnings" role="note">
              {#each projectImportPreview.warnings as warning}<p>{warning}</p>{/each}
            </div>
          {/if}
          <p class="provider-intro">Provider keys and global provider settings are not imported. Paid providers remain disabled until you choose otherwise.</p>
        {/if}
        <footer><p>{projectImportPending ? 'Importing and remapping the project…' : 'The archive is validated again when imported.'}</p><button type="button" disabled={projectImportPending} onclick={closeProjectImport}>Cancel</button><button type="button" class="primary" disabled={projectImportPending || !projectImportPreview} onclick={confirmProjectImport}>{projectImportPending ? 'Importing…' : 'Import as new project'}</button></footer>
      </div>
    </div>
  {/if}

  {#if storageAnalysisOpen}
    <div class="modal-backdrop" role="presentation" onclick={() => storageAnalysisOpen = false}>
      <div class="settings storage-settings" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="storage-analysis-title" onclick={stopPropagation} onkeydown={stopPropagation}>
        <header><div><small>Read-only diagnostics</small><h2 id="storage-analysis-title">Project storage</h2></div><button type="button" onclick={() => storageAnalysisOpen = false}>×</button></header>
        {#if storageAnalysisLoading}
          <p class="storage-loading">Reading revision sizes from SQLite…</p>
        {:else if storageAnalysis}
          {@const project = storageAnalysis.projects[0]}
          <p class="provider-intro">This report changes nothing. “Same prose” includes potentially meaningful formatting changes, so it is a normalization candidate—not currently safe garbage.</p>
          <div class="storage-summary">
            <div><small>SQLite file</small><strong>{readableBytes(storageAnalysis.databaseBytes)}</strong></div>
            <div><small>Current project state</small><strong>{readableBytes(storageAnalysis.currentBytes)}</strong></div>
            <div><small>Revision history</small><strong>{readableBytes(storageAnalysis.revisionBytes)}</strong></div>
            <div><small>Normalization candidates</small><strong>{readableBytes(storageAnalysis.normalizationCandidateBytes)}</strong></div>
          </div>
          {#if project}
            <div class="storage-table-wrap">
              <table class="storage-table">
                <thead><tr><th>Document</th><th>Current</th><th>Revisions</th><th>History</th><th>Same prose</th></tr></thead>
                <tbody>
                  {#each [...project.documents].sort((left, right) => right.revisionBytes - left.revisionBytes) as document}
                    <tr>
                      <td title={document.documentId}>{document.title}</td>
                      <td>{readableBytes(document.currentBytes)}</td>
                      <td>{document.revisionCount}</td>
                      <td>{readableBytes(document.revisionBytes)}</td>
                      <td>{document.sameProseRevisionCount} · {readableBytes(document.sameProseRevisionBytes)}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <footer><p>{project.revisionCount} revisions · {readableBytes(project.sameProseRevisionBytes)} require normalization before collection. Safe reclaimable now: {readableBytes(storageAnalysis.safeReclaimableBytes)}.</p><button type="button" class="primary" onclick={() => storageAnalysisOpen = false}>Close</button></footer>
          {/if}
        {:else}
          <p class="storage-loading">The storage report could not be loaded.</p>
        {/if}
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
            <option value="cleared">Cleared</option>
            <option value="target_changed">Target changed</option>
            <option value="target_removed">Target removed</option>
            <option value="stale">Stale</option>
          </select>
        </div>
        <div class="input-summary-area">
          <div class="input-summary"><span>{managedInputs.length} of {workspace.inputs.length} inputs</span><button type="button" disabled={!clearableInputCount} onclick={() => clearInputsConfirmOpen = true}>Clear pending Inputs{clearableInputCount ? ` (${clearableInputCount})` : ''}</button></div>
          {#if clearInputsConfirmOpen}
            <div class="clear-inputs-confirm" role="alertdialog" aria-labelledby="clear-inputs-title">
              <div><strong id="clear-inputs-title">Clear {clearableInputCount} pending {clearableInputCount === 1 ? 'Input' : 'Inputs'}?</strong><small>They will leave the panel but may be raised again by a future review. Accepted work, AI runs, diagnostics, and provenance remain available, and this action can be undone.</small></div>
              <button type="button" onclick={() => clearInputsConfirmOpen = false}>Cancel</button>
              <button type="button" class="danger" onclick={() => void clearPendingInputs()}>Clear Inputs</button>
            </div>
          {/if}
        </div>
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
  .app-shell { position: fixed; inset: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); width: auto; max-width: none; height: auto; min-height: 0; overflow: hidden; border-radius: 0; background: var(--canvas); }
  .topbar { position: relative; z-index: 30; display: grid; grid-template-columns: 1fr auto; align-items: center; min-height: 58px; padding: 0 24px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 91%, transparent); backdrop-filter: blur(14px); }
  .brand { display: flex; align-items: baseline; gap: 8px; text-decoration: none; }
  .brand > span { color: var(--accent); font: 700 25px/1 var(--font-reading); }
  .brand strong { font: 700 14px/1 var(--font-ui); letter-spacing: -.02em; }
  .brand small { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .09em; }
  .top-actions { display: flex; justify-content: flex-end; align-items: center; gap: 4px; }
  .top-actions button, .top-actions a { border: 0; background: transparent; color: var(--ink-soft); padding: 8px 9px; border-radius: 3px; text-decoration: none; font-size: 11px; cursor: pointer; }
  .top-actions button:hover, .top-actions a:hover { background: var(--paper-deep); color: var(--ink); }
  .top-actions span { color: var(--muted); }
  .top-actions .paused { color: var(--accept); font-weight: 700; }
  .top-actions .layout-toggle { display: grid; width: 30px; height: 30px; place-items: center; padding: 0; color: var(--muted); }
  .top-actions .layout-toggle.active { background: var(--paper-deep); color: var(--ink); }
  .pane-icon { position: relative; display: block; box-sizing: border-box; width: 16px; height: 13px; border: 1.5px solid currentColor; border-radius: 2px; }
  .pane-icon::before { position: absolute; top: 0; bottom: 0; width: 4px; background: currentColor; content: ''; opacity: .75; }
  .pane-icon-left::before { left: 0; border-radius: 1px 0 0 1px; }
  .pane-icon-right::before { right: 0; border-radius: 0 1px 1px 0; }
  .mode-hidden { display: none !important; }
  .workbench { display: grid; grid-template-columns: var(--navigator-width) 6px minmax(0, 1fr); width: 100%; height: 100%; min-height: 0; overflow: hidden; }
  .workbench.navigator-hidden { grid-template-columns: minmax(0, 1fr); }
  .navigator-pane { min-width: 0; min-height: 0; height: 100%; max-height: 100%; overflow: hidden; }
  .navigator-resizer { position: relative; z-index: 5; width: 6px; height: 100%; padding: 0; border: 0; border-radius: 0; background: color-mix(in srgb, var(--line) 55%, transparent); cursor: col-resize; outline: none; touch-action: none; }
  .navigator-resizer::after { position: absolute; inset: 0 -3px; content: ''; }
  .navigator-resizer:hover, .navigator-resizer:focus-visible { background: var(--accent); }
  .navigator-resizer span { position: absolute; top: 50%; left: 2px; width: 2px; height: 38px; transform: translateY(-50%); border-radius: 2px; background: color-mix(in srgb, var(--muted) 58%, transparent); }
  :global(body.resizing-navigator) { cursor: col-resize; user-select: none; }
  main { display: flex; min-width: 0; min-height: 0; height: 100%; max-height: 100%; flex-direction: column; overflow: hidden; }
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr) 6px var(--inputs-width); min-width: 0; min-height: 0; height: 100%; max-height: 100%; flex: 1 1 auto; overflow: hidden; }
  .workspace.review-hidden { grid-template-columns: minmax(0, 1fr); }
  .document-column { min-width: 0; min-height: 0; height: 100%; max-height: 100%; overflow: auto; padding: 0 clamp(16px, 1.8vw, 36px) 72px; scrollbar-gutter: stable; }
  .editor-pane-header { position: sticky; z-index: 14; top: 0; display: flex; min-height: 58px; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 7px 0; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 94%, var(--paper)); backdrop-filter: blur(12px); }
  .pane-identity { display: grid; min-width: 130px; flex: 1 1 180px; gap: 3px; }
  .pane-identity small { color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .pane-identity strong { overflow: hidden; color: var(--ink); font: 650 12px/1.2 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .pane-status { display: flex; flex: 0 1 auto; align-items: center; gap: 8px; color: var(--muted); font: 9px/1 var(--font-ui); white-space: nowrap; }
  .pane-status span + span { padding-left: 8px; border-left: 1px solid var(--line); }
  .save-status { display: inline-flex; align-items: center; gap: 4px; }
  .save-status svg { width: 24px; height: 16px; overflow: visible; }
  .save-book { fill: color-mix(in srgb, var(--accent) 8%, var(--paper)); stroke: currentColor; stroke-width: 1.1; stroke-linejoin: round; }
  .save-pen { fill: color-mix(in srgb, var(--accent) 20%, var(--paper)); stroke: currentColor; stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; transform-box: fill-box; transform-origin: center; }
  .save-pending, .save-saving { color: var(--accent); }
  .save-pending .save-pen, .save-saving .save-pen { animation: write-save 1.05s ease-in-out infinite; }
  .save-failed { color: #a33d32; }
  @keyframes write-save {
    0%, 100% { transform: translate(-1px, 1px) rotate(-2deg); }
    50% { transform: translate(3px, -1px) rotate(3deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .save-pending .save-pen, .save-saving .save-pen { animation: none; }
  }
  .pane-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 5px; }
  .history-actions, .zoom-actions { display: flex; align-items: center; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); }
  .pane-actions button, .pane-menu summary { display: grid; min-width: 28px; height: 29px; place-items: center; border: 0; background: transparent; color: var(--muted); font: 600 9px/1 var(--font-ui); cursor: pointer; }
  .pane-actions button:hover, .pane-menu summary:hover { color: var(--accent); }
  .pane-actions button:disabled { cursor: default; opacity: .28; }
  .history-actions button { font-size: 16px; }
  .zoom-actions button:nth-child(2) { min-width: 44px; border-right: 1px solid var(--line); border-left: 1px solid var(--line); }
  .pane-menu { position: relative; }
  .pane-menu summary { border: 1px solid var(--line); border-radius: 4px; background: var(--paper); list-style: none; }
  .pane-menu summary::-webkit-details-marker { display: none; }
  .pane-menu[open] summary { border-color: var(--accent); color: var(--accent); }
  .pane-menu > div { position: absolute; z-index: 20; top: 34px; right: 0; display: grid; width: 170px; gap: 2px; padding: 5px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); box-shadow: 0 12px 30px rgb(35 30 22 / .16); }
  .pane-menu > div button { display: block; width: 100%; padding: 0 8px; color: var(--ink-soft); text-align: left; }
  .pane-menu > div button:hover { background: var(--paper-deep); }
  .editor-wrap { position: relative; padding-top: 14px; }
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
  .inputs-panel { min-width: 0; min-height: 0; height: 100%; max-height: 100%; overflow: auto; padding: 0 18px; border-left: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 84%, var(--paper)); scrollbar-gutter: stable; }
  .inputs-resizer { position: relative; z-index: 5; width: 6px; height: 100%; padding: 0; border: 0; border-radius: 0; background: color-mix(in srgb, var(--line) 55%, transparent); cursor: col-resize; outline: none; touch-action: none; }
  .inputs-resizer::after { position: absolute; inset: 0 -3px; content: ''; }
  .inputs-resizer:hover, .inputs-resizer:focus-visible { background: var(--accent); }
  .inputs-resizer span { position: absolute; top: 50%; left: 2px; width: 2px; height: 38px; transform: translateY(-50%); border-radius: 2px; background: color-mix(in srgb, var(--muted) 58%, transparent); }
  :global(body.resizing-inputs) { cursor: col-resize; user-select: none; }
  .inputs-panel-header { position: sticky; z-index: 4; top: 0; display: grid; gap: 8px; padding: 9px 0; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 94%, var(--paper)); }
  .inputs-heading { min-width: 0; }
  .inputs-heading > div { display: flex; align-items: baseline; gap: 8px; }
  .inputs-heading span { font: 700 10px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .09em; }
  .inputs-heading strong, .inputs-heading small { color: var(--muted); font: 500 9px/1.35 var(--font-ui); }
  .inputs-heading small { display: block; margin-top: 4px; }
  .inputs-header-actions { display: grid; justify-content: end; gap: 5px; }
  .inputs-header-actions > div { display: grid; grid-template-columns: 52px auto auto; align-items: center; justify-content: end; gap: 5px; }
  .inputs-header-actions > div > span { color: var(--muted); font: 700 8px/1 var(--font-ui); text-align: right; text-transform: uppercase; letter-spacing: .06em; }
  .inputs-header-actions button, .inputs-panel-footer button { border: 1px solid var(--line-strong); border-radius: 3px; background: var(--paper); color: var(--ink-soft); padding: 7px 9px; font: 700 9px/1 var(--font-ui); cursor: pointer; white-space: nowrap; }
  .inputs-header-actions button.active { border-color: var(--accent); color: var(--accent); }
  .inputs-header-actions .review-document { border-color: var(--accent); background: var(--accent); color: white; }
  .inputs-header-actions button:disabled { opacity: .42; cursor: default; }
  .context-preflight { display: grid; gap: 8px; margin-top: 8px; border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--line)); border-radius: 4px; background: var(--paper); padding: 10px; }
  .context-preflight > header { display: flex; align-items: start; justify-content: space-between; gap: 8px; }
  .context-preflight > header div { display: grid; gap: 3px; }
  .context-preflight > header strong { color: var(--ink-soft); font: 700 10px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .context-preflight > header small, .context-preflight > header span { color: var(--muted); font: 8px/1.3 var(--font-ui); }
  .context-required { display: grid; gap: 4px; }
  .review-instructions { display: grid; gap: 5px; }
  .review-instructions b { color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .05em; }
  .review-instructions textarea { box-sizing: border-box; width: 100%; resize: vertical; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; color: var(--ink); padding: 8px; font: 10px/1.4 var(--font-ui); }
  .review-instructions small { color: var(--muted); font: 8px/1.3 var(--font-ui); }
  .context-required > b, .context-options > b { color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .05em; }
  .context-required button { display: flex; align-items: center; justify-content: space-between; gap: 7px; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; color: var(--ink-soft); padding: 7px; text-align: left; cursor: pointer; }
  .context-required button small { color: var(--muted); font: 7px/1 var(--font-ui); white-space: nowrap; }
  .context-options { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 10px; }
  .context-options > b { flex-basis: 100%; }
  .context-options label, .context-picker label { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--ink-soft); font: 9px/1.2 var(--font-ui); }
  .context-options input, .context-picker input { accent-color: var(--accent); }
  .add-context { justify-self: start; border: 1px dashed var(--line-strong); border-radius: 3px; background: transparent; color: var(--accent); padding: 6px 8px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .context-picker { display: grid; max-height: min(38vh, 300px); overflow: auto; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; }
  .context-picker-group + .context-picker-group { border-top: 1px solid var(--line); }
  .context-picker-group > header { position: sticky; z-index: 1; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; background: var(--paper-deep); padding: 5px 8px; }
  .context-picker-group > header strong { color: var(--ink-soft); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .05em; }
  .context-picker-group > header span { color: var(--muted); font: 8px/1 var(--font-mono); }
  .context-picker-group > div { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .context-picker label { min-width: 0; padding: 6px 8px; cursor: pointer; }
  .context-picker label:hover { background: var(--accent-soft); }
  .context-picker label span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .context-picker p { margin: 6px; color: var(--muted); font: 9px/1.4 var(--font-ui); }
  .context-manifest-summary { display: flex; gap: 8px; color: var(--muted); font: 8px/1 var(--font-mono); }
  .context-warning { margin: 0; color: var(--reject); font: 9px/1.4 var(--font-ui); }
  .context-preflight > footer, .interrupted-actions { display: flex; justify-content: flex-end; gap: 5px; }
  .context-preflight > footer button, .interrupted-actions button { border: 1px solid var(--line-strong); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 7px 9px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .context-preflight > footer .primary { border-color: var(--accent); background: var(--accent); color: white; }
  .context-preflight button:disabled, .context-preflight input:disabled { opacity: .45; cursor: default; }
  .craft-activity { margin-top: 10px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 3px; background: color-mix(in srgb, var(--paper) 80%, transparent); padding: 9px 10px; }
  .craft-activity > header { display: flex; justify-content: space-between; gap: 8px; color: var(--ink-soft); font: 700 9px/1.2 var(--font-ui); }
  .craft-activity > header span { color: var(--accent); }
  .craft-activity p, .craft-activity small { margin: 5px 0 0; color: var(--muted); font: 9px/1.4 var(--font-ui); }
  .craft-activity small { display: block; color: var(--reject); }
  .interrupted-actions { justify-content: flex-start; margin-top: 8px; }
  .interrupted-actions button:first-child { border-color: var(--accent); color: var(--accent); }
  .activity-failed, .activity-partial { border-left-color: var(--reject); }
  .activity-failed > header span, .activity-partial > header span { color: var(--reject); }
  .activity-discarded, .activity-cancelled { border-left-color: #887b61; }
  .inputs-controls { margin-top: 10px; border: 1px solid var(--line); border-radius: 3px; background: var(--paper); padding: 11px; }
  .control-group + .control-group { margin-top: 13px; padding-top: 13px; border-top: 1px solid var(--line); }
  .control-group > header { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  .control-group > header strong { color: var(--ink-soft); font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .control-group > header small { color: var(--muted); font: 8px/1 var(--font-ui); }
  .category-controls { display: flex; flex-wrap: wrap; gap: 4px; }
  .category-controls button { display: flex; align-items: center; gap: 4px; border: 1px solid var(--line); border-radius: 999px; background: #fffefa; color: var(--ink-soft); padding: 5px 7px; font: 600 8px/1 var(--font-ui); cursor: pointer; }
  .category-controls button i { color: var(--accent); font-style: normal; }
  .category-controls button.off { opacity: .38; text-decoration: line-through; }
  .density-control { display: grid; grid-template-columns: auto minmax(60px, 1fr) 20px; align-items: center; gap: 7px; margin-top: 9px; color: var(--muted); font: 8px/1 var(--font-ui); }
  .density-control input { width: 100%; accent-color: var(--accent); }
  .control-explanation { margin: -2px 0 8px; color: var(--muted); font: 8px/1.45 var(--font-ui); }
  .source-controls { display: grid; gap: 5px; }
  .source-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 5px; }
  .source-row:has(.configure-source) { grid-template-columns: minmax(0, 1fr) auto auto auto; }
  .source-row > div { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 5px; align-items: baseline; }
  .source-row > div b { grid-row: 1 / span 2; color: var(--accent); font: 700 9px/1 var(--font-ui); }
  .source-row > div span { overflow: hidden; color: var(--ink-soft); font: 600 9px/1.2 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .source-row > div small { overflow: hidden; color: var(--muted); font: 7px/1.2 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
  .source-row > button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--muted); padding: 5px 6px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .source-row > button.active { border-color: var(--accept); background: color-mix(in srgb, var(--accept) 9%, transparent); color: var(--accept); }
  .source-row > button:disabled { opacity: .32; cursor: default; }
  .source-row > .configure-source { color: var(--accent); }
  .add-provider { margin-top: 8px; border: 1px dashed var(--line-strong); border-radius: 3px; background: transparent; color: var(--accent); padding: 7px 9px; font: 700 9px/1 var(--font-ui); cursor: pointer; }
  .cards { display: grid; gap: 10px; min-height: 0; padding-top: 14px; }
  .card-slot { position: relative; }
  .card-slot.dragging { opacity: .45; }
  .card-slot.drop-before::before, .card-slot.drop-after::after { position: absolute; z-index: 3; right: 0; left: 0; height: 3px; border-radius: 3px; background: var(--accent); content: ''; pointer-events: none; }
  .card-slot.drop-before::before { top: -6px; }
  .card-slot.drop-after::after { bottom: -6px; }
  .empty-notes { display: grid; place-items: center; text-align: center; padding: 80px 24px; color: var(--muted); }
  .empty-notes > span { display: grid; place-items: center; width: 40px; height: 40px; border: 1px solid var(--line); border-radius: 50%; color: var(--accept); }
  .empty-notes p { margin: 12px 0 5px; color: var(--ink-soft); font: 500 13px/1 var(--font-ui); }
  .empty-notes small { max-width: 230px; font: 10px/1.5 var(--font-ui); }
  .display-limit-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 5px; margin-top: 12px; padding: 9px; border: 1px dashed var(--line-strong); border-radius: 3px; background: var(--paper); }
  .display-limit-actions span { flex-basis: 100%; color: var(--muted); font: 9px/1.35 var(--font-ui); text-align: center; }
  .display-limit-actions button { border: 1px solid var(--line-strong); border-radius: 3px; background: transparent; color: var(--accent); padding: 6px 8px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .key-help { color: var(--muted); font: 9px/1.6 var(--font-ui); text-align: center; }
  kbd { display: inline-block; min-width: 18px; padding: 1px 4px; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 3px; background: var(--paper); font: 8px/1.4 var(--font-mono); }
  .inputs-panel-footer { position: sticky; z-index: 4; bottom: 0; display: flex; align-items: center; gap: 5px; margin-top: 14px; padding: 10px 0 12px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--canvas) 94%, var(--paper)); }
  .inputs-panel-footer > div { min-width: 0; flex: 1; display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 6px; }
  .inputs-panel-footer strong { color: var(--ink-soft); font: 700 9px/1 var(--font-mono); }
  .inputs-panel-footer span { color: var(--muted); font: 8px/1 var(--font-ui); }
  .inputs-panel-footer small { flex-basis: 100%; overflow: hidden; color: var(--muted); font: 7px/1.35 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
  .ledger-panel { flex: 0 0 min(280px, 34vh); min-height: 0; overflow: auto; border-top: 1px solid var(--line); }
  .pause-banner { position: fixed; z-index: 45; top: 66px; left: 50%; transform: translateX(-50%); border: 1px solid #b5cbbf; border-radius: 3px; background: #eff8f2; color: #3f6250; padding: 8px 13px; box-shadow: 0 8px 30px rgb(20 45 30 / .12); font-size: 10px; }
  .provider-alert { position: fixed; z-index: 70; top: 70px; right: 18px; display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; align-items: center; gap: 8px; width: min(620px, calc(100vw - 36px)); border: 1px solid #8f342c; border-radius: 4px; background: #6c2c26; color: #fff8f4; padding: 12px; box-shadow: 0 16px 40px rgb(55 16 12 / .28); }
  .provider-alert > div { display: grid; gap: 3px; }
  .provider-alert strong { font: 750 11px/1.2 var(--font-ui); }
  .provider-alert span { opacity: .8; font: 8px/1.25 var(--font-mono); }
  .provider-alert p { margin: 2px 0 0; font: 10px/1.35 var(--font-ui); }
  .provider-alert button { border: 1px solid rgb(255 255 255 / .45); border-radius: 3px; background: transparent; color: inherit; padding: 7px 9px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .provider-alert button.primary { border-color: #fff8f4; background: #fff8f4; color: #6c2c26; }
  .ai-wait-indicator { position: fixed; z-index: 55; top: 76px; left: 50%; display: grid; grid-template-columns: auto minmax(230px, auto) auto; align-items: center; gap: 14px; transform: translateX(-50%); border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--line)); border-radius: 6px; background: color-mix(in srgb, var(--paper) 95%, var(--accent)); color: var(--accent); padding: 13px 14px 13px 16px; box-shadow: 0 12px 34px rgb(35 30 22 / .18); }
  .ai-wait-indicator svg { width: 56px; height: 38px; overflow: visible; }
  .ai-wait-indicator .save-pen { animation: write-save 1.05s ease-in-out infinite; }
  .ai-wait-indicator div { display: grid; gap: 4px; }
  .ai-wait-indicator strong { color: var(--ink); font: 700 13px/1.15 var(--font-ui); }
  .ai-wait-indicator span { color: var(--muted); font: 10px/1.25 var(--font-ui); }
  .ai-wait-indicator button { display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 50%; background: transparent; color: var(--muted); font: 19px/1 var(--font-ui); cursor: pointer; }
  .ai-wait-indicator button:hover { background: color-mix(in srgb, var(--accent) 9%, transparent); color: var(--accent); }
  @media (prefers-reduced-motion: reduce) {
    .ai-wait-indicator .save-pen { animation: none; }
  }
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
  .project-import-settings { width: min(760px, 100%); }
  .import-warnings { display: grid; gap: 5px; margin: 0 0 18px; border-left: 3px solid #b58234; background: #b582340d; padding: 10px 12px; }
  .import-warnings p { margin: 0; color: var(--ink-soft); font: 10px/1.45 var(--font-ui); }
  .storage-settings { width: min(980px, 100%); }
  .storage-loading { min-height: 160px; display: grid; place-items: center; color: var(--muted); font: 11px/1.5 var(--font-ui); }
  .storage-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 18px 0; }
  .storage-summary > div { display: grid; gap: 7px; border: 1px solid var(--line); border-radius: 4px; background: #fffefa; padding: 12px; }
  .storage-summary small { color: var(--muted); font: 8px/1.2 var(--font-ui); text-transform: uppercase; letter-spacing: .04em; }
  .storage-summary strong { color: var(--ink); font: 600 17px/1 var(--font-reading); }
  .storage-table-wrap { max-height: min(46vh, 520px); overflow: auto; border: 1px solid var(--line); border-radius: 4px; }
  .storage-table { width: 100%; border-collapse: collapse; color: var(--ink-soft); font: 9px/1.35 var(--font-ui); }
  .storage-table th { position: sticky; top: 0; background: var(--paper); color: var(--muted); text-align: left; text-transform: uppercase; letter-spacing: .04em; }
  .storage-table th, .storage-table td { padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .storage-table th:not(:first-child), .storage-table td:not(:first-child) { text-align: right; white-space: nowrap; }
  .storage-table td:first-child { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 760px) { .storage-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  .input-manager { width: min(820px, 100%); max-height: calc(100vh - 44px); overflow: hidden; display: grid; grid-template-rows: auto auto auto minmax(0, 1fr); border: 1px solid var(--line); border-radius: 5px; background: var(--paper); box-shadow: 0 30px 80px rgb(26 22 17 / .22); padding: 24px; }
  .input-manager > header, .input-list article > header, .input-list article > footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .input-manager h2 { margin: 3px 0 0; font: 500 24px/1.2 var(--font-reading); }
  .input-manager header small { color: var(--muted); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .input-manager .close { border: 0; background: transparent; color: var(--muted); font-size: 24px; cursor: pointer; }
  .input-controls { display: grid; grid-template-columns: 1fr 190px; gap: 9px; margin-top: 18px; }
  .input-controls input, .input-controls select { width: 100%; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; color: var(--ink); padding: 9px 10px; outline: none; font-size: 11px; }
  .input-summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 10px 0; color: var(--muted); font-size: 9px; }
  .input-summary-area { min-height: 0; }
  .input-summary button, .clear-inputs-confirm button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 6px 8px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .input-summary button:disabled { opacity: .4; cursor: default; }
  .clear-inputs-confirm { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px; margin-bottom: 10px; border: 1px solid #d9b9b3; border-radius: 4px; background: #9a44390d; padding: 10px; }
  .clear-inputs-confirm > div { display: grid; gap: 3px; }
  .clear-inputs-confirm strong { color: var(--ink-soft); font: 700 10px/1.2 var(--font-ui); }
  .clear-inputs-confirm small { color: var(--muted); font: 8px/1.4 var(--font-ui); }
  .clear-inputs-confirm button.danger { border-color: var(--reject); color: var(--reject); }
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
  .settings header small { color: var(--muted); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  .settings header button { border: 0; background: transparent; color: var(--muted); font-size: 24px; cursor: pointer; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .settings label { display: grid; gap: 6px; margin-bottom: 12px; color: var(--ink-soft); font: 600 10px/1.3 var(--font-ui); }
  .settings input, .settings select, .settings textarea { width: 100%; border: 1px solid var(--line); border-radius: 3px; background: #fffefa; color: var(--ink); padding: 9px 10px; outline: none; font: 12px/1.45 var(--font-ui); resize: vertical; }
  .settings input:focus, .settings textarea:focus, .settings select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .settings label small, .version { justify-self: end; color: var(--muted); font-size: 8px; }
  .settings .context-options label, .settings .context-picker label { display: flex; gap: 6px; margin: 0; font: 9px/1.2 var(--font-ui); }
  .settings .context-options input, .settings .context-picker input { width: 13px; height: 13px; margin: 0; padding: 0; }
  .settings > footer, .settings form > footer { display: flex; align-items: center; justify-content: flex-end; gap: 7px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--line); }
  .settings footer p { flex: 1; margin: 0; color: var(--muted); font: 9px/1.5 var(--font-ui); }
  .settings footer button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 8px 12px; font-size: 10px; cursor: pointer; }
  .settings footer .primary { background: var(--accent); border-color: var(--accent); color: white; }
  .settings footer button:disabled { opacity: .45; cursor: default; }
  .action-runner { width: min(760px, 100%); }
  .action-runner .provider-intro { white-space: pre-wrap; }
  .action-targets { display: flex; flex-wrap: wrap; gap: 8px 18px; margin: 0 0 12px; border: 1px solid var(--line); }
  .action-targets label { display: flex; align-items: center; gap: 6px; margin: 0; font-weight: 500; }
  .action-targets input { width: auto; }
  .action-target-summary { margin: -4px 0 12px; border-left: 3px solid var(--accent); border-radius: 2px; background: var(--accent-soft); color: var(--ink-soft); padding: 8px 10px; font: 600 10px/1.4 var(--font-ui); }
  .action-contract { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: 4px 9px; align-items: baseline; margin: 8px 0 12px; padding: 8px 10px; border-radius: 3px; background: var(--canvas); font: 9px/1.3 var(--font-ui); }
  .action-contract span { color: var(--muted); text-transform: uppercase; }
  .context-preflight.embedded { margin: 0; }
  .required-context-row { display: flex; justify-content: space-between; gap: 8px; border: 1px solid var(--line); border-radius: 3px; padding: 6px 7px; color: var(--ink-soft); font: 9px/1.2 var(--font-ui); }
  .required-context-row small { color: var(--muted); }
  .provider-settings { width: min(560px, 100%); }
  .provider-intro { margin: -6px 0 18px; color: var(--muted); font: 11px/1.6 var(--font-ui); }
  .provider-error { margin: 8px 0 0; color: var(--reject); font: 600 10px/1.4 var(--font-ui); }
  .provider-identity { color: var(--muted); font: 9px/1.2 var(--font-mono); }
  .provider-list { display: grid; gap: 6px; margin-bottom: 16px; }
  .provider-list article { display: flex; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 3px; padding: 9px; }
  .provider-list article > div { min-width: 0; flex: 1; display: grid; gap: 2px; }
  .provider-list article strong { font: 700 10px/1.2 var(--font-ui); }
  .provider-list article span, .provider-list article small { overflow: hidden; color: var(--muted); font: 8px/1.3 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
  .provider-list article button, .provider-presets button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--ink-soft); padding: 6px 8px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .provider-list article button.danger { color: var(--reject); }
  .provider-presets { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 16px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .04em; }
  .provider-presets button.active { border-color: var(--accent); background: var(--accent); color: white; box-shadow: 0 0 0 2px var(--accent-soft); }
  .provider-presets > small { color: var(--reject); font: 700 8px/1 var(--font-ui); }
  .codex-connection { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 7px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 3px; background: var(--canvas); padding: 10px; }
  .codex-connection.connected { border-color: #9dc7b2; background: #edf7f1; }
  .codex-connection > div { min-width: 0; display: grid; gap: 3px; }
  .codex-connection strong { color: var(--ink-soft); font: 700 10px/1.2 var(--font-ui); }
  .codex-connection small { overflow: hidden; color: var(--muted); font: 8px/1.35 var(--font-ui); text-overflow: ellipsis; white-space: nowrap; }
  .codex-connection button, .codex-connection a { border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--accent); padding: 7px 8px; font: 700 8px/1 var(--font-ui); text-decoration: none; cursor: pointer; }
  .codex-connection a { grid-column: 2 / -1; justify-self: end; }
  .run-manager { width: min(860px, 100%); }
  .run-list { display: grid; gap: 8px; }
  .run-list > article { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 3px; padding: 10px; }
  .run-list > article.run-failed { border-left-color: var(--reject); }
  .run-list > article > header { display: flex; justify-content: space-between; gap: 8px; }
  .run-list > article > header div { display: grid; gap: 2px; }
  .run-list > article > header strong { font: 700 10px/1.2 var(--font-ui); }
  .run-list > article > header span, .run-list > article > p { margin: 0; color: var(--muted); font: 8px/1.4 var(--font-ui); }
  .run-list > article > header b { color: var(--accent); font: 700 8px/1 var(--font-ui); text-transform: uppercase; }
  .run-list > article > button { margin-top: 8px; border: 1px solid var(--line-strong); border-radius: 3px; background: transparent; color: var(--accent); padding: 6px 8px; font: 700 8px/1 var(--font-ui); cursor: pointer; }
  .run-diagnostic { display: grid; grid-template-columns: auto 1fr; gap: 2px 7px; margin-top: 7px; padding: 7px; background: var(--paper-deep); font: 8px/1.35 var(--font-ui); }
  .run-diagnostic span { color: var(--muted); }
  .run-diagnostic small { grid-column: 1 / -1; color: var(--ink-soft); }
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
    .workspace.review-hidden { grid-template-columns: minmax(0, 1fr); }
    .brand small { display: none; }
  }
  @media (max-width: 680px) {
    .topbar { grid-template-columns: 1fr auto; padding: 0 12px; }
    .top-actions button:nth-last-child(n+3), .top-actions a { display: none; }
    .document-column { padding: 0 12px 48px; }
    .inputs-panel { padding-inline: 11px; }
    .form-grid { grid-template-columns: 1fr; }
    .context-fields { grid-template-columns: 1fr; }
  }
</style>
