import { categories, sourceCatalog, makeId, coalesceDuplicateSuggestions, isExactTextSpan, normalizeInputRecord, type Branch, type Category, type CraftRun, type GenerationRequest, type InputError, type InputProposal, type LedgerEvent, type SourceState, type Suggestion, type SuggestionState, type TaskPrompt, type WritingBrief, type WritingMode } from '$lib/domain';
import { validReturnedContext, type AIActionSnapshot, type AIActivityRecord, type AIContextItem, type AIContextManifest, type AIContextSelection, type AIInteractionIntent, type AIInteractionRequest, type AIInteractionService, type AIServiceDiagnostic } from '$lib/ai/contracts';
import { FacadeAIInteractionService } from '$lib/ai/service';
import { cloneDefaultAIActions, normalizedAIActions, type AIActionDefinition, type AIActionTargetScope } from '$lib/ai/actions';
import { workspaceFacade, type MarkdownExport, type UploadedAsset, type WorkspaceFacade } from '$lib/workspace/facade';
import type { ContextBucket, ContextScope, WorkspaceDocument, WorkspaceProject } from '$lib/workspace/model';
import type { ProjectArchiveExport, ProjectExportMode, ProjectExportSnapshot, ProjectImportPreview } from '$lib/workspace/project-transfer';
import type { StorageAnalysis } from '$lib/workspace/retention';
import { defaultAttachmentBehaviours, firstTextTarget, sameTarget, selectionHasStrikethrough, textTarget, transformTargetSet, type AttachmentBehaviour, type FormatAttachment, type TargetSet } from '$lib/workspace/attachments';
import { applyAttachmentChanges } from '$lib/workspace/mutations';
import { cloneHistorySnapshot, type EditorDocumentSnapshot, type EditorTransactionDetail, type WorkspaceHistoryEntry, type WorkspaceHistorySnapshot } from '$lib/workspace/transactions';
import { completeDocumentRange, documentCraftParagraphs, documentTextBetween, type DocumentRange } from '$lib/workspace/document';
import { isRichDocument, richDocumentFromProseMirror, richDocumentFromText, type RichDocument } from '$lib/workspace/rich-document';
import { settings, type SettingsState } from '$lib/state/settings.svelte';
import {
  ancestors,
  emptyNavigatorMemory,
  emptyNavigatorState,
  itemDisplayName,
  navigatorExtensions,
  nodeArchived,
  nodeArchivedExtensions,
  nodeCollectionId,
  nodeExtensions,
  nodeOptionalTitle,
  readNavigatorState,
  relationNeighbours,
  type CollectionDefinition,
  type NavigatorMemory,
  type NavigatorProjectState,
  type NavigatorRelationship,
  type NavigatorTodo,
  type RelationshipDefinition
} from '$lib/workspace/navigator';

const defaultBrief: WritingBrief = { version: 1, form: 'fiction', pov: 'close third person', tense: 'past', distance: 'close, embodied, minimal narrator intrusion', canon: '' };
const defaultPrompt: TaskPrompt = { id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Flag craft issues precisely.' };
const attachmentBehaviourVersion = 2;
const authorityVersion = 2;
const defaultAIContextSelection: AIContextSelection = {
  includeMaterial: true,
  includeRelationships: true,
  includeTodos: true,
  addedSourceIds: []
};

function proposalKindForAction(action: AIActionSnapshot): string {
  if (action.responseContract === 'commentary') return 'commentary_input';
  if (action.responseContract === 'annotated_findings') return 'annotated_input';
  if (action.responseContract === 'revision_options') return 'revision_options';
  if (action.responseContract === 'alternative_draft') return 'alternative_draft';
  return 'craft_input';
}

function isInputProposalPayload(value: unknown): value is InputProposal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proposal = value as Partial<InputProposal>;
  return typeof proposal.proposalId === 'string'
    && typeof proposal.source === 'string'
    && typeof proposal.sourceNumber === 'number'
    && (proposal.sourceKind === 'local' || proposal.sourceKind === 'ai')
    && Number.isInteger(proposal.from)
    && Number.isInteger(proposal.to)
    && typeof proposal.sourceText === 'string'
    && (proposal.anchorStatus === undefined || proposal.anchorStatus === 'exact' || proposal.anchorStatus === 'request_scope' || proposal.anchorStatus === 'unanchored')
    && (proposal.type === 'replacement' || proposal.type === 'insertion' || proposal.type === 'annotation')
    && categories.includes(proposal.category as Category)
    && typeof proposal.comment === 'string'
    && Array.isArray(proposal.variants)
    && proposal.variants.every((variant) => typeof variant === 'string')
    && typeof proposal.confidence === 'number'
    && Number.isFinite(proposal.confidence)
    && Boolean(proposal.provenance && typeof proposal.provenance === 'object');
}

interface NavigatorHistorySnapshot {
  navigator: NavigatorProjectState;
  documents: WorkspaceDocument[];
}

interface NavigatorHistoryEntry {
  id: string;
  label: string;
  before: NavigatorHistorySnapshot;
  after: NavigatorHistorySnapshot;
  createdAt: number;
}

interface DocumentDomainLoadResult {
  archivedLegacyInputs: number;
  realignedCapturedInputs: number;
}

export type DocumentSaveState = 'saved' | 'pending' | 'saving' | 'failed';

export class WorkspaceState {
  sessionId = $state('session_pending');
  projectId = $state('project_default');
  branchId = $state('main');
  // Kept in provider requests for backward compatibility; the UI is one continuous workflow.
  mode = $state<WritingMode>('revising');
  paused = $state(false);
  activeSuggestionId = $state<string | null>(null);
  preview = $state<{ suggestionId: string; text: string } | null>(null);
  inputs = $state<Suggestion[]>([]);
  formats = $state<FormatAttachment[]>([]);
  runs = $state<CraftRun[]>([]);
  activities = $state<AIActivityRecord[]>([]);
  behaviours = $state<Record<string, AttachmentBehaviour>>({ ...defaultAttachmentBehaviours });
  workspaceRevision = $state(0);
  documentSnapshot = $state<EditorDocumentSnapshot | null>(null);
  richDocument = $state<RichDocument>(richDocumentFromText(''));
  undoStack = $state<WorkspaceHistoryEntry[]>([]);
  redoStack = $state<WorkspaceHistoryEntry[]>([]);
  navigatorUndoStack = $state<NavigatorHistoryEntry[]>([]);
  navigatorRedoStack = $state<NavigatorHistoryEntry[]>([]);
  ledger = $state<Required<LedgerEvent>[]>([]);
  brief = $state<WritingBrief>(defaultBrief);
  prompts = $state<TaskPrompt[]>([defaultPrompt]);
  actions = $state<AIActionDefinition[]>(cloneDefaultAIActions());
  branches = $state<Branch[]>([{ id: 'main', name: 'Main draft', createdAt: new Date().toISOString(), wordCount: 0, lastEdited: new Date().toISOString() }]);
  projects = $state<WorkspaceProject[]>([]);
  documents = $state<WorkspaceDocument[]>([]);
  contextBuckets = $state<ContextBucket[]>([]);
  navigator = $state<NavigatorProjectState>(emptyNavigatorState());
  navigatorMemory = $state<NavigatorMemory>(emptyNavigatorMemory());
  sourceStates = $state<Record<string, SourceState>>(Object.fromEntries(sourceCatalog.map((source) => [source.id, source.id === 'openrouter' || source.id === 'ollama' ? 'off' : 'visible'])));
  inputSourceVisibility = $state<Record<string, boolean>>(Object.fromEntries(sourceCatalog.map((source) => [source.id, true])));
  categoryVisibility = $state<Record<Category, boolean>>(Object.fromEntries(categories.map((category) => [category, true])) as Record<Category, boolean>);
  densityCap = $state(8);
  costUsd = $state(0);
  loading = $state(true);
  generating = $state(false);
  notice = $state<string | null>(null);
  lastError = $state<string | null>(null);
  documentSaveStates = $state<Record<string, DocumentSaveState>>({});
  private dispatches = new Map<string, AbortController>();
  private dispatchRunIds = new Map<string, string>();
  private documentSaves = new Map<string, Promise<void>>();
  private documentSaveVersions = new Map<string, number>();
  private initialized = false;

  private readonly aiService: AIInteractionService;

  constructor(
    private readonly facade: WorkspaceFacade = workspaceFacade,
    aiService?: AIInteractionService,
    private readonly settingsState: SettingsState = settings
  ) {
    this.aiService = aiService ?? new FacadeAIInteractionService(facade);
  }

  get suggestions(): Suggestion[] { return this.inputs; }
  set suggestions(value: Suggestion[]) { this.inputs = value; }

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get canUndoNavigator(): boolean { return this.navigatorUndoStack.length > 0; }
  get canRedoNavigator(): boolean { return this.navigatorRedoStack.length > 0; }
  get navigatorUndoLabel(): string | null { return this.navigatorUndoStack.at(-1)?.label ?? null; }
  get navigatorRedoLabel(): string | null { return this.navigatorRedoStack.at(-1)?.label ?? null; }

  get pendingCount(): number {
    return this.suggestions.filter((suggestion) => suggestion.state === 'pending' || suggestion.state === 'hidden').length;
  }

  get visibleSuggestions(): Suggestion[] {
    return this.suggestions
      .filter((suggestion) => suggestion.state === 'pending')
      .filter((suggestion) => this.categoryVisibility[suggestion.category])
      .filter((suggestion) => this.inputSourceVisibility[suggestion.source] !== false)
      .sort((a, b) => a.order - b.order)
      .slice(0, this.densityCap);
  }

  get queuedCount(): number {
    return Math.max(0, this.suggestions.filter((suggestion) => suggestion.state === 'pending').length - this.visibleSuggestions.length);
  }

  get currentProject(): WorkspaceProject | null {
    return this.projects.find((project) => project.id === this.projectId) ?? null;
  }

  get currentDocument(): WorkspaceDocument | null {
    return this.documents.find((document) => document.id === this.branchId) ?? null;
  }

  get currentDocumentSaveState(): DocumentSaveState {
    return this.documentSaveStates[this.branchId] ?? 'saved';
  }

  get workspaceSaveState(): DocumentSaveState {
    const states = Object.values(this.documentSaveStates);
    if (states.includes('failed')) return 'failed';
    if (states.includes('saving')) return 'saving';
    if (states.includes('pending')) return 'pending';
    return 'saved';
  }

  get unsavedDocumentCount(): number {
    return Object.values(this.documentSaveStates).filter((state) => state !== 'saved').length;
  }

  markCurrentDocumentDirty(): void {
    if (this.currentDocument) this.documentSaveStates[this.branchId] = 'pending';
  }

  get currentContext(): ContextBucket[] {
    return this.contextBuckets.filter((bucket) => bucket.projectId === this.projectId && (bucket.scope === 'project' || bucket.documentId === this.branchId));
  }

  get projectNodes(): WorkspaceDocument[] {
    return this.documents.filter((document) => document.projectId === this.projectId);
  }

  get aiContextMaterials(): WorkspaceDocument[] {
    return this.projectNodes
      .filter((document) => !['spine', 'todos', 'navigator_todo'].includes(document.role ?? '') && document.content.trim())
      .sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true }));
  }

  contextSelection(actionId: string): AIContextSelection {
    const stored = this.currentProject?.extensions.ai_context_preferences;
    const preferences = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as Record<string, unknown>
      : {};
    const value = preferences[actionId];
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...defaultAIContextSelection, addedSourceIds: [] };
    const selection = value as Record<string, unknown>;
    return {
      includeMaterial: selection.includeMaterial !== false,
      includeRelationships: selection.includeRelationships !== false,
      includeTodos: selection.includeTodos !== false,
      addedSourceIds: Array.isArray(selection.addedSourceIds) ? selection.addedSourceIds.map(String) : []
    };
  }

  actionContextSelection(action: AIActionDefinition): AIContextSelection {
    const stored = this.currentProject?.extensions.ai_context_preferences;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !(action.id in stored)) {
      return { ...action.context, addedSourceIds: [...action.context.addedSourceIds] };
    }
    return this.contextSelection(action.id);
  }

  async saveContextSelection(actionId: string, selection: AIContextSelection): Promise<void> {
    const project = this.currentProject;
    if (!project) return;
    const stored = project.extensions.ai_context_preferences;
    const preferences = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as Record<string, unknown>
      : {};
    const saved = await this.facade.saveProject(project.id, project.title, {
      ...project.extensions,
      ai_context_preferences: {
        ...preferences,
        [actionId]: JSON.parse(JSON.stringify(selection))
      }
    });
    this.projects = this.projects.map((item) => item.id === saved.id ? saved : item);
  }

  private async persistProjectActions(): Promise<void> {
    const project = this.currentProject;
    if (!project) return;
    const saved = await this.facade.saveProject(project.id, project.title, {
      ...project.extensions,
      ai_actions: JSON.parse(JSON.stringify(this.actions))
    });
    this.projects = this.projects.map((item) => item.id === saved.id ? saved : item);
  }

  async saveAIAction(input: AIActionDefinition): Promise<AIActionDefinition> {
    const current = this.actions.find((action) => action.id === input.id);
    const [normalized] = normalizedAIActions([{ ...input, version: (current?.version ?? 0) + 1 }]);
    if (!normalized || normalized.id !== input.id) throw new Error('Action name, instructions, response contract, and at least one target are required.');
    this.actions = current
      ? this.actions.map((action) => action.id === normalized.id ? normalized : action)
      : [...this.actions, normalized];
    await this.persistProjectActions();
    return normalized;
  }

  async deleteAIAction(id: string): Promise<void> {
    if (this.actions.length <= 1) throw new Error('A project must retain at least one AI action.');
    this.actions = this.actions.filter((action) => action.id !== id);
    await this.persistProjectActions();
  }

  get spineNode(): WorkspaceDocument | null {
    return this.projectNodes.find((document) => document.role === 'spine') ?? null;
  }

  get todosNode(): WorkspaceDocument | null {
    return this.projectNodes.find((document) => document.role === 'todos') ?? null;
  }

  todoNode(todoId: string): WorkspaceDocument | null {
    return this.projectNodes.find((document) => document.id === todoId && document.role === 'navigator_todo') ?? null;
  }

  get navigatorNodes(): WorkspaceDocument[] {
    return this.projectNodes.filter((document) => !['spine', 'todos', 'navigator_collection', 'navigator_todo'].includes(document.role ?? ''));
  }

  get archivedOrUnownedNodes(): WorkspaceDocument[] {
    return this.navigatorNodes.filter((node) => nodeArchived(node) || !nodeCollectionId(node)
      || !this.navigator.collections.some((collection) => collection.id === nodeCollectionId(node)));
  }

  get selectedNodeAncestors(): WorkspaceDocument[] {
    return this.navigatorFocusId ? ancestors(this.navigatorFocusId, this.projectNodes) : [];
  }

  get selectedNodeParent(): WorkspaceDocument | null {
    return this.selectedNodeAncestors.at(-1) ?? null;
  }

  get selectedNodeChildren(): WorkspaceDocument[] {
    if (!this.navigatorFocusId) return [];
    return this.navigatorNodes
      .filter((node) => node.parentId === this.navigatorFocusId && !nodeArchived(node))
      .sort((left, right) => left.order - right.order);
  }

  get selectedNodeSiblings(): WorkspaceDocument[] {
    const focus = this.navigatorFocusNode;
    if (!focus?.parentId) return [];
    return this.navigatorNodes
      .filter((node) => node.id !== focus.id && node.parentId === focus.parentId && !nodeArchived(node))
      .sort((left, right) => left.order - right.order);
  }

  get selectedNodeRelations(): { node: WorkspaceDocument; label: string; relationshipId: string; scopeNodeIds: string[]; note: string }[] {
    if (!this.navigatorFocusId) return [];
    return this.navigatorRelationsFor(this.navigatorFocusId);
  }

  navigatorRelationsFor(nodeId: string): { node: WorkspaceDocument; label: string; relationshipId: string; scopeNodeIds: string[]; note: string }[] {
    const byId = new Map(this.projectNodes.map((node) => [node.id, node]));
    return relationNeighbours(nodeId, this.navigator.relationships).flatMap((relation) => {
      const node = byId.get(relation.nodeId);
      const relationship = this.navigator.relationships.find((candidate) => candidate.id === relation.relationshipId);
      return node && !nodeArchived(node) ? [{
        node,
        label: relation.label,
        relationshipId: relation.relationshipId,
        scopeNodeIds: relationship?.scopeNodeIds ?? [],
        note: relationship?.note ?? ''
      }] : [];
    });
  }

  get selectedNodeTodos(): NavigatorTodo[] {
    return this.navigatorFocusId ? this.navigatorTodosFor(this.navigatorFocusId) : [];
  }

  navigatorTodosFor(nodeId: string): NavigatorTodo[] {
    return this.navigator.todos.filter((todo) => todo.targetNodeIds.includes(nodeId));
  }

  get navigatorFocusId(): string | null {
    const key = this.navigatorMemory.context.focusKey;
    return key?.startsWith('node:') ? key.slice(5) : null;
  }

  get navigatorFocusNode(): WorkspaceDocument | null {
    const id = this.navigatorFocusId;
    return id ? this.projectNodes.find((node) => node.id === id) ?? null : null;
  }

  navigatorNeighbourhood(nodeId: string): WorkspaceDocument[] {
    const node = this.projectNodes.find((candidate) => candidate.id === nodeId);
    if (!node) return [];
    const related = this.navigatorRelationsFor(nodeId).map((relation) => relation.node);
    const structural = this.navigatorNodes.filter((candidate) => !nodeArchived(candidate) && (
      candidate.id === node.parentId
      || candidate.parentId === node.id
      || (node.parentId !== null && candidate.parentId === node.parentId && candidate.id !== node.id)
    ));
    return [...new Map([...structural, ...related]
      .filter((candidate) => candidate.id !== nodeId)
      .map((candidate) => [candidate.id, candidate])).values()];
  }

  get navigatorBackId(): string | null {
    const { historyKeys, historyIndex } = this.navigatorMemory.context;
    const key = historyIndex > 0 ? historyKeys[historyIndex - 1] : null;
    return key?.startsWith('node:') ? key.slice(5) : null;
  }

  get navigatorForwardId(): string | null {
    const { historyKeys, historyIndex } = this.navigatorMemory.context;
    const key = historyIndex >= 0 && historyIndex < historyKeys.length - 1 ? historyKeys[historyIndex + 1] : null;
    return key?.startsWith('node:') ? key.slice(5) : null;
  }

  collectionNode(collectionId: string): WorkspaceDocument | null {
    return this.projectNodes.find((node) => node.id === collectionId && node.role === 'navigator_collection') ?? null;
  }

  navigatorNodeLabel(node: WorkspaceDocument): string {
    const collection = this.navigator.collections.find((item) => item.id === nodeCollectionId(node));
    if (!collection || node.role === 'navigator_collection') return node.title;
    const siblings = this.navigatorNodes.filter((candidate) =>
      candidate.parentId === node.parentId && nodeCollectionId(candidate) === collection.id && !nodeArchived(candidate));
    return itemDisplayName(node, collection, siblings);
  }

  navigatorNodeEditableTitle(node: WorkspaceDocument): string {
    const collection = node.role === 'navigator_node'
      ? this.navigator.collections.find((item) => item.id === nodeCollectionId(node))
      : undefined;
    return collection?.numbering.enabled ? nodeOptionalTitle(node) : node.title;
  }

  navigatorNodeType(node: WorkspaceDocument): string {
    if (node.role === 'spine') return 'Spine · includes story brief';
    if (node.role === 'navigator_collection') return 'Collection';
    if (node.role === 'navigator_todo') return 'Todo';
    return this.navigator.collections.find((item) => item.id === nodeCollectionId(node))?.singularName ?? 'Document';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    if (typeof localStorage !== 'undefined') {
      this.sessionId = localStorage.getItem('margin-note:session') ?? makeId('session');
      localStorage.setItem('margin-note:session', this.sessionId);
      this.projectId = localStorage.getItem('margin-note:project') ?? 'project_default';
      this.branchId = localStorage.getItem('margin-note:document') ?? localStorage.getItem('margin-note:branch') ?? 'main';
    }
    try {
      const loaded = await this.facade.load({ projectId: this.projectId, documentId: this.branchId });
      this.brief = loaded.brief;
      this.prompts = loaded.prompts;
      this.projects = loaded.persistent.projects;
      this.documents = loaded.persistent.documents;
      this.contextBuckets = loaded.persistent.contextBuckets;
      this.projectId = loaded.activeProjectId;
      this.branchId = loaded.activeDocumentId;
      this.navigator = readNavigatorState(this.currentProject);
      this.actions = normalizedAIActions(this.currentProject?.extensions.ai_actions);
      this.loadNavigatorMemory();
      await this.ensureProjectStructure();
      if (!Array.isArray(this.currentProject?.extensions.ai_actions)) await this.persistProjectActions();
      this.branches = loaded.branches;
      this.ledger = loaded.events;
      this.settingsState.load(loaded.sourceAvailability);
      this.syncAvailableSources();
      if (loaded.providerSettingsError) {
        this.lastError = `Writing workspace loaded, but AI provider settings are unavailable: ${loaded.providerSettingsError}`;
      }
      const domainLoad = this.loadDocumentDomain(this.currentDocument);
      const interruptedRuns = this.reconcileInterruptedRuns();
      if (domainLoad.archivedLegacyInputs) {
        this.notice = `${domainLoad.archivedLegacyInputs} legacy live inputs were archived because their pre-Svelte targets cannot be trusted.`;
      } else if (domainLoad.realignedCapturedInputs) {
        this.notice = `${domainLoad.realignedCapturedInputs} saved AI ${domainLoad.realignedCapturedInputs === 1 ? 'input was' : 'inputs were'} realigned to the writer's captured selection.`;
      }
      if (interruptedRuns) this.notice = `${interruptedRuns} interrupted AI ${interruptedRuns === 1 ? 'passage needs' : 'passages need'} a retry or completion decision.`;
      if (domainLoad.archivedLegacyInputs || domainLoad.realignedCapturedInputs || interruptedRuns) {
        const reason = interruptedRuns
          ? 'Reconcile interrupted AI runs'
          : domainLoad.realignedCapturedInputs
            ? 'Realign captured AI input targets'
            : 'Archive legacy input targets';
        await this.persistDomainState(reason);
      }
      this.costUsd = loaded.stats.costUsd;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('margin-note:project', this.projectId);
        localStorage.setItem('margin-note:document', this.branchId);
        localStorage.setItem('margin-note:branch', this.branchId);
      }
      void this.log('session_started', { userAgent: navigator.userAgent, resumedSession: this.ledger.some((event) => event.sessionId === this.sessionId) });
    } catch (error) {
      this.initialized = false;
      this.lastError = error instanceof Error ? error.message : 'Could not initialize workspace';
    } finally {
      this.loading = false;
    }
  }

  setEditorReady(snapshot: EditorDocumentSnapshot): void {
    this.documentSnapshot = cloneHistorySnapshot({
      document: snapshot,
      inputs: [],
      formats: [],
      revision: this.workspaceRevision
    }).document;
  }

  recordEditorTransaction(detail: EditorTransactionDetail): { suggestions: Suggestion[]; formats: FormatAttachment[] } {
    this.setCanonicalDocument(detail.after);
    if (detail.origin.kind === 'workspace_history') return { suggestions: this.visibleSuggestions, formats: this.formats };

    if (detail.origin.kind === 'system') {
      this.workspaceRevision += 1;
      const previous = this.undoStack.at(-1);
      if (previous) {
        this.undoStack = [...this.undoStack.slice(0, -1), {
          ...previous,
          after: this.historySnapshot(detail.after)
        }];
      }
      return { suggestions: this.visibleSuggestions, formats: this.formats };
    }

    const transactionId = makeId('transaction');
    const before = this.historySnapshot(detail.before);
    const transformed = applyAttachmentChanges({
      inputs: this.inputs,
      formats: this.formats,
      behaviours: this.behaviours,
      changes: detail.changes,
      revision: this.workspaceRevision,
      transactionId,
      acceptedInputId: detail.origin.kind === 'input_acceptance' ? detail.origin.inputId : undefined
    });
    this.inputs = transformed.inputs;
    this.formats = transformed.formats;
    this.runs = this.runs.map((run) => {
      if (run.documentId !== this.branchId || (run.state !== 'queued' && run.state !== 'running')) return run;
      const transformedRun = transformTargetSet(run.target, detail.changes, defaultAttachmentBehaviours['craft-input']);
      if (transformedRun.change === 'changed' || transformedRun.change === 'removed' || transformedRun.change === 'detached') {
        return { ...run, target: transformedRun.target, state: 'discarded' as const, completedAt: new Date().toISOString() };
      }
      return { ...run, target: transformedRun.target };
    });
    this.workspaceRevision += 1;
    const after = this.historySnapshot(detail.after);
    const acceptance = detail.origin.kind === 'input_acceptance';
    const formattingOnly = detail.after.text === detail.before.text;
    this.pushHistory({
      id: transactionId,
      source: acceptance ? 'ai' : formattingOnly ? 'format' : 'human',
      label: acceptance ? 'Accept input revision' : formattingOnly ? 'Edit formatting' : 'Edit text',
      before,
      after,
      createdAt: Date.now(),
      group: acceptance || formattingOnly ? undefined : 'typing'
    });
    return { suggestions: this.visibleSuggestions, formats: this.formats };
  }

  undoWorkspace(): EditorDocumentSnapshot | null {
    const entry = this.undoStack.at(-1);
    if (!entry) return null;
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, entry];
    this.restoreHistoryState(entry.before);
    void this.persistDomainState('Undo workspace change');
    return entry.before.document;
  }

  redoWorkspace(): EditorDocumentSnapshot | null {
    const entry = this.redoStack.at(-1);
    if (!entry) return null;
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, entry];
    this.restoreHistoryState(entry.after);
    void this.persistDomainState('Redo workspace change');
    return entry.after.document;
  }

  async recordNavigatorChange<T>(label: string, change: () => Promise<T>): Promise<T> {
    const before = this.navigatorHistorySnapshot();
    const result = await change();
    const after = this.navigatorHistorySnapshot();
    if (this.navigatorSnapshotsDiffer(before, after)) {
      this.navigatorUndoStack = [...this.navigatorUndoStack, {
        id: makeId('navigator_history'),
        label,
        before,
        after,
        createdAt: Date.now()
      }].slice(-100);
      this.navigatorRedoStack = [];
    }
    return result;
  }

  async undoNavigator(): Promise<void> {
    const entry = this.navigatorUndoStack.at(-1);
    if (!entry) return;
    await this.restoreNavigatorHistorySnapshot(entry.before, `Undo: ${entry.label}`);
    this.navigatorUndoStack = this.navigatorUndoStack.slice(0, -1);
    this.navigatorRedoStack = [...this.navigatorRedoStack, entry];
  }

  async redoNavigator(): Promise<void> {
    const entry = this.navigatorRedoStack.at(-1);
    if (!entry) return;
    await this.restoreNavigatorHistorySnapshot(entry.after, `Redo: ${entry.label}`);
    this.navigatorRedoStack = this.navigatorRedoStack.slice(0, -1);
    this.navigatorUndoStack = [...this.navigatorUndoStack, entry];
  }

  private setStrikethrough(target: TargetSet, value: boolean, label: string): boolean {
    if (!this.documentSnapshot) return false;
    const before = this.historySnapshot(this.documentSnapshot);
    const matching = this.formats.filter((format) => format.properties.strikethrough !== undefined && sameTarget(format.target, target));
    const existing = matching
      .sort((left, right) => right.priority - left.priority || right.createdAtRevision - left.createdAtRevision)[0];
    const priority = Math.max(10, ...this.formats.map((format) => format.priority + 1));
    if (existing) {
      this.formats = [
        ...this.formats.filter((format) => !matching.some((item) => item.id === format.id)),
        {
          ...existing,
          properties: { ...existing.properties, strikethrough: value },
          priority,
          createdAtRevision: this.workspaceRevision
        }
      ];
    } else {
      this.formats = [...this.formats, {
        id: makeId('format'),
        target,
        properties: { strikethrough: value },
        behaviourId: 'format-default',
        priority,
        createdAtRevision: this.workspaceRevision
      }];
    }
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({
      id: makeId('transaction'),
      source: 'format',
      label,
      before,
      after,
      createdAt: Date.now()
    });
    void this.persistDomainState(label);
    return true;
  }

  toggleSelectionStrikethrough(from: number, to: number, selectedText: string): boolean {
    if (from >= to || !this.documentSnapshot || documentTextBetween(this.documentSnapshot, from, to) !== selectedText) {
      this.notice = 'The selection changed. Select it again before formatting.';
      return false;
    }
    return this.setStrikethrough(
      textTarget(this.branchId, from, to, selectedText),
      !this.selectionHasStrikethrough(from, to),
      'Toggle selection strikethrough'
    );
  }

  toggleWorkStrikethrough(): boolean {
    const target: TargetSet = {
      mode: 'live',
      targets: [{ type: 'node', nodeId: this.branchId, includeDescendants: true }]
    };
    return this.setStrikethrough(target, !this.workHasStrikethrough, 'Toggle work strikethrough');
  }

  selectionHasStrikethrough(from: number, to: number): boolean {
    return from < to && selectionHasStrikethrough(this.formats, this.branchId, from, to);
  }

  get workHasStrikethrough(): boolean {
    return selectionHasStrikethrough(this.formats, this.branchId, 0, Number.MAX_SAFE_INTEGER);
  }

  async setInputState(id: string, state: SuggestionState, label: string): Promise<void> {
    const record = this.inputs.find((item) => item.id === id);
    if (!record || record.state === state || !this.documentSnapshot) return;
    const before = this.historySnapshot(this.documentSnapshot);
    this.inputs = this.inputs.map((item) => item.id === id ? { ...item, state } : item);
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({ id: makeId('transaction'), source: 'input', label, before, after, createdAt: Date.now() });
    await this.persistDomainState(label);
  }

  async clearPendingInputs(): Promise<number> {
    const clearable = this.inputs.filter((item) => item.state === 'pending' || item.state === 'hidden');
    if (!clearable.length || !this.documentSnapshot) return 0;
    const clearableIds = new Set(clearable.map((item) => item.id));
    const before = this.historySnapshot(this.documentSnapshot);
    this.inputs = this.inputs.map((item) => clearableIds.has(item.id) ? { ...item, state: 'cleared' as const } : item);
    if (this.activeSuggestionId && clearableIds.has(this.activeSuggestionId)) this.activeSuggestionId = null;
    this.preview = null;
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({
      id: makeId('transaction'),
      source: 'input',
      label: `Clear ${clearable.length} pending ${clearable.length === 1 ? 'Input' : 'Inputs'}`,
      before,
      after,
      createdAt: Date.now()
    });
    await this.persistDomainState('Clear pending Inputs');
    return clearable.length;
  }

  async log(type: LedgerEvent['type'], payload: Record<string, unknown>, suggestionId?: string): Promise<void> {
    const event: LedgerEvent = { type, sessionId: this.sessionId, branchId: this.branchId, suggestionId, payload };
    try {
      const saved = await this.facade.appendEvent(event);
      this.ledger = [saved, ...this.ledger].slice(0, 60);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : 'Ledger write failed';
    }
  }

  async refreshLedger(): Promise<void> {
    const data = await this.facade.events();
    this.ledger = data.events;
    this.costUsd = data.stats.costUsd;
  }

  async setMode(next: WritingMode): Promise<void> {
    if (next === this.mode) return;
    const previous = this.mode;
    this.mode = next;
    this.activeSuggestionId = null;
    await this.log('mode_switch', { from: previous, to: next, pendingSuggestions: this.pendingCount });
  }

  async togglePause(): Promise<void> {
    this.paused = !this.paused;
    if (this.paused) {
      for (const controller of this.dispatches.values()) controller.abort();
      this.dispatches.clear();
    }
    await this.log(this.paused ? 'paused' : 'resumed', { mode: this.mode });
  }

  async toggleRunSource(sourceId: string): Promise<void> {
    const availability = this.settingsState.availability(sourceId);
    if (!this.sourceAvailable(sourceId)) {
      this.sourceStates[sourceId] = 'off';
      this.notice = availability.reason ?? `${sourceId} is not configured.`;
      return;
    }
    const previous = this.sourceStates[sourceId] ?? 'visible';
    const next: SourceState = previous === 'off' ? 'visible' : 'off';
    this.sourceStates[sourceId] = next;
    if (next === 'off') {
      for (const [key, controller] of this.dispatches) {
        if (key.includes(`:${sourceId}:`)) { controller.abort(); this.dispatches.delete(key); }
      }
    }
    await this.log('source_state_changed', { source: sourceId, purpose: 'run_participation', from: previous, to: next });
  }

  async toggleInputSourceVisibility(sourceId: string): Promise<void> {
    const next = this.inputSourceVisibility[sourceId] === false;
    this.inputSourceVisibility[sourceId] = next;
    if (next) this.inputs = this.inputs.map((input) => input.source === sourceId && input.state === 'hidden' ? { ...input, state: 'pending' } : input);
    await this.log('source_state_changed', { source: sourceId, purpose: 'input_filter', visible: next });
  }

  enableConfiguredSource(sourceId: string): void {
    if (!this.settingsState.sourceAvailable(sourceId)) return;
    this.sourceStates[sourceId] = 'visible';
    this.inputSourceVisibility[sourceId] = true;
  }

  syncAvailableSources(): void {
    for (const source of this.settingsState.sources) {
      if (!(source.id in this.sourceStates)) this.sourceStates[source.id] = source.kind === 'local' ? 'visible' : 'off';
      if (!(source.id in this.inputSourceVisibility)) this.inputSourceVisibility[source.id] = true;
      if (!this.settingsState.sourceAvailable(source.id)) this.sourceStates[source.id] = 'off';
    }
  }

  sourceAvailable(sourceId: string): boolean {
    return this.settingsState.sourceAvailable(sourceId);
  }

  toggleCategory(category: Category): void {
    this.categoryVisibility[category] = !this.categoryVisibility[category];
  }

  private beginAIActivity(prompt: TaskPrompt, scope: 'document' | 'selection', explicitIntent?: AIInteractionIntent): AIActivityRecord {
    const intent: AIInteractionIntent = explicitIntent ?? (prompt.id === 'sentinel' ? 'review' : 'revise');
    const activity: AIActivityRecord = {
      id: makeId('activity'),
      documentId: this.branchId,
      scope,
      intent,
      actionId: prompt.id,
      actionVersion: prompt.version,
      state: 'running',
      runIds: [],
      createdAt: new Date().toISOString()
    };
    this.activities = [...this.activities, activity].slice(-100);
    return activity;
  }

  private refreshAIActivity(activityId: string): void {
    const activity = this.activities.find((item) => item.id === activityId);
    if (!activity) return;
    const runs = this.runs.filter((run) => run.activityId === activityId || (!run.activityId && run.batchId === activityId));
    const running = runs.some((run) => run.state === 'running' || run.state === 'queued');
    const completed = runs.some((run) => run.state === 'completed' || run.state === 'partial');
    const partial = runs.some((run) => run.state === 'partial');
    const failed = runs.some((run) => run.state === 'failed');
    const discarded = runs.some((run) => run.state === 'discarded');
    const cancelled = runs.some((run) => run.state === 'cancelled');
    const state = running ? 'running'
      : partial || completed && (failed || discarded || cancelled) ? 'partial'
        : failed ? 'failed'
          : discarded ? 'discarded'
            : cancelled ? 'cancelled'
              : 'completed';
    this.activities = this.activities.map((item) => item.id === activityId ? {
      ...item,
      state,
      runIds: runs.map((run) => run.id),
      completedAt: state === 'running' ? undefined : new Date().toISOString()
    } : item);
  }

  private reconcileInterruptedRuns(): number {
    const interrupted = this.runs.filter((run) => run.state === 'queued' || run.state === 'running');
    if (!interrupted.length) return 0;
    const completedSources = new Map<string, Set<string>>();
    for (const run of interrupted) {
      completedSources.set(run.id, new Set(run.proposalIds.flatMap((id) => {
        const input = this.inputs.find((item) => item.id === id);
        return input ? [input.source] : [];
      })));
    }
    const completedAt = new Date().toISOString();
    this.runs = this.runs.map((run) => {
      if (run.state !== 'queued' && run.state !== 'running') return run;
      const succeeded = completedSources.get(run.id) ?? new Set<string>();
      const existing = new Set(run.errors.map((error) => error.source));
      const interruptedSources = Object.entries(run.sourceStates)
        .filter(([sourceId, state]) => state !== 'off' && !succeeded.has(sourceId) && !existing.has(sourceId))
        .map(([sourceId]) => sourceId);
      const sources = interruptedSources.length ? interruptedSources : ['interaction_service'];
      return {
        ...run,
        state: run.proposalIds.length ? 'partial' as const : 'failed' as const,
        errors: [...run.errors, ...sources.map((source) => ({
          source,
          kind: 'provider_request' as const,
          classification: 'interrupted' as const,
          recoveryAction: 'retry_transient' as const,
          recovered: false,
          message: 'The previous session ended before this passage reached a durable outcome.'
        }))],
        completedAt
      };
    });
    for (const activityId of new Set(interrupted.map((run) => run.activityId).filter(Boolean) as string[])) {
      this.refreshAIActivity(activityId);
    }
    return interrupted.length;
  }

  async completeInterruptedRun(runId: string): Promise<void> {
    const run = this.runs.find((item) => item.id === runId);
    if (!run || !run.errors.some((error) => error.classification === 'interrupted' && !error.recovered)) return;
    this.runs = this.runs.map((item) => item.id === runId ? {
      ...item,
      state: 'discarded',
      errors: item.errors.map((error) => error.classification === 'interrupted'
        ? { ...error, recovered: true, outcome: 'rejected' as const }
        : error),
      completedAt: new Date().toISOString()
    } : item);
    if (run.activityId) this.refreshAIActivity(run.activityId);
    await this.persistDomainState('Complete interrupted AI run without retry');
  }

  private actionSnapshot(prompt: TaskPrompt, intent: AIInteractionIntent): AIActionSnapshot {
    return {
      id: prompt.id,
      name: prompt.name,
      version: prompt.version,
      intent,
      instruction: prompt.instruction
    };
  }

  private definitionSnapshot(action: AIActionDefinition, scope: AIActionTargetScope): AIActionSnapshot {
    return {
      id: action.id,
      name: action.name,
      version: action.version,
      intent: action.intent,
      instruction: action.instruction,
      responseContract: action.responseContract,
      targetScope: scope,
      optionCount: action.optionCount,
      includeExplanation: action.includeExplanation,
      inputCategory: action.inputCategory,
      maxOutputTokens: action.maxOutputTokens,
      temperature: action.temperature
    };
  }

  private contextManifest(
    action: AIActionSnapshot,
    target: AIContextManifest['target'],
    selection: AIContextSelection = defaultAIContextSelection
  ): AIContextManifest {
    const items: AIContextItem[] = [
      {
        id: `action:${action.id}:v${action.version}`,
        sourceType: 'action',
        sourceId: action.id,
        sourceRevision: action.version,
        role: 'protocol',
        title: action.name,
        content: action.instruction,
        reason: 'Selected AI action',
        inclusion: 'required',
        sent: true
      },
      {
        id: `target:${target.documentId}:${target.sourceRevision}`,
        sourceType: 'manuscript',
        sourceId: target.documentId,
        sourceRevision: target.sourceRevision,
        role: 'target',
        title: this.currentDocument?.role === 'spine' ? 'Spine (including story brief)' : this.currentDocument?.title ?? 'Current passage',
        content: target.exactText,
        reason: 'Exact captured request target',
        inclusion: 'required',
        sent: true
      }
    ];
    const addDocument = (
      document: WorkspaceDocument | null,
      sourceType: 'spine' | 'material',
      role: 'constraint' | 'fact',
      reason: string,
      inclusion: AIContextItem['inclusion'] = 'resolved',
      sent = true
    ) => {
      if (!document || document.id === target.documentId || (sourceType !== 'spine' && !document.content.trim())) return;
      items.push({
        id: `${sourceType}:${document.id}:${document.revision}`,
        sourceType,
        sourceId: document.id,
        sourceRevision: document.revision,
        role,
        title: sourceType === 'spine' ? 'Spine (including story brief)' : document.title,
        content: document.content,
        reason,
        inclusion,
        sent,
        ...(sent ? {} : { omissionReason: 'writer_excluded' as const })
      });
    };
    addDocument(this.spineNode, 'spine', 'constraint', 'Protected project Spine', 'required');
    if (this.navigatorFocusNode?.role !== 'spine') {
      addDocument(this.navigatorFocusNode, 'material', 'fact', 'Selected Navigator Material', 'resolved', selection.includeMaterial);
    }
    for (const bucket of this.currentContext) {
      const role = bucket.role === 'constraint' || bucket.role === 'fact' || bucket.role === 'guidance' || bucket.role === 'reference'
        ? bucket.role
        : 'reference';
      items.push({
        id: `material:${bucket.id}:${bucket.revision}`,
        sourceType: 'material',
        sourceId: bucket.id,
        sourceRevision: bucket.revision,
        role,
        title: bucket.title,
        content: bucket.content,
        reason: bucket.scope === 'project' ? 'Applicable project context' : 'Applicable document context',
        inclusion: 'resolved',
        sent: selection.includeMaterial,
        ...(selection.includeMaterial ? {} : { omissionReason: 'writer_excluded' as const })
      });
    }
    for (const relationship of this.selectedNodeRelations) {
      items.push({
        id: `relationship:${relationship.relationshipId}:${this.navigator.revision}`,
        sourceType: 'relationship',
        sourceId: relationship.relationshipId,
        sourceRevision: this.navigator.revision,
        role: 'fact',
        title: relationship.label,
        content: `${relationship.label}: ${relationship.node.title}${relationship.note ? `\n${relationship.note}` : ''}`,
        reason: 'Direct confirmed relationship of the selected Navigator item',
        inclusion: 'resolved',
        sent: selection.includeRelationships,
        ...(selection.includeRelationships ? {} : { omissionReason: 'writer_excluded' as const })
      });
    }
    for (const todo of this.selectedNodeTodos.filter((item) => item.state === 'open')) {
      const todoDocument = this.todoNode(todo.id);
      items.push({
        id: `todo:${todo.id}:${this.navigator.revision}`,
        sourceType: 'todo',
        sourceId: todo.id,
        sourceRevision: todoDocument?.revision ?? this.navigator.revision,
        role: 'guidance',
        title: todo.title,
        content: todoDocument?.content.trim() || todo.title,
        reason: 'Open Todo attached to the selected Navigator item',
        inclusion: 'resolved',
        sent: selection.includeTodos,
        ...(selection.includeTodos ? {} : { omissionReason: 'writer_excluded' as const })
      });
    }
    for (const sourceId of selection.addedSourceIds) {
      addDocument(
        this.projectNodes.find((document) => document.id === sourceId) ?? null,
        'material',
        'fact',
        'Writer-added Material',
        'writer_added'
      );
    }
    return {
      workspaceRevision: this.workspaceRevision,
      forkId: this.branchId,
      target,
      items: [...new Map(items.map((item) => [item.id, item])).values()]
    };
  }

  reviewContextPreview(prompt: TaskPrompt, selection: AIContextSelection): AIContextManifest | null {
    const document = this.currentDocument;
    if (!document) return null;
    const text = document.content;
    return this.contextManifest(this.actionSnapshot(prompt, 'review'), {
      documentId: document.id,
      sourceRevision: this.workspaceRevision,
      target: textTarget(document.id, 0, text.length, text),
      exactText: text
    }, selection);
  }

  async runCraftPass(
    prompt: TaskPrompt,
    contextSelection: AIContextSelection = this.contextSelection(prompt.id),
    onProgress?: (inputs: Suggestion[]) => void
  ): Promise<Suggestion[]> {
    if (!this.documentSnapshot) return [];
    const activity = this.beginAIActivity(prompt, 'document');
    const ranges = documentCraftParagraphs(this.documentSnapshot);
    if (!ranges.length) {
      this.refreshAIActivity(activity.id);
      await this.persistDomainState('Complete empty AI activity');
      return [];
    }
    const enabledSources = Object.entries(this.sourceStates).filter(([, state]) => state !== 'off');
    if (!enabledSources.length) {
      this.refreshAIActivity(activity.id);
      await this.persistDomainState('Complete AI activity without sources');
      return [];
    }
    const isolatedSourceStates = (activeSourceId: string): Record<string, SourceState> => Object.fromEntries(
      Object.entries(this.sourceStates).map(([sourceId, state]) => [sourceId, sourceId === activeSourceId ? state : 'off'])
    );
    const results = await Promise.all(ranges.flatMap((range) => enabledSources.map(async ([sourceId]) => {
      const inputs = await this.requestInputRun(
        { ...range, prompt },
        `${this.branchId}:${sourceId}:paragraph:${range.from}:${range.to}`,
        activity,
        isolatedSourceStates(sourceId),
        contextSelection
      );
      onProgress?.(inputs);
      return inputs;
    })));
    return results.flat();
  }

  async runSelectionPass(range: DocumentRange, prompt: TaskPrompt): Promise<Suggestion[]> {
    if (!this.documentSnapshot) return [];
    const canonicalText = documentTextBetween(this.documentSnapshot, range.from, range.to);
    if (canonicalText !== range.text) {
      this.notice = 'The selection changed before the run began. Select it again.';
      return [];
    }
    const activity = this.beginAIActivity(prompt, 'selection');
    return this.requestInputRun(
      { ...range, prompt },
      `${this.branchId}:selection:${range.from}:${range.to}`,
      activity
    );
  }

  actionContextPreview(action: AIActionDefinition, scope: AIActionTargetScope, range: DocumentRange | null, selection: AIContextSelection): AIContextManifest | null {
    const document = this.currentDocument;
    if (!document) return null;
    const targetRange = scope === 'selection' ? range : this.documentSnapshot ? completeDocumentRange(this.documentSnapshot) : null;
    if (!targetRange?.text.trim()) return null;
    return this.contextManifest(this.definitionSnapshot(action, scope), {
      documentId: document.id,
      sourceRevision: this.workspaceRevision,
      target: textTarget(document.id, targetRange.from, targetRange.to, targetRange.text),
      exactText: targetRange.text
    }, selection);
  }

  async runAIAction(
    action: AIActionDefinition,
    scope: AIActionTargetScope,
    range: DocumentRange | null,
    contextSelection: AIContextSelection = this.actionContextSelection(action)
  ): Promise<Suggestion[]> {
    const document = this.currentDocument;
    if (!document || !action.allowedTargets.includes(scope)) return [];
    const targetRange = scope === 'selection' ? range : this.documentSnapshot ? completeDocumentRange(this.documentSnapshot) : null;
    if (!targetRange?.text.trim() || (action.requiresSelection && scope !== 'selection')) {
      this.notice = action.requiresSelection ? 'This action requires a text selection.' : 'The selected target is empty.';
      return [];
    }
    const canonicalText = this.documentSnapshot ? documentTextBetween(this.documentSnapshot, targetRange.from, targetRange.to) : null;
    if (canonicalText !== targetRange.text) {
      this.notice = 'The target changed before the action began. Select it again.';
      return [];
    }
    const availableAI = this.settingsState.sources.filter((source) => source.number >= 3
      && this.sourceStates[source.id] !== 'off'
      && this.settingsState.sourceAvailable(source.id));
    const selected = action.preferredSourceId
      ? availableAI.filter((source) => source.id === action.preferredSourceId)
      : availableAI;
    if (!selected.length) {
      this.notice = action.preferredSourceId
        ? 'The provider assigned to this action is unavailable or not enabled.'
        : 'Enable at least one configured AI provider before running this action.';
      return [];
    }
    const sourceIds = new Set(selected.map((source) => source.id));
    const sourceStates = Object.fromEntries(this.settingsState.sources.map((source) => [
      source.id,
      sourceIds.has(source.id) ? 'visible' : 'off'
    ])) as Record<string, SourceState>;
    const prompt: TaskPrompt = { id: action.id, name: action.name, version: action.version, instruction: action.instruction };
    const activity = this.beginAIActivity(prompt, scope, action.intent);
    return this.requestInputRun(
      { ...targetRange, prompt },
      `${this.branchId}:action:${action.id}:${targetRange.from}:${targetRange.to}`,
      activity,
      sourceStates,
      contextSelection,
      { action: this.definitionSnapshot(action, scope) }
    );
  }

  canRecoverRun(runId: string): boolean {
    const run = this.runs.find((item) => item.id === runId);
    if (!run?.request || !this.aiService.recover) return false;
    const latestBySource = new Map<string, InputError>();
    for (const error of run.errors) if (error.kind === 'provider_output' && error.rawOutput) latestBySource.set(error.source, error);
    return [...latestBySource.values()].some((error) => !error.localReplay && (!error.recovered || run.proposalIds.length === 0));
  }

  async recoverRun(runId: string): Promise<Suggestion[]> {
    const run = this.runs.find((item) => item.id === runId);
    if (!run?.request || !this.aiService.recover || !this.canRecoverRun(runId)) return [];
    const target = firstTextTarget(run.target);
    const currentText = target && this.documentSnapshot
      ? documentTextBetween(this.documentSnapshot, target.start, target.end)
      : null;
    if (!target || currentText !== run.originalText) {
      this.notice = 'That retained response no longer matches its captured passage and cannot be recovered.';
      return [];
    }
    const latestBySource = new Map<string, InputError>();
    for (const error of run.errors) if (error.kind === 'provider_output' && error.rawOutput) latestBySource.set(error.source, error);
    const retained = [...latestBySource.values()].filter((error) =>
      !error.localReplay && (!error.recovered || run.proposalIds.length === 0));
    const response = await this.aiService.recover(run.request, retained);
    const proposals = response.proposals.filter((proposal) =>
      run.permittedProposalKinds?.includes(proposal.kind) && isInputProposalPayload(proposal.payload));
    const adopted = proposals.flatMap((proposal) => {
      const input = this.adoptProposal(proposal.payload as InputProposal, run, target.start, proposal.kind);
      return input ? [input] : [];
    });
    const returnedProposalSources = new Set(response.proposals.flatMap((proposal) => {
      const payload = proposal.payload as Partial<InputProposal> | undefined;
      return typeof payload?.source === 'string' ? [payload.source] : [];
    }));
    const adoptedSources = new Set(adopted.map((input) => input.source));
    const recoveredSources = new Set([
      ...adoptedSources,
      ...response.diagnostics
        .filter((diagnostic) => diagnostic.recovered && !returnedProposalSources.has(diagnostic.source))
        .map((diagnostic) => diagnostic.source)
    ]);
    const adoptionDiagnostics: AIServiceDiagnostic[] = [...returnedProposalSources]
      .filter((source) => !adoptedSources.has(source))
      .map((source) => ({
        source,
        kind: 'contract',
        classification: 'contract',
        recoveryAction: 'human',
        recovered: false,
        outcome: 'rejected',
        message: 'The retained response parsed, but its proposal failed current local target validation.'
      }));
    const updatedErrors = run.errors.map((error) => recoveredSources.has(error.source) && error.kind === 'provider_output'
      ? { ...error, recovered: true, outcome: 'repaired_locally' as const, recoveryAction: 'repair_local' as const }
      : error);
    const remainingFailures = updatedErrors.some((error) => !error.recovered);
    this.runs = this.runs.map((item) => item.id === runId ? {
      ...item,
      state: remainingFailures ? (adopted.length ? 'partial' : 'failed') : 'completed',
      proposalIds: [...new Set([...item.proposalIds, ...adopted.map((input) => input.id)])],
      errors: [...updatedErrors, ...response.diagnostics, ...adoptionDiagnostics],
      completedAt: new Date().toISOString()
    } : item);
    if (run.activityId) this.refreshAIActivity(run.activityId);
    await this.coalesceSuggestions([...this.suggestions, ...adopted]);
    for (const input of adopted) {
      await this.log(input.state === 'hidden' ? 'generated_hidden' : 'suggestion_generated', {
        runId,
        recoveredLocally: true,
        suggestion: input
      }, input.id);
    }
    const failedRecovery = [...new Map([...response.diagnostics, ...adoptionDiagnostics]
      .filter((diagnostic) => !diagnostic.recovered)
      .map((diagnostic) => [diagnostic.source, diagnostic])).values()];
    this.notice = adopted.length
      ? `${adopted.length} retained ${adopted.length === 1 ? 'Input was' : 'Inputs were'} recovered locally.${failedRecovery.length ? ` ${failedRecovery.map((item) => `${item.source}: ${item.message}`).join(' · ')}` : ''} No provider was called.`
      : `${failedRecovery.map((item) => `${item.source}: ${item.message}`).join(' · ') || 'The retained responses could not be recovered locally.'} No provider was called.`;
    return adopted;
  }

  async retryRun(runId: string): Promise<Suggestion[]> {
    const previous = this.runs.find((run) => run.id === runId);
    if (!previous || (previous.state !== 'failed' && previous.state !== 'partial')) return [];
    const target = firstTextTarget(previous.target);
    const currentText = target && this.documentSnapshot
      ? documentTextBetween(this.documentSnapshot, target.start, target.end)
      : null;
    if (!target || currentText !== previous.originalText) {
      this.notice = 'That failed run no longer matches the current passage and cannot be retried.';
      return [];
    }
    const capturedAction = previous.request?.action;
    const prompt: TaskPrompt = capturedAction ? {
      id: capturedAction.id,
      name: capturedAction.name,
      version: capturedAction.version,
      instruction: capturedAction.instruction
    } : this.prompts.find((item) => item.id === previous.promptId) ?? {
      id: previous.promptId,
      name: previous.promptId,
      version: previous.promptVersion,
      instruction: 'Repeat the failed request.'
    };
    const activity = this.beginAIActivity(prompt, previous.scope ?? 'selection');
    const failedSources = new Set(previous.errors.filter((error) => !error.recovered).map((error) => error.source));
    if (!this.settingsState.sources.some((source) => failedSources.has(source.id) && this.settingsState.sourceAvailable(source.id))) {
      this.activities = this.activities.filter((item) => item.id !== activity.id);
      this.notice = 'No currently configured provider matches this failed run.';
      return [];
    }
    const retrySourceStates = Object.fromEntries(this.settingsState.sources.map((source) => [
      source.id,
      failedSources.has(source.id) ? 'visible' : 'off'
    ])) as Record<string, SourceState>;
    const result = await this.requestInputRun(
      { from: target.start, to: target.end, text: previous.originalText, prompt },
      `${this.branchId}:retry:${previous.id}`,
      activity,
      retrySourceStates,
      defaultAIContextSelection,
      { action: capturedAction }
    );
    const retry = this.runs.find((run) => run.activityId === activity.id);
    if (retry && (retry.state === 'completed' || retry.state === 'partial')) {
      const stillFailed = new Set(retry.errors.filter((error) => !error.recovered).map((error) => error.source));
      this.runs = this.runs.map((run) => run.id === previous.id ? {
        ...run,
        errors: run.errors.map((error) => failedSources.has(error.source) && !stillFailed.has(error.source)
          ? { ...error, recovered: true, outcome: 'recovered_by_retry' as const }
          : error)
      } : run);
      await this.persistDomainState('Link successful retry to failed run');
    }
    return result;
  }

  private async requestInputRun(
    input: Omit<GenerationRequest, 'sessionId' | 'branchId' | 'brief' | 'sourceStates' | 'mode'>,
    rangeKey: string,
    activity: AIActivityRecord,
    requestedSourceStates: Record<string, SourceState> = this.sourceStates,
    contextSelection: AIContextSelection = defaultAIContextSelection,
    configuration: { action?: AIActionSnapshot } = {}
  ): Promise<Suggestion[]> {
    if (this.paused) return [];
    this.dispatches.get(rangeKey)?.abort();
    const replacedRunId = this.dispatchRunIds.get(rangeKey);
    const replacedRun = replacedRunId ? this.runs.find((run) => run.id === replacedRunId) : undefined;
    if (replacedRunId) {
      this.runs = this.runs.map((run) => run.id === replacedRunId && run.state === 'running'
        ? { ...run, state: 'cancelled', completedAt: new Date().toISOString() }
        : run);
      if (replacedRun?.activityId) this.refreshAIActivity(replacedRun.activityId);
    }
    const controller = new AbortController();
    const intent = activity.intent;
    const action = configuration.action ?? this.actionSnapshot(input.prompt, intent);
    const permittedProposalKinds = [proposalKindForAction(action)];
    const capturedTarget = {
      documentId: this.branchId,
      sourceRevision: this.workspaceRevision,
      target: textTarget(this.branchId, input.from, input.to, input.text),
      exactText: input.text
    };
    const context = this.contextManifest(action, capturedTarget, contextSelection);
    const run: CraftRun = {
      id: makeId('run'),
      batchId: activity.id,
      activityId: activity.id,
      scope: activity.scope,
      documentId: this.branchId,
      sourceRevision: this.workspaceRevision,
      target: capturedTarget.target,
      originalText: input.text,
      promptId: input.prompt.id,
      promptVersion: input.prompt.version,
      intent,
      requestedContextManifest: context,
      contextManifest: context,
      permittedProposalKinds,
      sourceStates: { ...requestedSourceStates },
      state: 'running',
      proposalIds: [],
      errors: [],
      createdAt: new Date().toISOString()
    };
    this.runs = [...this.runs, run].slice(-200);
    this.activities = this.activities.map((item) => item.id === activity.id
      ? { ...item, runIds: [...item.runIds, run.id] }
      : item);
    this.dispatches.set(rangeKey, controller);
    this.dispatchRunIds.set(rangeKey, run.id);
    this.generating = true;
    await this.log('suggestions_requested', { runId: run.id, batchId: run.batchId, scope: run.scope, range: [input.from, input.to], promptId: input.prompt.id, characters: input.text.length });
    try {
      const request: AIInteractionRequest = {
        activityId: activity.id,
        runId: run.id,
        sessionId: this.sessionId,
        projectId: this.projectId,
        documentId: this.branchId,
        intent,
        action,
        target: capturedTarget,
        context,
        permittedProposalKinds,
        sources: this.settingsState.sources.map((source) => ({
          sourceId: source.id,
          participation: requestedSourceStates[source.id] ?? 'off',
          model: this.settingsState.sourceAvailability[source.id]?.model
        })),
        generation: {
          brief: { ...this.brief },
          mode: this.mode
        }
      };
      this.runs = this.runs.map((item) => item.id === run.id ? { ...item, request } : item);
      const response = await this.aiService.execute(request, controller.signal);
      const providerUsage = response.usage ?? [];
      if (providerUsage.length) {
        this.runs = this.runs.map((item) => item.id === run.id ? { ...item, usage: [...(item.usage ?? []), ...providerUsage] } : item);
      }
      for (const usage of providerUsage) {
        await this.log('provider_usage_recorded', { runId: run.id, activityId: activity.id, usage });
      }
      if (providerUsage.length) await this.refreshLedger();
      const contractDiagnostics: AIServiceDiagnostic[] = [];
      if (!validReturnedContext(request.context, response.context)) {
        contractDiagnostics.push({
          source: 'interaction_service',
          kind: 'contract' as const,
          recovered: false,
          outcome: 'rejected' as const,
          message: 'AI service returned hidden, altered, or incomplete Writing Context.'
        });
      }
      const proposals: Array<{ kind: string; payload: InputProposal }> = [];
      for (const proposal of response.proposals) {
        if (!request.permittedProposalKinds.includes(proposal.kind) || !isInputProposalPayload(proposal.payload)) {
          contractDiagnostics.push({
            source: 'interaction_service',
            kind: 'contract' as const,
            recovered: false,
            outcome: 'rejected' as const,
            message: `AI service returned an invalid or unpermitted proposal kind: ${proposal.kind || '(missing)'}.`
          });
          continue;
        }
        proposals.push({ kind: proposal.kind, payload: proposal.payload });
      }
      const diagnostics = [...response.diagnostics, ...contractDiagnostics];
      const outputDiagnostics = diagnostics.filter((item) => item.kind === 'provider_output');
      const actionableErrors = diagnostics.filter((item) => item.kind !== 'provider_output');
      for (const diagnostic of outputDiagnostics) {
        const details = {
          runId: run.id,
          documentId: this.branchId,
          ...diagnostic
        };
        if (diagnostic.recovered) console.info('[Margin Note] Provider output normalized', details);
        else console.warn('[Margin Note] Malformed provider output', details);
      }
      if (actionableErrors.length) this.notice = actionableErrors.map((item) => `${item.source}: ${item.message}`).join(' · ');
      const currentRun = this.runs.find((item) => item.id === run.id);
      const target = currentRun ? firstTextTarget(currentRun.target) : null;
      const currentText = target && this.documentSnapshot
        ? documentTextBetween(this.documentSnapshot, target.start, target.end)
        : null;
      if (!currentRun || currentRun.state !== 'running' || !target || currentText !== currentRun.originalText) {
        this.runs = this.runs.map((item) => item.id === run.id
          ? { ...item, state: 'discarded', errors: diagnostics, completedAt: new Date().toISOString() }
          : item);
        this.refreshAIActivity(activity.id);
        await this.persistDomainState('Discard stale craft run');
        this.notice = 'The passage changed while the craft pass was running, so its proposals were safely discarded.';
        return [];
      }
      const adopted = (contractDiagnostics.some((diagnostic) => diagnostic.message.includes('Writing Context')) ? [] : proposals).flatMap((proposal) => {
        const inputRecord = this.adoptProposal(proposal.payload, currentRun, target.start, proposal.kind);
        return inputRecord ? [inputRecord] : [];
      });
      this.runs = this.runs.map((item) => item.id === run.id ? {
        ...item,
        state: diagnostics.some((error) => !error.recovered) ? (adopted.length ? 'partial' : 'failed') : 'completed',
        proposalIds: adopted.map((item) => item.id),
        errors: diagnostics,
        contextManifest: response.context,
        completedAt: new Date().toISOString()
      } : item);
      this.refreshAIActivity(activity.id);
      await this.coalesceSuggestions([...this.suggestions, ...adopted]);
      for (const suggestion of adopted) {
        await this.log(suggestion.state === 'hidden' ? 'generated_hidden' : 'suggestion_generated', {
          runId: run.id,
          suggestion
        }, suggestion.id);
      }
      await this.refreshLedger();
      return adopted.filter((suggestion) => this.suggestions.some((item) => item.id === suggestion.id && (item.state === 'pending' || item.state === 'hidden')));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        this.runs = this.runs.map((item) => item.id === run.id ? { ...item, state: 'cancelled', completedAt: new Date().toISOString() } : item);
        this.refreshAIActivity(activity.id);
        await this.persistDomainState('Cancel craft run');
        return [];
      }
      this.runs = this.runs.map((item) => item.id === run.id ? {
        ...item,
        state: 'failed',
        errors: [{ source: 'transport', message: error instanceof Error ? error.message : 'Input request failed' }],
        completedAt: new Date().toISOString()
      } : item);
      this.refreshAIActivity(activity.id);
      await this.persistDomainState('Record failed craft run');
      this.lastError = error instanceof Error ? error.message : 'Suggestion request failed';
      return [];
    } finally {
      if (this.dispatches.get(rangeKey) === controller) this.dispatches.delete(rangeKey);
      if (this.dispatchRunIds.get(rangeKey) === run.id) this.dispatchRunIds.delete(rangeKey);
      this.generating = this.dispatches.size > 0;
    }
  }

  private adoptProposal(proposal: InputProposal, run: CraftRun, currentStart: number, kind = 'craft_input'): Suggestion | null {
    const insertion = proposal.type === 'insertion' && proposal.from === proposal.to && proposal.sourceText === '';
    const capturedRequestTarget = proposal.anchorStatus === 'request_scope' || proposal.anchorStatus === 'unanchored';
    if (capturedRequestTarget) {
      if (proposal.from !== 0 || proposal.to !== run.originalText.length || proposal.sourceText !== run.originalText) return null;
    } else if (!insertion && !isExactTextSpan(run.originalText, proposal.from, proposal.to, proposal.sourceText)) return null;
    if (insertion && (proposal.from < 0 || proposal.from > run.originalText.length)) return null;
    const id = makeId('input');
    const capturedTarget = capturedRequestTarget ? firstTextTarget(run.target) : null;
    if (capturedRequestTarget && (!capturedTarget || capturedTarget.nodeId !== this.branchId)) return null;
    const from = capturedTarget?.start ?? currentStart + proposal.from;
    const to = capturedTarget?.end ?? currentStart + proposal.to;
    const variants = proposal.variants
      .filter((text) => text !== proposal.sourceText)
      .map((text, index) => ({ id: `${id}_v${index + 1}`, text, confidence: Math.max(0.45, proposal.confidence - index * 0.04) }));
    const type = proposal.type === 'replacement' && !variants.length ? 'annotation' : proposal.type;
    return {
      id,
      kind,
      source: proposal.source,
      sourceNumber: proposal.sourceNumber,
      sourceKind: proposal.sourceKind,
      target: textTarget(this.branchId, from, to, proposal.sourceText),
      behaviourId: 'craft-input',
      events: [],
      anchor: { from, to, text: proposal.sourceText },
      anchorStatus: proposal.anchorStatus ?? 'exact',
      type,
      payload: { text: variants[0]?.text, comment: proposal.comment },
      category: proposal.category,
      confidence: proposal.confidence,
      variants,
      state: 'pending',
      order: from,
      createdAt: new Date().toISOString(),
      provenance: {
        ...proposal.provenance,
        activityId: run.activityId ?? run.batchId,
        runId: run.id,
        actionId: run.promptId,
        actionVersion: run.promptVersion,
        contextManifestId: run.id
      }
    };
  }

  activate(id: string | null): void { this.activeSuggestionId = id; }
  setPreview(suggestionId: string, text: string): void { this.preview = { suggestionId, text }; }
  clearPreview(): void { this.preview = null; }

  async bindInputToSelection(id: string, from: number, to: number, selectedText: string): Promise<boolean> {
    const input = this.inputs.find((item) => item.id === id);
    if (!input || input.anchorStatus !== 'unanchored' || !this.documentSnapshot) return false;
    if (from >= to || !selectedText || documentTextBetween(this.documentSnapshot, from, to) !== selectedText) {
      this.notice = 'Select the exact text this Input should apply to, then attach it again.';
      return false;
    }
    const before = this.historySnapshot(this.documentSnapshot);
    const transactionId = makeId('transaction');
    this.inputs = this.inputs.map((item) => item.id === id ? {
      ...item,
      target: textTarget(this.branchId, from, to, selectedText),
      anchor: { from, to, text: selectedText },
      anchorStatus: 'exact',
      order: from,
      events: [...item.events, {
        type: 'reattached',
        revision: this.workspaceRevision + 1,
        transactionId,
        previousTarget: item.target,
        previousExcerpt: item.anchor.text
      }]
    } : item);
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({
      id: transactionId,
      source: 'input',
      label: 'Attach Input to selection',
      before,
      after,
      createdAt: Date.now()
    });
    await this.persistDomainState('Attach Input to selection');
    return true;
  }

  async resolveSuggestion(id: string, state: 'accepted' | 'rejected' | 'stale', eventType: LedgerEvent['type'], payload: Record<string, unknown> = {}): Promise<void> {
    const suggestion = this.suggestions.find((item) => item.id === id);
    if (!suggestion) return;
    await this.setInputState(id, state, `Set input ${state}`);
    if (this.activeSuggestionId === id) this.activeSuggestionId = null;
    await this.log(eventType, { category: suggestion.category, source: suggestion.source, ...payload }, id);
  }

  async supersedeSiblings(suggestion: Suggestion, selectedVariantId: string): Promise<void> {
    for (const variant of suggestion.variants) {
      if (variant.id !== selectedVariantId) await this.log('superseded_by', { winner: selectedVariantId, supersededVariant: variant.id, source: suggestion.source }, suggestion.id);
    }
  }

  async moveInput(id: string, targetId: string, position: 'before' | 'after'): Promise<void> {
    if (id === targetId || !this.documentSnapshot) return;
    const live = this.suggestions.filter((suggestion) => suggestion.state === 'pending').sort((a, b) => a.order - b.order);
    const moving = live.find((suggestion) => suggestion.id === id);
    if (!moving || !live.some((suggestion) => suggestion.id === targetId)) return;
    const before = this.historySnapshot(this.documentSnapshot);
    const reordered = live.filter((suggestion) => suggestion.id !== id);
    const targetIndex = reordered.findIndex((suggestion) => suggestion.id === targetId);
    reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moving);
    const orders = new Map(reordered.map((suggestion, order) => [suggestion.id, order]));
    this.inputs = this.inputs.map((suggestion) => orders.has(suggestion.id) ? { ...suggestion, order: orders.get(suggestion.id)! } : suggestion);
    this.workspaceRevision += 1;
    const after = this.historySnapshot(this.documentSnapshot);
    this.pushHistory({ id: makeId('transaction'), source: 'input', label: 'Reorder inputs', before, after, createdAt: Date.now() });
    await this.persistDomainState('Reorder inputs');
  }

  async moveInputOneStep(id: string, direction: -1 | 1): Promise<void> {
    const live = this.suggestions.filter((suggestion) => suggestion.state === 'pending').sort((a, b) => a.order - b.order);
    const index = live.findIndex((suggestion) => suggestion.id === id);
    const target = live[index + direction];
    if (!target) return;
    await this.moveInput(id, target.id, direction === -1 ? 'before' : 'after');
  }

  async saveBrief(next: WritingBrief): Promise<void> {
    const previous = this.brief;
    this.brief = { ...next, version: previous.version + 1 };
    await this.facade.saveBrief(this.brief, this.sessionId, this.branchId);
    const stale = this.suggestions.filter((suggestion) => suggestion.state === 'pending' && suggestion.provenance.briefVersion < this.brief.version);
    this.suggestions = this.suggestions.map((suggestion) => stale.some((item) => item.id === suggestion.id) ? { ...suggestion, state: 'stale' } : suggestion);
    for (const suggestion of stale) await this.log('expired_on_brief_change', { fromVersion: previous.version, toVersion: this.brief.version }, suggestion.id);
    await this.refreshLedger();
  }

  async savePrompt(next: TaskPrompt): Promise<void> {
    const current = this.prompts.find((prompt) => prompt.id === next.id);
    const value = { ...next, version: (current?.version ?? 0) + 1 };
    this.prompts = this.prompts.map((prompt) => prompt.id === value.id ? value : prompt);
    await this.facade.savePrompt(value, this.sessionId, this.branchId);
    await this.refreshLedger();
  }

  async addBranch(branch: Branch, content = ''): Promise<void> {
    const document = await this.facade.createDocument({
      id: branch.id,
      projectId: this.projectId,
      title: branch.name,
      content,
      role: 'manuscript',
      parentId: branch.parentId ?? null,
      createdBy: this.sessionId,
      reason: 'Forked document'
    });
    this.documents = [...this.documents, document];
    this.refreshBranches();
    await this.log('branch_forked', { name: branch.name, parentId: branch.parentId, wordCount: branch.wordCount });
  }

  async exportMarkdown(markdown: string, title?: string): Promise<MarkdownExport> {
    const result = await this.facade.exportMarkdown({ markdown, title, sessionId: this.sessionId, branchId: this.branchId });
    await this.refreshLedger();
    return result;
  }

  projectExportSnapshot(): ProjectExportSnapshot {
    const project = this.currentProject;
    if (!project) throw new Error('No project is open');
    const documents = this.projectNodes.map((document) => document.id === this.branchId
      ? { ...document, extensions: this.domainExtensions() }
      : document);
    return {
      project,
      documents,
      contextBuckets: this.contextBuckets.filter((bucket) => bucket.projectId === project.id),
      capturedAt: new Date().toISOString()
    };
  }

  exportProject(mode: ProjectExportMode = 'compact'): Promise<ProjectArchiveExport> {
    return this.facade.exportProject(this.projectExportSnapshot(), mode);
  }

  storageAnalysis(projectId = this.projectId): Promise<StorageAnalysis> {
    return this.facade.storageAnalysis(projectId);
  }

  uploadAsset(file: File): Promise<UploadedAsset> {
    return this.facade.uploadAsset(this.projectId, file);
  }

  async switchBranch(id: string): Promise<void> {
    if (id === this.branchId) return;
    const previous = this.branchId;
    const targetDocument = this.documents.find((document) => document.id === id);
    if (!targetDocument) throw new Error(`Document not found: ${id}`);
    this.branchId = id;
    const domainLoad = this.loadDocumentDomain(targetDocument);
    const interruptedRuns = this.reconcileInterruptedRuns();
    this.documentSnapshot = null;
    this.undoStack = [];
    this.redoStack = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('margin-note:document', id);
      localStorage.setItem('margin-note:branch', id);
    }
    if (interruptedRuns) this.notice = `${interruptedRuns} interrupted AI ${interruptedRuns === 1 ? 'passage needs' : 'passages need'} a retry or completion decision.`;
    if (domainLoad.realignedCapturedInputs) {
      this.notice = `${domainLoad.realignedCapturedInputs} saved AI ${domainLoad.realignedCapturedInputs === 1 ? 'input was' : 'inputs were'} realigned to the writer's captured selection.`;
    }
    if (domainLoad.archivedLegacyInputs || domainLoad.realignedCapturedInputs || interruptedRuns) {
      const reason = interruptedRuns
        ? 'Reconcile interrupted AI runs'
        : domainLoad.realignedCapturedInputs
          ? 'Realign captured AI input targets'
          : 'Archive legacy input targets';
      await this.persistDomainState(reason);
    }
    void this.facade.suggestionHistory(id).then((data) => {
      if (this.branchId !== id) return;
      this.ledger = data.events;
      this.costUsd = data.stats.costUsd;
    }).catch((error) => {
      if (this.branchId === id) this.lastError = error instanceof Error ? error.message : 'Could not load document history';
    });
    void this.log('branch_switched', { from: previous, to: id });
  }

  async switchProject(id: string): Promise<void> {
    if (id === this.projectId) return;
    this.projectId = id;
    this.navigatorUndoStack = [];
    this.navigatorRedoStack = [];
    this.navigator = readNavigatorState(this.currentProject);
    this.actions = normalizedAIActions(this.currentProject?.extensions.ai_actions);
    this.loadNavigatorMemory();
    await this.ensureProjectStructure();
    if (!Array.isArray(this.currentProject?.extensions.ai_actions)) await this.persistProjectActions();
    const document = this.projectNodes.find((item) => item.role === 'manuscript') ?? this.spineNode ?? this.todosNode;
    if (!document) throw new Error('Project has no document');
    if (typeof localStorage !== 'undefined') localStorage.setItem('margin-note:project', id);
    this.refreshBranches();
    await this.switchBranch(document.id);
  }

  async createProject(title: string): Promise<void> {
    const project = await this.facade.createProject(title);
    const document = await this.facade.createDocument({
      projectId: project.id,
      title: 'Spine',
      role: 'spine',
      createdBy: this.sessionId,
      reason: 'Initial project Spine'
    });
    const todos = await this.facade.createDocument({
      projectId: project.id,
      title: 'Todos',
      role: 'todos',
      createdBy: this.sessionId,
      reason: 'Initial project Todos'
    });
    this.projects = [...this.projects, project];
    this.documents = [...this.documents, document, todos];
    const persistent = await this.facade.persistentWorkspace();
    this.contextBuckets = persistent.contextBuckets;
    this.projectId = project.id;
    this.actions = cloneDefaultAIActions();
    this.navigator = emptyNavigatorState();
    this.navigatorMemory = emptyNavigatorMemory();
    this.navigatorUndoStack = [];
    this.navigatorRedoStack = [];
    this.saveNavigatorMemory();
    await this.persistProjectActions();
    if (typeof localStorage !== 'undefined') localStorage.setItem('margin-note:project', project.id);
    this.refreshBranches();
    await this.openNavigatorNode(document.id);
  }

  inspectProjectImport(file: File): Promise<ProjectImportPreview> {
    return this.facade.inspectProjectImport(file);
  }

  async importProject(file: File): Promise<ProjectImportPreview> {
    const result = await this.facade.importProject(file);
    this.projects = result.workspace.projects;
    this.documents = result.workspace.documents;
    this.contextBuckets = result.workspace.contextBuckets;
    await this.activatePersistedProject(result.projectId);
    return result.preview;
  }

  async deleteCurrentProject(): Promise<void> {
    const project = this.currentProject;
    if (!project) return;
    const documents = this.projectNodes;
    const result = await this.facade.deleteProject(project, documents);
    this.projects = result.workspace.projects;
    this.documents = result.workspace.documents;
    this.contextBuckets = result.workspace.contextBuckets;
    const nextProject = this.projects[0];
    if (!nextProject) throw new Error('Project deletion left no workspace project');
    await this.activatePersistedProject(nextProject.id);
    if (result.mirrorCleanupWarning) this.notice = result.mirrorCleanupWarning;
  }

  private async activatePersistedProject(projectId: string): Promise<void> {
    this.projectId = projectId;
    this.navigatorUndoStack = [];
    this.navigatorRedoStack = [];
    this.navigator = readNavigatorState(this.currentProject);
    this.actions = normalizedAIActions(this.currentProject?.extensions.ai_actions);
    this.loadNavigatorMemory();
    await this.ensureProjectStructure();
    if (!Array.isArray(this.currentProject?.extensions.ai_actions)) await this.persistProjectActions();
    const document = this.projectNodes.find((item) => item.role === 'manuscript') ?? this.spineNode ?? this.todosNode;
    if (!document) throw new Error('Project has no document');
    this.refreshBranches();
    await this.switchBranch(document.id);
    if (typeof localStorage !== 'undefined') localStorage.setItem('margin-note:project', projectId);
  }

  async createDocument(title: string): Promise<WorkspaceDocument> {
    const document = await this.facade.createDocument({
      projectId: this.projectId,
      title,
      role: 'manuscript',
      createdBy: this.sessionId
    });
    this.documents = [...this.documents, document];
    this.refreshBranches();
    return document;
  }

  async renameProject(title: string): Promise<void> {
    const project = this.currentProject;
    const nextTitle = title.trim();
    if (!project || !nextTitle || nextTitle === project.title) return;
    const saved = await this.facade.saveProject(project.id, nextTitle, project.extensions);
    this.projects = this.projects.map((item) => item.id === saved.id ? saved : item);
  }

  async resetCurrentProject(): Promise<void> {
    const project = this.currentProject;
    if (!project) return;
    const persistent = await this.facade.resetProject(project.id);
    this.projects = persistent.projects;
    this.documents = persistent.documents;
    this.contextBuckets = persistent.contextBuckets;
    this.navigator = emptyNavigatorState();
    this.actions = cloneDefaultAIActions();
    this.navigatorMemory = emptyNavigatorMemory();
    this.navigatorUndoStack = [];
    this.navigatorRedoStack = [];
    this.saveNavigatorMemory();
    await this.persistProjectActions();
    this.refreshBranches();
    const spine = this.spineNode;
    if (!spine) throw new Error('Reset project has no Spine');
    await this.openNavigatorNode(spine.id);
  }

  async createCollection(input: {
    name: string;
    singularName: string;
    icon?: CollectionDefinition['icon'];
    mayContainChildren?: boolean;
    numbering?: { enabled: boolean; start: number };
  }): Promise<CollectionDefinition | null> {
    const name = input.name.trim();
    const singularName = input.singularName.trim();
    if (!name || !singularName) return null;
    if (this.navigator.collections.some((collection) => collection.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
      this.notice = `${name} already exists.`;
      return null;
    }
    const collectionId = makeId('collection');
    const collectionNode = await this.facade.createDocument({
      id: collectionId,
      projectId: this.projectId,
      title: name,
      role: 'navigator_collection',
      extensions: nodeExtensions({}, collectionId, '', 'collection'),
      createdBy: this.sessionId,
      reason: 'Created content-bearing Collection'
    });
    this.documents = [...this.documents, collectionNode];
    this.refreshBranches();
    const collection: CollectionDefinition = {
      id: collectionId,
      name,
      singularName,
      order: this.navigator.collections.length,
      icon: input.icon ?? 'folder',
      numbering: input.numbering ?? { enabled: false, start: 1 },
      capabilities: { contentBearing: true, mayContainChildren: input.mayContainChildren ?? true }
    };
    await this.commitNavigator('Create Navigator collection', (state) => ({
      ...state,
      collections: [...state.collections, collection]
    }));
    this.setNavigatorExpanded(`collection:${collection.id}`, true, 'traditional');
    return collection;
  }

  async createNavigatorNode(collectionId: string, optionalTitle: string, parentId?: string | null): Promise<WorkspaceDocument | null> {
    const collection = this.navigator.collections.find((item) => item.id === collectionId);
    if (!collection || (!collection.numbering.enabled && !optionalTitle.trim())) return null;
    const resolvedParentId = parentId === undefined ? collection.id : parentId;
    if (resolvedParentId && !this.projectNodes.some((node) => node.id === resolvedParentId)) throw new Error('Navigator parent is not in this project');
    const siblings = this.navigatorNodes.filter((node) =>
      node.parentId === resolvedParentId && nodeCollectionId(node) === collection.id && !nodeArchived(node));
    const draft: WorkspaceDocument = {
      id: makeId('document'),
      projectId: this.projectId,
      parentId: resolvedParentId,
      title: optionalTitle.trim() || collection.singularName,
      order: Math.max(-1, ...siblings.map((node) => node.order)) + 1,
      revision: 1,
      role: 'navigator_node',
      extensions: nodeExtensions({}, collection.id, optionalTitle.trim()),
      kind: 'document',
      content: '',
      updatedAt: new Date().toISOString()
    };
    const title = itemDisplayName(draft, collection, [...siblings, draft]);
    const document = await this.facade.createDocument({
      id: draft.id,
      projectId: this.projectId,
      title,
      role: 'navigator_node',
      parentId: resolvedParentId,
      extensions: draft.extensions,
      createdBy: this.sessionId,
      reason: `Created ${collection.singularName}`
    });
    this.documents = [...this.documents, document];
    this.refreshBranches();
    this.setNavigatorExpanded(`collection:${collection.id}`, true, 'traditional');
    return document;
  }

  async updateCollection(collectionId: string, input: {
    name: string;
    singularName: string;
    icon: CollectionDefinition['icon'];
    numbering: { enabled: boolean; start: number };
  }): Promise<void> {
    const current = this.navigator.collections.find((collection) => collection.id === collectionId);
    const name = input.name.trim();
    const singularName = input.singularName.trim();
    if (!current || !name || !singularName) return;
    const next = { ...current, name, singularName, icon: input.icon, numbering: input.numbering };
    await this.commitNavigator('Update Collection', (state) => ({
      ...state,
      collections: state.collections.map((collection) => collection.id === collectionId ? next : collection)
    }));
    const collectionNode = this.collectionNode(collectionId);
    if (collectionNode && collectionNode.title !== name) {
      const saved = await this.facade.saveDocument({
        id: collectionNode.id,
        title: name,
        createdBy: this.sessionId,
        reason: 'Rename Collection'
      });
      this.documents = this.documents.map((document) => document.id === saved.id ? saved : document);
    }
    const members = this.navigatorNodes.filter((document) => nodeCollectionId(document) === collectionId && !nodeArchived(document));
    for (const member of members) {
      const siblings = members.filter((document) => document.parentId === member.parentId);
      const unnumberedTitle = current.numbering.enabled && !next.numbering.enabled
        ? nodeOptionalTitle(member).trim() || next.singularName
        : member.title;
      const title = itemDisplayName({ ...member, title: unnumberedTitle }, next, siblings);
      if (member.title === title) continue;
      const saved = await this.facade.saveDocument({
        id: member.id,
        title,
        createdBy: this.sessionId,
        reason: 'Update Collection item label'
      });
      this.documents = this.documents.map((document) => document.id === saved.id ? saved : document);
    }
    this.refreshBranches();
  }

  async deleteCollection(collectionId: string): Promise<void> {
    const collection = this.navigator.collections.find((item) => item.id === collectionId);
    if (!collection) return;
    const members = this.navigatorNodes.filter((document) => nodeCollectionId(document) === collectionId);
    for (const member of members) {
      const extensions = nodeArchivedExtensions(member.extensions, true);
      const saved = await this.facade.saveDocument({
        id: member.id,
        parentId: null,
        extensions,
        createdBy: this.sessionId,
        reason: `Archive item from deleted Collection ${collection.name}`
      });
      this.documents = this.documents.map((document) => document.id === saved.id ? saved : document);
    }
    await this.commitNavigator('Delete Collection', (state) => ({
      ...state,
      collections: state.collections.filter((item) => item.id !== collectionId),
      relationships: state.relationships.filter((relationship) => relationship.sourceNodeId !== collectionId && relationship.targetNodeId !== collectionId),
      todos: state.todos.map((todo) => ({ ...todo, targetNodeIds: todo.targetNodeIds.filter((id) => id !== collectionId) }))
    }));
    if (this.branchId === collectionId && this.spineNode) await this.switchBranch(this.spineNode.id);
    await this.facade.deleteDocument(collectionId);
    this.documents = this.documents.filter((document) => document.id !== collectionId);
    this.refreshBranches();
  }

  async moveCollection(collectionId: string, beforeCollectionId: string): Promise<void> {
    if (collectionId === beforeCollectionId) return;
    const ordered = [...this.navigator.collections].sort((a, b) => a.order - b.order);
    const moving = ordered.find((collection) => collection.id === collectionId);
    const targetIndex = ordered.filter((collection) => collection.id !== collectionId)
      .findIndex((collection) => collection.id === beforeCollectionId);
    if (!moving || targetIndex < 0) return;
    const without = ordered.filter((collection) => collection.id !== collectionId);
    without.splice(targetIndex, 0, moving);
    await this.commitNavigator('Reorder Collections', (state) => ({
      ...state,
      collections: without.map((collection, order) => ({ ...collection, order }))
    }));
  }

  async moveNavigatorNode(
    nodeId: string,
    target: { parentId: string; beforeNodeId?: string }
  ): Promise<void> {
    const moving = this.navigatorNodes.find((node) => node.id === nodeId);
    const collectionId = moving ? nodeCollectionId(moving) : null;
    const collection = this.navigator.collections.find((item) => item.id === collectionId);
    if (!moving || !collection || nodeId === target.parentId || nodeId === target.beforeNodeId) return;
    const beforeNode = target.beforeNodeId
      ? this.navigatorNodes.find((node) => node.id === target.beforeNodeId)
      : null;
    if (beforeNode && nodeCollectionId(beforeNode) !== collection.id) {
      this.notice = 'Dragging changes order or containment only. Moving an item to another Collection requires an explicit conversion.';
      return;
    }
    if (ancestors(target.parentId, this.projectNodes).some((node) => node.id === nodeId)) {
      this.notice = 'An item cannot be moved inside one of its descendants.';
      return;
    }

    const previous = this.documents;
    const targetSiblings = this.navigatorNodes
      .filter((node) => node.id !== nodeId && node.parentId === target.parentId && nodeCollectionId(node) === collection.id)
      .sort((left, right) => left.order - right.order);
    const insertion = target.beforeNodeId
      ? targetSiblings.findIndex((node) => node.id === target.beforeNodeId)
      : targetSiblings.length;
    targetSiblings.splice(insertion < 0 ? targetSiblings.length : insertion, 0, {
      ...moving,
      parentId: target.parentId,
      extensions: moving.extensions
    });

    const sourceCollectionId = nodeCollectionId(moving);
    const sourceParentId = moving.parentId;
    const sourceSiblings = this.navigatorNodes
      .filter((node) => node.id !== nodeId && node.parentId === sourceParentId && nodeCollectionId(node) === sourceCollectionId)
      .sort((left, right) => left.order - right.order);
    const updates = new Map<string, WorkspaceDocument>();
    for (const [order, node] of sourceSiblings.entries()) updates.set(node.id, { ...node, order });
    for (const [order, node] of targetSiblings.entries()) updates.set(node.id, { ...node, order });

    let nextDocuments = this.documents.map((document) => updates.get(document.id) ?? document);
    const affectedGroups = new Set([`${sourceCollectionId}:${sourceParentId}`, `${collection.id}:${target.parentId}`]);
    nextDocuments = nextDocuments.map((document) => {
      if (document.role !== 'navigator_node') return document;
      const group = `${nodeCollectionId(document)}:${document.parentId}`;
      if (!affectedGroups.has(group)) return document;
      const definition = this.navigator.collections.find((item) => item.id === nodeCollectionId(document));
      const siblings = nextDocuments.filter((candidate) => candidate.role === 'navigator_node'
        && candidate.parentId === document.parentId && nodeCollectionId(candidate) === definition?.id);
      return { ...document, title: itemDisplayName(document, definition, siblings) };
    });
    const changed = nextDocuments.filter((document) => {
      const prior = previous.find((item) => item.id === document.id);
      return prior && (prior.parentId !== document.parentId || prior.order !== document.order
        || prior.title !== document.title || JSON.stringify(prior.extensions) !== JSON.stringify(document.extensions));
    });
    this.documents = nextDocuments;
    this.refreshBranches();
    try {
      for (const document of changed) {
        const saved = await this.facade.saveDocument({
          id: document.id,
          title: document.title,
          parentId: document.parentId,
          order: document.order,
          extensions: document.extensions,
          createdBy: this.sessionId,
          reason: 'Navigator move'
        });
        this.documents = this.documents.map((item) => item.id === saved.id ? saved : item);
      }
      this.refreshBranches();
    } catch (error) {
      this.documents = previous;
      this.refreshBranches();
      this.lastError = error instanceof Error ? error.message : 'Navigator move failed';
      throw error;
    }
  }

  async createNavigatorTodo(title: string, targetNodeIds: string[] = [this.navigatorFocusId ?? this.branchId]): Promise<NavigatorTodo | null> {
    if (!title.trim()) return null;
    const todo: NavigatorTodo = {
      id: makeId('todo'),
      title: title.trim(),
      state: 'open',
      targetNodeIds: [...new Set(targetNodeIds)],
      createdAt: new Date().toISOString()
    };
    const document = await this.facade.createDocument({
      id: todo.id,
      projectId: this.projectId,
      parentId: this.todosNode?.id ?? null,
      title: todo.title,
      role: 'navigator_todo',
      createdBy: this.sessionId,
      reason: 'Create content-bearing Todo'
    });
    this.documents = [...this.documents, document];
    this.refreshBranches();
    await this.commitNavigator('Create Todo', (state) => ({ ...state, todos: [...state.todos, todo] }));
    this.setNavigatorExpanded('fixed:todos', true);
    return todo;
  }

  async toggleNavigatorTodo(id: string): Promise<void> {
    await this.commitNavigator('Update Todo', (state) => ({
      ...state,
      todos: state.todos.map((todo) => todo.id === id
        ? { ...todo, state: todo.state === 'open' ? 'done' as const : 'open' as const }
        : todo)
    }));
  }

  async createRelationshipDefinition(input: Omit<RelationshipDefinition, 'id' | 'order'>): Promise<RelationshipDefinition | null> {
    const forwardLabel = input.forwardLabel.trim();
    const inverseLabel = (input.symmetric ? forwardLabel : input.inverseLabel).trim();
    if (!forwardLabel || !inverseLabel) return null;
    const duplicate = this.navigator.relationshipDefinitions.some((definition) => {
      const forward = definition.forwardLabel.trim().toLocaleLowerCase();
      const inverse = definition.inverseLabel.trim().toLocaleLowerCase();
      const nextForward = forwardLabel.toLocaleLowerCase();
      const nextInverse = inverseLabel.toLocaleLowerCase();
      return (forward === nextForward && inverse === nextInverse)
        || (forward === nextInverse && inverse === nextForward);
    });
    if (duplicate) {
      this.notice = 'That relationship definition already exists.';
      return null;
    }
    const definition: RelationshipDefinition = {
      id: makeId('relationship_definition'),
      forwardLabel,
      inverseLabel,
      description: input.description.trim(),
      symmetric: input.symmetric,
      order: this.navigator.relationshipDefinitions.length
    };
    await this.commitNavigator('Create relationship definition', (state) => ({
      ...state,
      relationshipDefinitions: [...state.relationshipDefinitions, definition]
    }));
    return definition;
  }

  async updateRelationshipDefinition(id: string, input: Omit<RelationshipDefinition, 'id' | 'order'>): Promise<void> {
    const existing = this.navigator.relationshipDefinitions.find((definition) => definition.id === id);
    if (!existing) return;
    const forwardLabel = input.forwardLabel.trim();
    const inverseLabel = (input.symmetric ? forwardLabel : input.inverseLabel).trim();
    if (!forwardLabel || !inverseLabel) return;
    const conflict = this.navigator.relationshipDefinitions.some((definition) => definition.id !== id && (
      (definition.forwardLabel.trim().toLocaleLowerCase() === forwardLabel.toLocaleLowerCase()
        && definition.inverseLabel.trim().toLocaleLowerCase() === inverseLabel.toLocaleLowerCase())
      || (definition.forwardLabel.trim().toLocaleLowerCase() === inverseLabel.toLocaleLowerCase()
        && definition.inverseLabel.trim().toLocaleLowerCase() === forwardLabel.toLocaleLowerCase())
    ));
    if (conflict) {
      this.notice = 'That relationship definition already exists.';
      return;
    }
    await this.commitNavigator('Update relationship definition', (state) => ({
      ...state,
      relationshipDefinitions: state.relationshipDefinitions.map((definition) => definition.id === id
        ? { ...definition, forwardLabel, inverseLabel, description: input.description.trim(), symmetric: input.symmetric }
        : definition),
      relationships: state.relationships.map((relationship) => {
        if (relationship.definitionId !== id) return relationship;
        const usesForwardDirection = relationship.type === existing.forwardLabel && relationship.inverseType === existing.inverseLabel;
        return {
          ...relationship,
          type: usesForwardDirection ? forwardLabel : inverseLabel,
          inverseType: usesForwardDirection ? inverseLabel : forwardLabel
        };
      })
    }));
  }

  async deleteRelationshipDefinition(id: string): Promise<void> {
    if (!this.navigator.relationshipDefinitions.some((definition) => definition.id === id)) return;
    await this.commitNavigator('Delete relationship definition', (state) => ({
      ...state,
      relationshipDefinitions: state.relationshipDefinitions.filter((definition) => definition.id !== id),
      relationships: state.relationships.map((relationship) => relationship.definitionId === id
        ? { ...relationship, definitionId: undefined }
        : relationship)
    }));
  }

  async createNavigatorRelationship(
    targetOrInput: string | {
      targetNodeId: string;
      definitionId?: string;
      type: string;
      inverseType: string;
      scopeNodeIds?: string[];
      note?: string;
      sourceNodeId?: string;
    },
    legacyType?: string,
    legacyInverseType?: string
  ): Promise<NavigatorRelationship | null> {
    const input = typeof targetOrInput === 'string'
      ? { targetNodeId: targetOrInput, type: legacyType ?? '', inverseType: legacyInverseType ?? '' }
      : targetOrInput;
    const sourceNodeId = input.sourceNodeId ?? this.navigatorFocusId ?? this.branchId;
    const targetNodeId = input.targetNodeId;
    const type = input.type;
    const inverseType = input.inverseType;
    if (targetNodeId === sourceNodeId || !type.trim() || !inverseType.trim()) return null;
    if (!this.projectNodes.some((node) => node.id === targetNodeId)) return null;
    if (!this.projectNodes.some((node) => node.id === sourceNodeId)) return null;
    if (input.definitionId && !this.navigator.relationshipDefinitions.some((definition) => definition.id === input.definitionId)) return null;
    const nextType = type.trim();
    const nextInverseType = inverseType.trim();
    const scopeNodeIds = [...new Set(input.scopeNodeIds ?? [])]
      .filter((id) => this.projectNodes.some((node) => node.id === id));
    const duplicate = this.navigator.relationships.some((relationship) =>
      ((relationship.sourceNodeId === sourceNodeId
        && relationship.targetNodeId === targetNodeId
        && relationship.type === nextType
        && relationship.inverseType === nextInverseType)
      || (relationship.sourceNodeId === targetNodeId
        && relationship.targetNodeId === sourceNodeId
        && relationship.type === nextInverseType
        && relationship.inverseType === nextType))
      && JSON.stringify([...(relationship.scopeNodeIds ?? [])].sort()) === JSON.stringify([...scopeNodeIds].sort()));
    if (duplicate) {
      this.notice = 'Those items already have that relationship in the same scope.';
      return null;
    }
    const relationship: NavigatorRelationship = {
      id: makeId('relationship'),
      sourceNodeId,
      targetNodeId,
      definitionId: input.definitionId,
      type: nextType,
      inverseType: nextInverseType,
      scopeNodeIds,
      note: input.note?.trim() ?? '',
      confirmed: true
    };
    await this.commitNavigator('Create Navigator relationship', (state) => ({
      ...state,
      relationships: [...state.relationships, relationship]
    }));
    return relationship;
  }

  async removeNavigatorEntries(input: {
    nodeIds?: string[];
    todoIds?: string[];
    relationshipIds?: string[];
  }): Promise<void> {
    const selectedNodeIds = new Set(input.nodeIds ?? []);
    const archivedNodeIds = new Set<string>();
    const visit = (id: string): void => {
      if (archivedNodeIds.has(id)) return;
      const node = this.navigatorNodes.find((candidate) => candidate.id === id);
      if (!node) return;
      archivedNodeIds.add(id);
      for (const child of this.navigatorNodes.filter((candidate) => candidate.parentId === id)) visit(child.id);
    };
    for (const id of selectedNodeIds) visit(id);

    for (const id of archivedNodeIds) {
      const node = this.documents.find((document) => document.id === id);
      if (!node) continue;
      const saved = await this.facade.saveDocument({
        id,
        parentId: selectedNodeIds.has(id) ? null : node.parentId,
        extensions: nodeArchivedExtensions(node.extensions, true),
        createdBy: this.sessionId,
        reason: 'Remove Navigator material'
      });
      this.documents = this.documents.map((document) => document.id === id ? saved : document);
    }

    const todoIds = new Set(input.todoIds ?? []);
    for (const id of todoIds) {
      await this.facade.deleteDocument(id);
      this.documents = this.documents.filter((document) => document.id !== id);
    }
    const relationshipIds = new Set(input.relationshipIds ?? []);
    if (todoIds.size || relationshipIds.size) {
      await this.commitNavigator('Remove Navigator entries', (state) => ({
        ...state,
        todos: state.todos.filter((todo) => !todoIds.has(todo.id)),
        relationships: state.relationships.filter((relationship) => !relationshipIds.has(relationship.id))
      }));
    }
    this.refreshBranches();
  }

  async openNavigatorNode(id: string, navigation: 'push' | 'back' | 'forward' = 'push'): Promise<void> {
    const target = this.projectNodes.find((node) => node.id === id);
    if (!target) return;
    const previousId = this.branchId;
    if (id !== this.branchId) await this.switchBranch(id);
    const memory = this.navigatorMemory.context;
    const targetKey = `node:${id}`;
    const structural = ['spine', 'navigator_collection', 'navigator_node'].includes(target.role ?? '');
    let historyKeys = memory.historyKeys.filter((key) => {
      const nodeId = key.startsWith('node:') ? key.slice(5) : '';
      return this.projectNodes.some((node) => node.id === nodeId);
    });
    let historyIndex = Math.min(memory.historyIndex, historyKeys.length - 1);
    if (structural && navigation !== 'push') {
      const requestedIndex = historyIndex + (navigation === 'back' ? -1 : 1);
      if (historyKeys[requestedIndex] === targetKey) historyIndex = requestedIndex;
    } else if (structural) {
      if (!historyKeys.length) {
        const previous = this.projectNodes.find((node) => node.id === previousId);
        if (previous && ['spine', 'navigator_collection', 'navigator_node'].includes(previous.role ?? '')) {
          historyKeys = [`node:${previous.id}`];
          historyIndex = 0;
        }
      }
      historyKeys = historyKeys.slice(0, historyIndex + 1);
      if (historyKeys.at(-1) !== targetKey) historyKeys.push(targetKey);
      historyIndex = historyKeys.length - 1;
    }
    const focusKey = structural ? targetKey : memory.focusKey;
    const nextMode = target.role === 'navigator_node'
      ? 'context'
      : target.role === 'spine' || target.role === 'navigator_collection'
        ? 'traditional'
        : this.navigatorMemory.mode;
    const traditionalExpanded = new Set(this.navigatorMemory.traditional.expandedKeys);
    if (target.role === 'navigator_node') {
      const collectionId = nodeCollectionId(target);
      if (collectionId) traditionalExpanded.add(`collection:${collectionId}`);
      for (const ancestor of ancestors(id, this.projectNodes)) {
        traditionalExpanded.add(`node:${ancestor.id}`);
        const ancestorCollectionId = nodeCollectionId(ancestor);
        if (ancestorCollectionId) traditionalExpanded.add(`collection:${ancestorCollectionId}`);
      }
    }
    this.navigatorMemory = {
      ...this.navigatorMemory,
      mode: nextMode,
      traditional: {
        ...this.navigatorMemory.traditional,
        selectedKey: targetKey,
        expandedKeys: [...traditionalExpanded]
      },
      context: {
        ...memory,
        focusKey,
        selectedKey: targetKey,
        historyKeys,
        historyIndex,
        recentContextKeys: structural
          ? [targetKey, ...memory.recentContextKeys.filter((key) => key !== targetKey)].slice(0, 8)
          : memory.recentContextKeys
      }
    };
    this.saveNavigatorMemory();
  }

  setNavigatorMode(mode: NavigatorMemory['mode']): void {
    this.navigatorMemory = { ...this.navigatorMemory, mode };
    this.saveNavigatorMemory();
  }

  navigatorExpanded(key: string, mode = this.navigatorMemory.mode): boolean {
    return this.navigatorMemory[mode].expandedKeys.includes(key);
  }

  setNavigatorExpanded(key: string, expanded: boolean, mode = this.navigatorMemory.mode): void {
    const current = this.navigatorMemory[mode];
    const expandedKeys = expanded
      ? [...new Set([...current.expandedKeys, key])]
      : current.expandedKeys.filter((item) => item !== key);
    this.navigatorMemory = { ...this.navigatorMemory, [mode]: { ...current, expandedKeys } };
    this.saveNavigatorMemory();
  }

  toggleNavigatorExpanded(key: string): void {
    this.setNavigatorExpanded(key, !this.navigatorExpanded(key));
  }

  async persistCurrentDocument(reason = 'Editing session'): Promise<void> {
    await this.queueCommit(reason);
  }

  async renameDocument(id: string, title: string): Promise<void> {
    const current = this.documents.find((item) => item.id === id);
    if (!current) return;
    if (current.role === 'spine' || current.role === 'todos') return;
    const numberedCollection = current.role === 'navigator_node'
      ? this.navigator.collections.find((item) => item.id === nodeCollectionId(current) && item.numbering.enabled)
      : undefined;
    if (!title.trim() && !numberedCollection) return;
    if (current.role === 'navigator_collection') {
      await this.commitNavigator('Rename Collection', (state) => ({
        ...state,
        collections: state.collections.map((collection) => collection.id === id ? { ...collection, name: title.trim() } : collection)
      }));
    }
    if (current.role === 'navigator_todo') {
      await this.commitNavigator('Rename Todo', (state) => ({
        ...state,
        todos: state.todos.map((todo) => todo.id === id ? { ...todo, title: title.trim() } : todo)
      }));
    }
    const collection = current.role === 'navigator_node'
      ? this.navigator.collections.find((item) => item.id === nodeCollectionId(current))
      : undefined;
    const extensions = collection?.numbering.enabled
      ? nodeExtensions(current.extensions, collection.id, title.trim())
      : current.extensions;
    const next = { ...current, title: title.trim(), extensions };
    const durableTitle = collection?.numbering.enabled
      ? itemDisplayName(next, collection, this.navigatorNodes.filter((node) => node.parentId === next.parentId && nodeCollectionId(node) === collection.id))
      : title.trim();
    const document = await this.facade.saveDocument({ id, title: durableTitle, extensions, createdBy: this.sessionId, reason: 'Renamed document' });
    this.documents = this.documents.map((item) => item.id === id ? document : item);
    this.refreshBranches();
  }

  async createContextBucket(input: { title: string; role?: string; scope: ContextScope; content?: string }): Promise<ContextBucket> {
    const bucket = await this.facade.createContextBucket({
      projectId: this.projectId,
      documentId: input.scope === 'document' ? this.branchId : null,
      scope: input.scope,
      title: input.title,
      role: input.role,
      content: input.content,
      createdBy: this.sessionId
    });
    this.contextBuckets = [...this.contextBuckets, bucket];
    return bucket;
  }

  async saveContextBucket(input: { id: string; title: string; role?: string; content: string }): Promise<ContextBucket> {
    const bucket = await this.facade.saveContextBucket({ ...input, createdBy: this.sessionId, reason: 'Edited context' });
    this.contextBuckets = this.contextBuckets.map((item) => item.id === bucket.id ? bucket : item);
    return bucket;
  }

  async deleteContextBucket(id: string): Promise<void> {
    await this.facade.deleteContextBucket(id);
    this.contextBuckets = this.contextBuckets.filter((bucket) => bucket.id !== id);
  }

  private refreshBranches(): void {
    this.branches = this.documents
      .filter((document) => document.projectId === this.projectId)
      .map((document) => ({
        id: document.id,
        name: document.title,
        parentId: document.parentId ?? undefined,
        createdAt: document.updatedAt,
        wordCount: document.content.trim() ? document.content.trim().split(/\s+/).length : 0,
        lastEdited: document.updatedAt
      }));
  }

  private async ensureProjectStructure(): Promise<void> {
    if (!this.currentProject) return;
    await this.ensureFixedDocument('spine', 'Spine');
    await this.ensureFixedDocument('todos', 'Todos');
    for (const collection of this.navigator.collections) {
      if (this.collectionNode(collection.id)) continue;
      const collectionNode = await this.facade.createDocument({
        id: collection.id,
        projectId: this.projectId,
        title: collection.name,
        role: 'navigator_collection',
        extensions: nodeExtensions({}, collection.id, '', 'collection'),
        createdBy: this.sessionId,
        reason: 'Materialize legacy content-bearing Collection'
      });
      this.documents = [...this.documents, collectionNode];
    }
    for (const todo of this.navigator.todos) {
      if (this.todoNode(todo.id)) continue;
      const todoDocument = await this.facade.createDocument({
        id: todo.id,
        projectId: this.projectId,
        parentId: this.todosNode?.id ?? null,
        title: todo.title,
        role: 'navigator_todo',
        createdBy: this.sessionId,
        reason: 'Materialize legacy content-bearing Todo'
      });
      this.documents = [...this.documents, todoDocument];
    }
    this.refreshBranches();
  }

  private async ensureFixedDocument(role: 'spine' | 'todos', title: 'Spine' | 'Todos'): Promise<void> {
    const existing = this.projectNodes.find((document) => document.role === role);
    if (!existing) {
      const document = await this.facade.createDocument({
        projectId: this.projectId,
        title,
        role,
        createdBy: this.sessionId,
        reason: `Create required project ${title}`
      });
      this.documents = [...this.documents, document];
      return;
    }
    if (existing.title === title) return;
    const repaired = await this.facade.saveDocument({
      id: existing.id,
      title,
      createdBy: this.sessionId,
      reason: `Restore protected ${title} identity`
    });
    this.documents = this.documents.map((document) => document.id === repaired.id ? repaired : document);
  }

  private async commitNavigator(
    reason: string,
    change: (state: NavigatorProjectState) => NavigatorProjectState
  ): Promise<void> {
    const project = this.currentProject;
    if (!project) return;
    const next = change(JSON.parse(JSON.stringify(this.navigator)) as NavigatorProjectState);
    this.navigator = { ...next, revision: this.navigator.revision + 1 };
    try {
      const saved = await this.facade.saveProject(
        project.id,
        project.title,
        navigatorExtensions(project.extensions, this.navigator)
      );
      this.projects = this.projects.map((item) => item.id === saved.id ? saved : item);
    } catch (error) {
      this.navigator = readNavigatorState(project);
      this.lastError = error instanceof Error ? error.message : `Could not ${reason.toLowerCase()}`;
      throw error;
    }
  }

  private navigatorMemoryKey(): string {
    return `margin-note:navigator:${this.projectId}`;
  }

  private loadNavigatorMemory(): void {
    this.navigatorMemory = emptyNavigatorMemory();
    if (typeof localStorage === 'undefined') return;
    const stored = localStorage.getItem(this.navigatorMemoryKey());
    if (!stored) return;
    try {
      const value = JSON.parse(stored) as Partial<NavigatorMemory>;
      if (value.mode !== 'traditional' && value.mode !== 'context') return;
      this.navigatorMemory = {
        mode: value.mode,
        traditional: { ...this.navigatorMemory.traditional, ...value.traditional },
        context: { ...this.navigatorMemory.context, ...value.context }
      };
      const historyKeys = Array.isArray(this.navigatorMemory.context.historyKeys)
        ? this.navigatorMemory.context.historyKeys.filter((key): key is string => typeof key === 'string')
        : [];
      const historyIndex = Number.isInteger(this.navigatorMemory.context.historyIndex)
        ? Math.max(-1, Math.min(this.navigatorMemory.context.historyIndex, historyKeys.length - 1))
        : historyKeys.length - 1;
      this.navigatorMemory = {
        ...this.navigatorMemory,
        context: { ...this.navigatorMemory.context, historyKeys, historyIndex }
      };
    } catch {
      localStorage.removeItem(this.navigatorMemoryKey());
    }
  }

  private saveNavigatorMemory(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.navigatorMemoryKey(), JSON.stringify(this.navigatorMemory));
    }
  }

  private navigatorHistorySnapshot(): NavigatorHistorySnapshot {
    return {
      navigator: JSON.parse(JSON.stringify(this.navigator)) as NavigatorProjectState,
      documents: this.documents
        .filter((document) => document.projectId === this.projectId
          && ['navigator_collection', 'navigator_node', 'navigator_todo'].includes(document.role ?? ''))
        .map((document) => ({ ...document, extensions: JSON.parse(JSON.stringify(document.extensions)) }))
    };
  }

  private navigatorSnapshotsDiffer(left: NavigatorHistorySnapshot, right: NavigatorHistorySnapshot): boolean {
    const comparable = (snapshot: NavigatorHistorySnapshot) => ({
      navigator: snapshot.navigator,
      documents: snapshot.documents.map(({ revision: _revision, updatedAt: _updatedAt, content: _content, ...document }) => document)
    });
    return JSON.stringify(comparable(left)) !== JSON.stringify(comparable(right));
  }

  private async restoreNavigatorHistorySnapshot(snapshot: NavigatorHistorySnapshot, reason: string): Promise<void> {
    const currentDocuments = this.documents.filter((document) => document.projectId === this.projectId
      && ['navigator_collection', 'navigator_node', 'navigator_todo'].includes(document.role ?? ''));
    const currentById = new Map(currentDocuments.map((document) => [document.id, document]));
    const targetById = new Map(snapshot.documents.map((document) => [document.id, document]));

    for (const document of currentDocuments) {
      if (!targetById.has(document.id)) await this.facade.deleteDocument(document.id);
    }

    const restoredDocuments: WorkspaceDocument[] = [];
    for (const target of snapshot.documents) {
      const current = currentById.get(target.id);
      if (!current) {
        const created = await this.facade.createDocument({
          id: target.id,
          projectId: target.projectId,
          title: target.title,
          content: target.content,
          role: target.role,
          parentId: target.parentId,
          extensions: target.extensions,
          createdBy: this.sessionId,
          reason
        });
        const ordered = created.order === target.order ? created : await this.facade.saveDocument({
          id: created.id,
          order: target.order,
          createdBy: this.sessionId,
          reason
        });
        restoredDocuments.push(ordered);
        continue;
      }
      const changed = current.title !== target.title
        || current.parentId !== target.parentId
        || current.order !== target.order
        || JSON.stringify(current.extensions) !== JSON.stringify(target.extensions);
      restoredDocuments.push(changed ? await this.facade.saveDocument({
        id: current.id,
        title: target.title,
        parentId: target.parentId,
        order: target.order,
        extensions: target.extensions,
        createdBy: this.sessionId,
        reason
      }) : current);
    }

    this.navigator = JSON.parse(JSON.stringify(snapshot.navigator)) as NavigatorProjectState;
    const project = this.currentProject;
    if (!project) return;
    const savedProject = await this.facade.saveProject(
      project.id,
      project.title,
      navigatorExtensions(project.extensions, this.navigator)
    );
    this.projects = this.projects.map((item) => item.id === savedProject.id ? savedProject : item);
    const restoredIds = new Set(snapshot.documents.map((document) => document.id));
    this.documents = [
      ...this.documents.filter((document) => document.projectId !== this.projectId || !currentById.has(document.id)),
      ...restoredDocuments
    ].filter((document) => document.projectId !== this.projectId || !currentById.has(document.id) || restoredIds.has(document.id));
    this.refreshBranches();
    if (!this.documents.some((document) => document.id === this.branchId) && this.spineNode) {
      await this.switchBranch(this.spineNode.id);
    }
  }

  private historySnapshot(document: EditorDocumentSnapshot): WorkspaceHistorySnapshot {
    return cloneHistorySnapshot({
      document,
      inputs: this.inputs,
      formats: this.formats,
      revision: this.workspaceRevision
    });
  }

  private pushHistory(entry: WorkspaceHistoryEntry): void {
    const previous = this.undoStack.at(-1);
    if (entry.group === 'typing' && previous?.group === 'typing' && entry.createdAt - previous.createdAt <= 1200) {
      this.undoStack = [...this.undoStack.slice(0, -1), {
        ...previous,
        after: entry.after,
        createdAt: entry.createdAt
      }];
    } else this.undoStack = [...this.undoStack, entry].slice(-100);
    this.redoStack = [];
  }

  private restoreHistoryState(snapshot: WorkspaceHistorySnapshot): void {
    const restored = cloneHistorySnapshot(snapshot);
    this.inputs = restored.inputs;
    this.formats = restored.formats;
    this.workspaceRevision = restored.revision;
    this.setCanonicalDocument(restored.document);
    this.activeSuggestionId = null;
    this.preview = null;
  }

  private loadDocumentDomain(document: WorkspaceDocument | null): DocumentDomainLoadResult {
    const stored = document?.extensions.margin_note;
    const value = stored && typeof stored === 'object' && !Array.isArray(stored)
      ? stored as Record<string, unknown>
      : null;
    const persistedInputs = Array.isArray(value?.inputs) ? value.inputs as Suggestion[] : null;
    this.richDocument = isRichDocument(value?.document) ? value.document : richDocumentFromText(document?.content ?? '');
    const storedAuthorityVersion = typeof value?.authorityVersion === 'number' ? value.authorityVersion : 0;
    let migratedLegacyInputs = 0;
    this.inputs = (persistedInputs ?? []).map((input) => {
      const normalized = normalizeInputRecord(input, document?.id ?? this.branchId);
      const legacyLive = storedAuthorityVersion < authorityVersion
        && normalized.id.startsWith('sg_')
        && (normalized.state === 'pending' || normalized.state === 'hidden');
      if (!legacyLive) return normalized;
      migratedLegacyInputs += 1;
      return { ...normalized, state: 'stale' as const };
    });
    this.formats = Array.isArray(value?.formats) ? value.formats as FormatAttachment[] : [];
    this.runs = Array.isArray(value?.runs) ? value.runs as CraftRun[] : [];
    const runsById = new Map(this.runs.map((run) => [run.id, run]));
    let realignedCapturedInputs = 0;
    this.inputs = this.inputs.map((input) => {
      if ((input.anchorStatus !== 'request_scope' && input.anchorStatus !== 'unanchored')
        || (input.state !== 'pending' && input.state !== 'hidden')
        || input.events.length
        || !input.provenance.runId) return input;
      const run = runsById.get(input.provenance.runId);
      const capturedTarget = run ? firstTextTarget(run.target) : null;
      if (!run || !capturedTarget || capturedTarget.nodeId !== (document?.id ?? this.branchId)
        || input.anchor.text !== run.originalText) return input;
      const currentTarget = firstTextTarget(input.target);
      if (currentTarget?.start === capturedTarget.start && currentTarget.end === capturedTarget.end) return input;
      realignedCapturedInputs += 1;
      return {
        ...input,
        target: textTarget(capturedTarget.nodeId, capturedTarget.start, capturedTarget.end, run.originalText),
        anchor: { from: capturedTarget.start, to: capturedTarget.end, text: run.originalText },
        order: capturedTarget.start
      };
    });
    this.activities = Array.isArray(value?.activities) ? value.activities as AIActivityRecord[] : [];
    if (value?.sourceStates && typeof value.sourceStates === 'object' && !Array.isArray(value.sourceStates)) {
      this.sourceStates = { ...this.sourceStates, ...value.sourceStates as Record<string, SourceState> };
    }
    if (value?.inputSourceVisibility && typeof value.inputSourceVisibility === 'object' && !Array.isArray(value.inputSourceVisibility)) {
      this.inputSourceVisibility = { ...this.inputSourceVisibility, ...value.inputSourceVisibility as Record<string, boolean> };
    }
    this.syncAvailableSources();
    const storedBehaviours = value?.behaviours && typeof value.behaviours === 'object' && !Array.isArray(value.behaviours)
      ? value.behaviours as Record<string, AttachmentBehaviour>
      : {};
    this.behaviours = { ...defaultAttachmentBehaviours, ...storedBehaviours };
    if (typeof value?.behaviourVersion !== 'number' || value.behaviourVersion < attachmentBehaviourVersion) {
      this.behaviours['format-default'] = { ...defaultAttachmentBehaviours['format-default'] };
    }
    this.workspaceRevision = typeof value?.revision === 'number' ? value.revision : document?.revision ?? 0;
    return { archivedLegacyInputs: migratedLegacyInputs, realignedCapturedInputs };
  }

  private domainExtensions(): WorkspaceDocument['extensions'] {
    const current = this.currentDocument?.extensions ?? {};
    return {
      ...current,
      margin_note: {
        revision: this.workspaceRevision,
        authorityVersion,
        behaviourVersion: attachmentBehaviourVersion,
        inputs: [...this.inputs],
        document: this.richDocument,
        formats: [...this.formats],
        runs: [...this.runs],
        activities: [...this.activities],
        sourceStates: { ...this.sourceStates },
        inputSourceVisibility: { ...this.inputSourceVisibility },
        behaviours: { ...this.behaviours }
      }
    } as unknown as WorkspaceDocument['extensions'];
  }

  private async persistDomainState(reason: string): Promise<void> {
    await this.queueCommit(reason);
  }

  private async queueCommit(reason: string): Promise<void> {
    const document = this.currentDocument;
    if (!document) return;
    const transaction = {
      transactionId: makeId('commit'),
      documentId: document.id,
      mirrorIdentity: {
        projectId: document.projectId,
        projectTitle: this.currentProject?.title ?? 'Untitled project',
        documentTitle: document.title
      },
      content: document.content,
      extensions: this.domainExtensions(),
      workspaceRevision: this.workspaceRevision,
      durableRevision: document.revision,
      sessionId: this.sessionId,
      reason
    };
    const saveVersion = (this.documentSaveVersions.get(document.id) ?? 0) + 1;
    this.documentSaveVersions.set(document.id, saveVersion);
    this.documentSaveStates[document.id] = 'saving';
    this.documents = this.documents.map((item) => item.id === document.id
      ? { ...item, content: transaction.content, extensions: transaction.extensions, updatedAt: new Date().toISOString() }
      : item);
    this.refreshBranches();
    const previousSave = this.documentSaves.get(document.id) ?? Promise.resolve();
    const save = previousSave.catch(() => undefined).then(async () => {
      // Yield a browser frame before the facade serialises a potentially large
      // document domain. Navigation and editing remain responsive while the
      // durable write continues through this document's queue.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const receipt = await this.facade.commit(transaction);
      this.documents = this.documents.map((item) => item.id === receipt.documentId
        ? {
          ...item,
          content: transaction.content,
          extensions: transaction.extensions,
          revision: Math.max(item.revision, receipt.durableRevision),
          updatedAt: receipt.updatedAt
        }
        : item);
      this.refreshBranches();
      if (this.documentSaveVersions.get(document.id) === saveVersion) this.documentSaveStates[document.id] = 'saved';
    }).catch((error) => {
      this.lastError = error instanceof Error ? error.message : 'Workspace commit failed';
      if (this.documentSaveVersions.get(document.id) === saveVersion) this.documentSaveStates[document.id] = 'failed';
    });
    this.documentSaves.set(document.id, save);
    void save.finally(() => {
      if (this.documentSaves.get(document.id) === save) this.documentSaves.delete(document.id);
    });
    await save;
  }

  private async coalesceSuggestions(items: Suggestion[]): Promise<void> {
    const coalesced = coalesceDuplicateSuggestions(items.map((item) => normalizeInputRecord(item, this.branchId)));
    this.suggestions = coalesced.suggestions;
    for (const { duplicate, canonical, reason } of coalesced.suppressed) {
      await this.log('duplicate_suppressed', {
        duplicateOf: canonical.id,
        reason,
        source: duplicate.source,
        category: duplicate.category,
        anchor: [duplicate.anchor.from, duplicate.anchor.to]
      }, duplicate.id);
    }
    await this.persistDomainState('Update inputs');
  }

  private setCanonicalDocument(snapshot: EditorDocumentSnapshot): void {
    this.documentSnapshot = cloneHistorySnapshot({
      document: snapshot,
      inputs: [],
      formats: [],
      revision: this.workspaceRevision
    }).document;
    this.richDocument = snapshot.richDocument ?? richDocumentFromProseMirror(snapshot.doc);
    this.documents = this.documents.map((document) => document.id === this.branchId
      ? { ...document, content: snapshot.text, updatedAt: new Date().toISOString() }
      : document);
    this.refreshBranches();
  }
}

export const workspace = new WorkspaceState();
