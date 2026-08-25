import { describe, expect, it, vi } from 'vitest';
import type { InputProposal, LedgerEvent, Suggestion, TaskPrompt } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
import type { WorkspaceFacade } from '$lib/workspace/facade';
import type { WorkspaceDocument, WorkspaceProject } from '$lib/workspace/model';
import type { EditorDocumentSnapshot } from '$lib/workspace/transactions';
import { richDocumentFromProseMirror, richDocumentText } from '$lib/workspace/rich-document';
import type { AIInteractionRequest, AIInteractionService } from '$lib/ai/contracts';
import { WorkspaceState } from './workspace.svelte';

const beforeDocument: EditorDocumentSnapshot = {
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'noticed' }] }] },
  text: 'noticed',
  selection: { from: 1, to: 8 }
};

const afterDocument: EditorDocumentSnapshot = {
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'saw' }] }] },
  text: 'saw',
  selection: { from: 4, to: 4 }
};

function input(): Suggestion {
  return {
    id: 'input-1',
    kind: 'craft_suggestion',
    source: 'local-craft',
    sourceNumber: 1,
    sourceKind: 'local',
    target: textTarget('main', 1, 8, 'noticed'),
    behaviourId: 'craft-input',
    events: [],
    anchor: { from: 1, to: 8, text: 'noticed' },
    type: 'replacement',
    payload: { text: 'saw', comment: 'Consider the direct verb.' },
    category: 'diction',
    confidence: 0.8,
    variants: [{ id: 'variant-1', text: 'saw' }],
    state: 'pending',
    order: 1,
    createdAt: '2026-08-18T00:00:00Z',
    provenance: { promptVersion: 1, briefVersion: 1 }
  };
}

function document(content = 'noticed'): WorkspaceDocument {
  return {
    id: 'main',
    projectId: 'project',
    parentId: null,
    title: 'Main draft',
    order: 0,
    revision: 1,
    role: 'manuscript',
    extensions: {},
    kind: 'document',
    content,
    updatedAt: '2026-08-18T00:00:00Z'
  };
}

function project(): WorkspaceProject {
  return {
    id: 'project', title: 'Writing project', revision: 1, extensions: {}, updatedAt: '2026-08-18T00:00:00Z'
  };
}

function proposal(): InputProposal {
  return {
    proposalId: 'proposal-1',
    source: 'openrouter',
    sourceNumber: 3,
    sourceKind: 'ai',
    from: 0,
    to: 7,
    sourceText: 'noticed',
    type: 'replacement',
    category: 'diction',
    comment: 'Use a more direct verb.',
    variants: ['saw'],
    confidence: 0.8,
    provenance: { promptVersion: 1, briefVersion: 1, model: 'test/model' }
  };
}

function fakeFacade(requestInputs?: WorkspaceFacade['requestInputs']): WorkspaceFacade {
  let eventId = 0;
  return {
    requestInputs: requestInputs ?? vi.fn(async () => ({ proposals: [], errors: [] })),
    appendEvent: vi.fn(async (event: LedgerEvent) => ({
      ...event,
      id: ++eventId,
      timestamp: '2026-08-18T00:00:00Z',
      suggestionId: event.suggestionId ?? ''
    })),
    events: vi.fn(async () => ({ events: [], stats: { events: 0, costUsd: 0 } })),
    commit: vi.fn(async (transaction) => ({
      transactionId: transaction.transactionId,
      documentId: transaction.documentId,
      durableRevision: 2,
      updatedAt: '2026-08-18T00:00:01Z'
    }))
  } as unknown as WorkspaceFacade;
}

const selectionPrompt: TaskPrompt = {
  id: 'heighten',
  name: 'Heighten',
  version: 1,
  instruction: 'Offer a stronger verb.'
};

describe('semantic workspace history', () => {
  it('switches the document identity and rich content together after history loads', async () => {
    type SuggestionHistoryResult = Awaited<ReturnType<WorkspaceFacade['suggestionHistory']>>;
    let releaseHistory!: (value: SuggestionHistoryResult) => void;
    const facade = fakeFacade();
    facade.suggestionHistory = vi.fn(() => new Promise<SuggestionHistoryResult>((resolve) => { releaseHistory = resolve; }));
    const workspace = new WorkspaceState(facade);
    workspace.branchId = 'main';
    workspace.documents = [document('Original'), { ...document('Target text'), id: 'target', title: 'Target' }];
    workspace['loadDocumentDomain'](workspace.documents[0]);

    const switching = workspace.switchBranch('target');

    expect(workspace.branchId).toBe('main');
    expect(richDocumentText(workspace.richDocument)).toBe('Original');

    releaseHistory({ events: [], stats: { events: 0, costUsd: 0 } });
    await switching;

    expect(workspace.branchId).toBe('target');
    expect(richDocumentText(workspace.richDocument)).toBe('Target text');
  });

  it('keeps a formatting-only editor transaction in Svelte history and canonical rich content', () => {
    const workspace = new WorkspaceState(fakeFacade());
    workspace.branchId = 'main';
    workspace.documents = [document('noticed')];
    workspace.setEditorReady(beforeDocument);
    const formatted: EditorDocumentSnapshot = {
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'noticed', marks: [{ type: 'strong' }] }] }]
      },
      text: 'noticed',
      selection: { from: 1, to: 8 }
    };
    formatted.richDocument = richDocumentFromProseMirror(formatted.doc);

    workspace.recordEditorTransaction({ before: beforeDocument, after: formatted, changes: [], origin: { kind: 'human' } });

    expect(workspace.undoStack.at(-1)).toMatchObject({ source: 'format', label: 'Edit formatting' });
    expect(workspace.richDocument.blocks[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'noticed', marks: [{ type: 'bold' }] }]
    });
  });

  it('separates future review participation from filtering existing Inputs', async () => {
    const workspace = new WorkspaceState(fakeFacade());
    workspace.branchId = 'main';
    workspace.inputs = [input()];

    expect(workspace.visibleSuggestions).toHaveLength(1);
    await workspace.toggleRunSource('local-craft');

    expect(workspace.sourceStates['local-craft']).toBe('off');
    expect(workspace.visibleSuggestions).toHaveLength(1);

    await workspace.toggleInputSourceVisibility('local-craft');

    expect(workspace.inputSourceVisibility['local-craft']).toBe(false);
    expect(workspace.visibleSuggestions).toHaveLength(0);
    expect(workspace.sourceStates['local-craft']).toBe('off');
  });

  it('reorders pending inputs through the same undoable persistence path', async () => {
    const facade = fakeFacade();
    const workspace = new WorkspaceState(facade);
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.inputs = [
      input(),
      { ...input(), id: 'input-2', order: 2 },
      { ...input(), id: 'input-3', order: 3 }
    ];
    workspace.setEditorReady(beforeDocument);

    await workspace.moveInput('input-3', 'input-1', 'before');

    expect(workspace.inputs.filter((item) => item.state === 'pending').sort((a, b) => a.order - b.order).map((item) => item.id)).toEqual(['input-3', 'input-1', 'input-2']);
    expect(workspace.canUndo).toBe(true);
    expect(workspace.undoWorkspace()).not.toBeNull();
    expect(workspace.inputs.sort((a, b) => a.order - b.order).map((item) => item.id)).toEqual(['input-1', 'input-2', 'input-3']);
    expect(facade.commit).toHaveBeenCalled();
  });

  it('undoes and redoes accepted prose and input state together', () => {
    const workspace = new WorkspaceState();
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.inputs = [input()];
    workspace.setEditorReady(beforeDocument);

    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterDocument,
      changes: [{ nodeId: 'main', from: 1, to: 8, insertedLength: 3 }],
      origin: { kind: 'input_acceptance', inputId: 'input-1', source: 'local-craft' }
    });

    expect(workspace.inputs[0].state).toBe('accepted');
    expect(workspace.currentDocument?.content).toBe('saw');
    expect(workspace.canUndo).toBe(true);
    expect(workspace.undoWorkspace()?.text).toBe('noticed');
    expect(workspace.inputs[0].state).toBe('pending');
    expect(workspace.redoWorkspace()?.text).toBe('saw');
    expect(workspace.inputs[0].state).toBe('accepted');
  });

  it('includes format-only changes in the same undo stack', () => {
    const workspace = new WorkspaceState();
    workspace.branchId = 'main';
    workspace.setEditorReady(beforeDocument);

    workspace.toggleSelectionStrikethrough(1, 8, 'noticed');
    expect(workspace.formats).toHaveLength(1);
    expect(workspace.undoWorkspace()?.text).toBe('noticed');
    expect(workspace.formats).toHaveLength(0);
    workspace.redoWorkspace();
    expect(workspace.formats).toHaveLength(1);
  });

  it('makes selection strikethrough an explicit reversible toggle', () => {
    const workspace = new WorkspaceState();
    workspace.branchId = 'main';
    workspace.setEditorReady(beforeDocument);

    workspace.toggleSelectionStrikethrough(1, 8, 'noticed');
    expect(workspace.selectionHasStrikethrough(1, 8)).toBe(true);
    workspace.toggleSelectionStrikethrough(1, 8, 'noticed');
    expect(workspace.selectionHasStrikethrough(1, 8)).toBe(false);
    expect(workspace.formats).toHaveLength(1);
    workspace.undoWorkspace();
    expect(workspace.selectionHasStrikethrough(1, 8)).toBe(true);
  });

  it('owns canonical document content synchronously when an editor transaction arrives', () => {
    const workspace = new WorkspaceState(fakeFacade());
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterDocument,
      changes: [{ nodeId: 'main', from: 1, to: 8, insertedLength: 3, deletedText: 'noticed', insertedText: 'saw' }],
      origin: { kind: 'human' }
    });

    expect(workspace.documentSnapshot?.text).toBe('saw');
    expect(workspace.currentDocument?.content).toBe('saw');
    expect(workspace.workspaceRevision).toBe(1);
  });

  it('pauses AI dispatch while continuing to accept human editor transactions', async () => {
    const requestInputs = vi.fn(async () => ({ proposals: [], errors: [] }));
    const workspace = new WorkspaceState(fakeFacade(requestInputs));
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    await workspace.togglePause();
    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterDocument,
      changes: [{ nodeId: 'main', from: 1, to: 8, insertedLength: 3, deletedText: 'noticed', insertedText: 'saw' }],
      origin: { kind: 'human' }
    });
    const proposals = await workspace.runSelectionPass({ from: 1, to: 4, text: 'saw' }, selectionPrompt);

    expect(workspace.paused).toBe(true);
    expect(workspace.currentDocument?.content).toBe('saw');
    expect(workspace.documentSnapshot?.text).toBe('saw');
    expect(proposals).toEqual([]);
    expect(requestInputs).not.toHaveBeenCalled();
  });

  it('moves an in-flight run through an edit before its target and adopts the proposal at the new range', async () => {
    let finish!: (value: { proposals: InputProposal[]; errors: [] }) => void;
    const requestInputs = vi.fn(() => new Promise<{ proposals: InputProposal[]; errors: [] }>((resolve) => { finish = resolve; }));
    const workspace = new WorkspaceState(fakeFacade(requestInputs));
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    const pending = workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt);
    await vi.waitFor(() => expect(requestInputs).toHaveBeenCalledOnce());

    const afterInsertion: EditorDocumentSnapshot = {
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'She noticed' }] }] },
      text: 'She noticed',
      selection: { from: 5, to: 12 }
    };
    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterInsertion,
      changes: [{ nodeId: 'main', from: 1, to: 1, insertedLength: 4, insertedText: 'She ' }],
      origin: { kind: 'human' }
    });
    finish({ proposals: [proposal()], errors: [] });

    const adopted = await pending;
    expect(adopted).toHaveLength(1);
    expect(adopted[0].target.targets[0]).toMatchObject({ type: 'text', start: 5, end: 12 });
    expect(adopted[0].anchor).toEqual({ from: 5, to: 12, text: 'noticed' });
    expect(workspace.runs.at(-1)?.state).toBe('completed');
  });

  it('discards an in-flight proposal when its target text is edited', async () => {
    let finish!: (value: { proposals: InputProposal[]; errors: [] }) => void;
    const requestInputs = vi.fn(() => new Promise<{ proposals: InputProposal[]; errors: [] }>((resolve) => { finish = resolve; }));
    const workspace = new WorkspaceState(fakeFacade(requestInputs));
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    const pending = workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt);
    await vi.waitFor(() => expect(requestInputs).toHaveBeenCalledOnce());
    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterDocument,
      changes: [{ nodeId: 'main', from: 1, to: 8, insertedLength: 3, deletedText: 'noticed', insertedText: 'saw' }],
      origin: { kind: 'human' }
    });
    finish({ proposals: [proposal()], errors: [] });

    expect(await pending).toEqual([]);
    expect(workspace.inputs).toEqual([]);
    expect(workspace.runs.at(-1)?.state).toBe('discarded');
    expect(workspace.notice).toContain('safely discarded');
  });

  it('records malformed provider output without showing a transient user notice', async () => {
    const requestInputs = vi.fn(async () => ({
      proposals: [],
      errors: [{ source: 'openrouter', kind: 'provider_output' as const, message: 'Provider returned invalid JSON after local repair and validation.' }]
    }));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const workspace = new WorkspaceState(fakeFacade(requestInputs));
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    expect(await workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt)).toEqual([]);
    expect(workspace.notice).toBeNull();
    expect(workspace.runs.at(-1)).toMatchObject({
      state: 'failed',
      errors: [expect.objectContaining({ source: 'openrouter', kind: 'provider_output' })]
    });
    expect(warning).toHaveBeenCalledWith('[Margin Note] Malformed provider output', expect.objectContaining({
      documentId: 'main'
    }));
    warning.mockRestore();
  });

  it('logs recovered provider normalization as information instead of a malformed-output warning', async () => {
    const requestInputs = vi.fn(async () => ({
      proposals: [],
      errors: [{
        source: 'openrouter', kind: 'provider_output' as const, classification: 'output_nonconforming' as const,
        recoveryAction: 'extract_local' as const, recovered: true, outcome: 'normalized_locally' as const,
        message: 'Valid JSON was extracted from surrounding provider text.'
      }]
    }));
    const information = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const workspace = new WorkspaceState(fakeFacade(requestInputs));
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    expect(await workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt)).toEqual([]);
    expect(workspace.runs.at(-1)?.state).toBe('completed');
    expect(information).toHaveBeenCalledWith('[Margin Note] Provider output normalized', expect.objectContaining({
      documentId: 'main', outcome: 'normalized_locally'
    }));
    expect(warning).not.toHaveBeenCalled();
    information.mockRestore();
    warning.mockRestore();
  });

  it('captures a typed activity, target, and inspectable context before dispatch', async () => {
    const execute = vi.fn<AIInteractionService['execute']>(async (request) => ({
      proposals: [{ kind: 'craft_input', payload: proposal() }],
      diagnostics: [],
      context: request.context
    }));
    const workspace = new WorkspaceState(fakeFacade(), { execute });
    workspace.projectId = 'project';
    workspace.branchId = 'main';
    workspace.projects = [project()];
    workspace.documents = [
      document(),
      { ...document('Keep Mara in close third.'), id: 'spine', role: 'spine', title: 'Story Spine' }
    ];
    workspace.contextBuckets = [{
      id: 'context-mara', projectId: 'project', documentId: null, scope: 'project', title: 'Mara',
      role: 'fact', content: 'Mara dislikes clocks.', revision: 2, extensions: {}, updatedAt: '2026-08-18T00:00:00Z'
    }];
    workspace.setEditorReady(beforeDocument);

    const adopted = await workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt);
    const request = execute.mock.calls[0][0] as AIInteractionRequest;

    expect(request).toMatchObject({
      activityId: expect.stringMatching(/^activity_/),
      runId: expect.stringMatching(/^run_/),
      projectId: 'project',
      documentId: 'main',
      intent: 'revise',
      action: { id: 'heighten', version: 1 },
      permittedProposalKinds: ['craft_input'],
      target: { exactText: 'noticed', sourceRevision: 0 }
    });
    expect(request.context.items.map((item) => item.title)).toEqual(expect.arrayContaining([
      'Heighten', 'Writing brief', 'Main draft', 'Story Spine', 'Mara'
    ]));
    expect(workspace.activities.at(-1)).toMatchObject({ state: 'completed', runIds: [request.runId] });
    expect(workspace.runs.at(-1)?.contextManifest).toEqual(request.context);
    expect(adopted[0].provenance).toMatchObject({
      activityId: request.activityId,
      runId: request.runId,
      actionId: 'heighten',
      actionVersion: 1,
      contextManifestId: request.runId
    });
    expect(workspace.currentDocument?.content).toBe('noticed');
  });

  it('rejects proposals when the service alters required Writing Context', async () => {
    const execute = vi.fn<AIInteractionService['execute']>(async (request) => {
      const context = structuredClone(request.context);
      context.items[0] = { ...context.items[0], content: 'A different hidden instruction.' };
      return { proposals: [{ kind: 'craft_input', payload: proposal() }], diagnostics: [], context };
    });
    const workspace = new WorkspaceState(fakeFacade(), { execute });
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    expect(await workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt)).toEqual([]);
    expect(workspace.inputs).toEqual([]);
    expect(workspace.runs.at(-1)).toMatchObject({
      state: 'failed',
      errors: [expect.objectContaining({ kind: 'contract', outcome: 'rejected' })]
    });
  });

  it('manually retries a failed run as a new activity against the unchanged live target', async () => {
    const execute = vi.fn<AIInteractionService['execute']>()
      .mockImplementationOnce(async (request) => ({
        proposals: [],
        diagnostics: [{ source: 'local-craft', kind: 'provider_request', classification: 'transient', recoveryAction: 'human', recovered: false, message: 'Recovery exhausted' }],
        context: request.context
      }))
      .mockImplementationOnce(async (request) => ({
        proposals: [{ kind: 'craft_input', payload: proposal() }],
        diagnostics: [],
        context: request.context
      }));
    const workspace = new WorkspaceState(fakeFacade(), { execute });
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.setEditorReady(beforeDocument);

    expect(await workspace.runSelectionPass({ from: 1, to: 8, text: 'noticed' }, selectionPrompt)).toEqual([]);
    const failed = workspace.runs.at(-1)!;
    expect(failed.state).toBe('failed');

    const adopted = await workspace.retryRun(failed.id);

    expect(adopted).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(workspace.runs).toHaveLength(2);
    expect(workspace.runs[1].activityId).not.toBe(failed.activityId);
    expect(workspace.activities.map((activity) => activity.state)).toEqual(['failed', 'completed']);
    expect(workspace.currentDocument?.content).toBe('noticed');
  });

  it('does not resurrect a dismissed input after preceding text moves its target', async () => {
    const repeated = {
      ...proposal(),
      source: 'local-craft',
      sourceNumber: 1,
      sourceKind: 'local' as const,
      comment: 'Consider the direct verb.'
    };
    const requestInputs = vi.fn(async () => ({ proposals: [repeated], errors: [] }));
    const workspace = new WorkspaceState(fakeFacade(requestInputs));
    workspace.branchId = 'main';
    workspace.documents = [document()];
    workspace.inputs = [{ ...input(), state: 'rejected' }];
    workspace.setEditorReady(beforeDocument);

    const afterInsertion: EditorDocumentSnapshot = {
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'She noticed' }] }] },
      text: 'She noticed',
      selection: { from: 5, to: 12 }
    };
    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterInsertion,
      changes: [{ nodeId: 'main', from: 1, to: 1, insertedLength: 4, insertedText: 'She ' }],
      origin: { kind: 'human' }
    });

    expect(await workspace.runSelectionPass({ from: 5, to: 12, text: 'noticed' }, selectionPrompt)).toEqual([]);
    expect(workspace.inputs.map((item) => item.state)).toEqual(['rejected', 'superseded']);
    expect(workspace.inputs[0].anchor).toMatchObject({ from: 5, to: 12 });
  });

  it('archives live legacy inputs when adopting the Svelte-authority document format', () => {
    const workspace = new WorkspaceState(fakeFacade());
    workspace.branchId = 'main';
    const legacyDocument = document();
    legacyDocument.extensions = JSON.parse(JSON.stringify({ margin_note: { inputs: [{ ...input(), id: 'sg_legacy' }], revision: 12 } }));

    const migrated = workspace['loadDocumentDomain'](legacyDocument);

    expect(migrated).toBe(1);
    expect(workspace.inputs[0].state).toBe('stale');
    expect(workspace.workspaceRevision).toBe(12);
  });
});

describe('Navigator workspace transactions', () => {
  it('opens a new project on its protected Spine with a valid Navigator projection', async () => {
    const facade = fakeFacade();
    const freshProject = { ...project(), id: 'fresh', title: 'Fresh story' };
    facade.createProject = vi.fn(async () => freshProject);
    facade.createDocument = vi.fn(async (input) => ({
      id: `${input.role}-fresh`, projectId: input.projectId, parentId: input.parentId ?? null,
      title: input.title, order: input.role === 'spine' ? 0 : 1, revision: 1, role: input.role,
      extensions: input.extensions ?? {}, kind: 'document' as const, content: '',
      updatedAt: '2026-08-18T00:00:00Z'
    }));
    facade.persistentWorkspace = vi.fn(async () => ({
      projects: [freshProject], documents: [], contextBuckets: []
    }));
    facade.suggestionHistory = vi.fn(async () => ({ events: [], stats: { events: 0, costUsd: 0 } }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.branchId = 'main';
    workspace.projects = [project()];
    workspace.documents = [document()];

    await workspace.createProject('Fresh story');

    expect(workspace.spineNode).toMatchObject({ id: 'spine-fresh', title: 'Spine', role: 'spine' });
    expect(workspace.currentDocument?.id).toBe('spine-fresh');
    expect(workspace.navigatorMemory.mode).toBe('traditional');
    expect(workspace.navigatorMemory.traditional.selectedKey).toBe('node:spine-fresh');
    expect(workspace.navigatorFocusNode?.id).toBe('spine-fresh');
  });

  it('repairs protected project content and materializes legacy Collections when switching projects', async () => {
    const facade = fakeFacade();
    const legacyProject: WorkspaceProject = {
      ...project(),
      id: 'legacy',
      title: 'Legacy project',
      extensions: {
        navigator: {
          version: 1,
          revision: 1,
          collections: [{
            id: 'scenes', name: 'Scenes', singularName: 'Scene', order: 0, icon: 'folder',
            numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true }
          }],
          relationships: [], todos: [{ id: 'todo-legacy', title: 'Review opening', state: 'open', targetNodeIds: [], createdAt: '2026-08-18T00:00:00Z' }]
        }
      }
    };
    facade.createDocument = vi.fn(async (input) => ({
      id: input.id ?? `${input.role}-id`, projectId: input.projectId, parentId: input.parentId ?? null,
      title: input.title, order: 1, revision: 1, role: input.role, extensions: input.extensions ?? {},
      kind: 'document' as const, content: '', updatedAt: '2026-08-18T00:00:00Z'
    }));
    facade.suggestionHistory = vi.fn(async () => ({ events: [], stats: { events: 0, costUsd: 0 } }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.branchId = 'main';
    workspace.projects = [project(), legacyProject];
    workspace.documents = [document()];

    await workspace.switchProject('legacy');

    expect(workspace.spineNode).toMatchObject({ title: 'Spine', role: 'spine' });
    expect(workspace.todosNode).toMatchObject({ title: 'Todos', role: 'todos' });
    expect(workspace.collectionNode('scenes')).toMatchObject({ title: 'Scenes', role: 'navigator_collection' });
    expect(workspace.todoNode('todo-legacy')).toMatchObject({ title: 'Review opening', role: 'navigator_todo' });
    expect(facade.createDocument).toHaveBeenCalledTimes(4);
  });

  it('does not allow the protected Spine or Todos identities to be renamed', async () => {
    const facade = fakeFacade();
    facade.saveDocument = vi.fn();
    const workspace = new WorkspaceState(facade);
    workspace.documents = [
      { ...document(), id: 'spine', title: 'Spine', role: 'spine' },
      { ...document(), id: 'todos', title: 'Todos', role: 'todos' }
    ];

    await workspace.renameDocument('spine', 'Test');
    await workspace.renameDocument('todos', 'Tasks');

    expect(workspace.documents.map((item) => item.title)).toEqual(['Spine', 'Todos']);
    expect(facade.saveDocument).not.toHaveBeenCalled();
  });

  it('creates and persists a user-defined Collection from Svelte-owned state', async () => {
    const facade = fakeFacade();
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), revision: 2, extensions: extensions ?? {} }));
    facade.createDocument = vi.fn(async (input) => ({
      id: input.id!, projectId: input.projectId, parentId: null, title: input.title, order: 1, revision: 1,
      role: input.role, extensions: input.extensions ?? {}, kind: 'document' as const, content: '', updatedAt: '2026-08-18T00:00:00Z'
    }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.documents = [document()];

    const collection = await workspace.createCollection({
      name: 'Scenes', singularName: 'Scene', icon: 'folder', numbering: { enabled: true, start: 1 }
    });

    expect(collection).toMatchObject({ name: 'Scenes', singularName: 'Scene', icon: 'folder', numbering: { enabled: true, start: 1 } });
    expect(workspace.navigator.collections).toEqual([collection]);
    expect(workspace.collectionNode(collection!.id)).toMatchObject({ id: collection!.id, title: 'Scenes', role: 'navigator_collection' });
    expect(workspace.navigator.revision).toBe(1);
    expect(facade.saveProject).toHaveBeenCalledWith(
      'project',
      'Writing project',
      expect.objectContaining({ navigator: expect.objectContaining({ revision: 1, collections: [collection] }) })
    );

    expect(await workspace.createCollection({ name: ' scenes ', singularName: 'Scene' })).toBeNull();
    expect(workspace.navigator.collections).toHaveLength(1);
    expect(workspace.notice).toBe('scenes already exists.');
  });

  it('creates content-bearing Nodes with collection membership behind the facade', async () => {
    const facade = fakeFacade();
    facade.createDocument = vi.fn(async (input) => ({
      id: 'mara', projectId: input.projectId, parentId: input.parentId ?? null, title: input.title,
      order: 1, revision: 1, role: input.role, extensions: input.extensions ?? {}, kind: 'document' as const,
      content: '', updatedAt: '2026-08-18T00:00:00Z'
    }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.documents = [document(), {
      ...document(), id: 'characters', title: 'Characters', role: 'navigator_collection', order: 1,
      extensions: { navigator: { collectionId: 'characters', optionalTitle: '', kind: 'collection' } }
    }];
    workspace.navigator.collections = [{
      id: 'characters', name: 'Characters', singularName: 'Character', order: 0, icon: 'folder',
      numbering: { enabled: false, start: 1 },
      capabilities: { contentBearing: true, mayContainChildren: false }
    }];

    const created = await workspace.createNavigatorNode('characters', 'Mara');

    expect(created?.id).toBe('mara');
    expect(created?.extensions.navigator).toEqual({ collectionId: 'characters', optionalTitle: 'Mara', kind: 'item' });
    expect(workspace.documents.at(-1)?.id).toBe('mara');
  });

  it('updates Collection configuration and its durable content document together', async () => {
    const facade = fakeFacade();
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    facade.saveDocument = vi.fn(async (input) => {
      const current = workspace.documents.find((node) => node.id === input.id)!;
      return { ...current, ...input, revision: current.revision + 1, updatedAt: '2026-08-18T00:00:01Z' } as WorkspaceDocument;
    });
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.navigator.collections = [{
      id: 'scenes', name: 'Scenes', singularName: 'Scene', order: 0, icon: 'folder',
      numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true }
    }];
    workspace.documents = [
      document(),
      { ...document(), id: 'scenes', title: 'Scenes', role: 'navigator_collection' },
      { ...document(), id: 'arrival', parentId: 'scenes', title: 'Scene 1 — Arrival', role: 'navigator_node', extensions: { navigator: { collectionId: 'scenes', optionalTitle: 'Arrival', kind: 'item' } } }
    ];

    await workspace.updateCollection('scenes', {
      name: 'Sequences', singularName: 'Sequence', icon: 'file', numbering: { enabled: true, start: 3 }
    });

    expect(workspace.navigator.collections[0]).toMatchObject({ name: 'Sequences', singularName: 'Sequence', icon: 'file', numbering: { enabled: true, start: 3 } });
    expect(workspace.collectionNode('scenes')?.title).toBe('Sequences');
    expect(workspace.documents.find((node) => node.id === 'arrival')?.title).toBe('Sequence 3 — Arrival');
  });

  it('deletes a Collection while preserving its child content in Archived/Unowned', async () => {
    const facade = fakeFacade();
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    facade.saveDocument = vi.fn(async (input) => {
      const current = workspace.documents.find((node) => node.id === input.id)!;
      return { ...current, ...input, revision: current.revision + 1, updatedAt: '2026-08-18T00:00:01Z' } as WorkspaceDocument;
    });
    facade.deleteDocument = vi.fn(async () => undefined);
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.navigator.collections = [{
      id: 'notes', name: 'Notes', singularName: 'Note', order: 0, icon: 'folder',
      numbering: { enabled: false, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true }
    }];
    workspace.documents = [
      document(),
      { ...document(), id: 'notes', title: 'Notes', role: 'navigator_collection' },
      { ...document(), id: 'clue', parentId: 'notes', title: 'Clue', role: 'navigator_node', extensions: { navigator: { collectionId: 'notes', optionalTitle: 'Clue', kind: 'item' } } }
    ];

    await workspace.deleteCollection('notes');

    expect(workspace.navigator.collections).toEqual([]);
    expect(workspace.documents.some((node) => node.id === 'notes')).toBe(false);
    expect(workspace.documents.find((node) => node.id === 'clue')).toMatchObject({ parentId: null, extensions: { navigator: expect.objectContaining({ archived: true }) } });
    expect(workspace.archivedOrUnownedNodes.map((node) => node.id)).toContain('clue');
    expect(facade.deleteDocument).toHaveBeenCalledWith('notes');
  });

  it('persists canonical Todos and confirmed typed relationships', async () => {
    const facade = fakeFacade();
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    facade.createDocument = vi.fn(async (input) => ({
      id: input.id!, projectId: input.projectId, parentId: input.parentId ?? null, title: input.title,
      order: 2, revision: 1, role: input.role, extensions: input.extensions ?? {}, kind: 'document' as const,
      content: '', updatedAt: '2026-08-18T00:00:00Z'
    }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.branchId = 'main';
    workspace.projects = [project()];
    workspace.documents = [document(), { ...document(), id: 'mara', title: 'Mara', order: 1 }];

    const todo = await workspace.createNavigatorTodo('Check Mara continuity', ['main', 'mara']);
    const relationship = await workspace.createNavigatorRelationship('mara', 'features', 'appears in');

    expect(todo?.targetNodeIds).toEqual(['main', 'mara']);
    expect(workspace.todoNode(todo!.id)).toMatchObject({ id: todo!.id, title: 'Check Mara continuity', role: 'navigator_todo', content: '' });
    expect(relationship).toMatchObject({ sourceNodeId: 'main', targetNodeId: 'mara', type: 'features', inverseType: 'appears in' });
    expect(workspace.navigator.revision).toBe(2);
    expect(facade.saveProject).toHaveBeenCalledTimes(2);
  });

  it('owns editable relationship vocabulary and scoped relationship notes', async () => {
    const facade = fakeFacade();
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.branchId = 'scene';
    workspace.projects = [project()];
    workspace.documents = [
      { ...document(), id: 'scene', title: 'Scene 1', role: 'navigator_node' },
      { ...document(), id: 'mara', title: 'Mara', role: 'navigator_node' },
      { ...document(), id: 'chapter', title: 'Chapter 1', role: 'navigator_node' }
    ];

    const definition = await workspace.createRelationshipDefinition({
      forwardLabel: 'features', inverseLabel: 'appears in', description: 'Narrative participation.', symmetric: false
    });
    const relationship = await workspace.createNavigatorRelationship({
      sourceNodeId: 'scene', targetNodeId: 'mara', definitionId: definition!.id,
      type: definition!.forwardLabel, inverseType: definition!.inverseLabel,
      scopeNodeIds: ['chapter'], note: 'Mara arrives after the doctor.'
    });

    expect(relationship).toMatchObject({
      definitionId: definition!.id,
      scopeNodeIds: ['chapter'],
      note: 'Mara arrives after the doctor.'
    });
    expect(workspace.navigatorRelationsFor('mara')[0]).toMatchObject({
      label: 'appears in', scopeNodeIds: ['chapter'], note: 'Mara arrives after the doctor.'
    });

    await workspace.updateRelationshipDefinition(definition!.id, {
      forwardLabel: 'includes', inverseLabel: 'participates in', description: 'Revised participation label.', symmetric: false
    });
    expect(workspace.navigator.relationships[0]).toMatchObject({ type: 'includes', inverseType: 'participates in' });

    await workspace.deleteRelationshipDefinition(definition!.id);
    expect(workspace.navigator.relationshipDefinitions).toEqual([]);
    expect(workspace.navigator.relationships[0]).toMatchObject({ type: 'includes', inverseType: 'participates in' });
    expect(workspace.navigator.relationships[0].definitionId).toBeUndefined();
  });

  it('renumbers optional-titled items after a stable-identity move', async () => {
    const facade = fakeFacade();
    facade.saveDocument = vi.fn(async (input) => {
      const current = workspace.documents.find((node) => node.id === input.id)!;
      return { ...current, ...input, revision: current.revision + 1, updatedAt: '2026-08-18T00:00:01Z' } as WorkspaceDocument;
    });
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.navigator.collections = [{
      id: 'scenes', name: 'Scenes', singularName: 'Scene', order: 0, icon: 'folder',
      numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true }
    }];
    workspace.documents = [
      document(),
      { ...document(), id: 'scenes', title: 'Scenes', role: 'navigator_collection', order: 1 },
      { ...document(), id: 'first', parentId: 'scenes', title: 'Scene 1 — Arrival', role: 'navigator_node', order: 0, extensions: { navigator: { collectionId: 'scenes', optionalTitle: 'Arrival', kind: 'item' } } },
      { ...document('Claire challenges the doctor.'), id: 'second', parentId: 'scenes', title: 'Scene 2 — Discovery', role: 'navigator_node', order: 1, extensions: { navigator: { collectionId: 'scenes', optionalTitle: 'Discovery', kind: 'item' } } }
    ];

    await workspace.moveNavigatorNode('second', { parentId: 'scenes', beforeNodeId: 'first' });

    expect(workspace.documents.find((node) => node.id === 'second')).toMatchObject({
      id: 'second', order: 0, title: 'Scene 1 — Discovery', content: 'Claire challenges the doctor.',
      extensions: { navigator: { collectionId: 'scenes', optionalTitle: 'Discovery', kind: 'item' } }
    });
    expect(workspace.documents.find((node) => node.id === 'first')).toMatchObject({ order: 1, title: 'Scene 2 — Arrival' });
    expect(facade.saveDocument).toHaveBeenCalledTimes(2);
  });

  it('refuses drag ordering across Collections instead of silently converting a Node', async () => {
    const facade = fakeFacade();
    facade.saveDocument = vi.fn();
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.navigator.collections = [
      { id: 'chapters', name: 'Chapters', singularName: 'Chapter', order: 0, icon: 'folder', numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true } },
      { id: 'beats', name: 'Scene Beats', singularName: 'Scene Beat', order: 1, icon: 'folder', numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true } }
    ];
    workspace.documents = [
      document(),
      { ...document(), id: 'chapter', parentId: 'chapters', title: 'Chapter 1', role: 'navigator_node', extensions: { navigator: { collectionId: 'chapters', optionalTitle: '', kind: 'item' } } },
      { ...document('Claire challenges the doctor.'), id: 'beat', parentId: 'chapter', title: 'Scene Beat 1 — Claire and the doctor', role: 'navigator_node', extensions: { navigator: { collectionId: 'beats', optionalTitle: 'Claire and the doctor', kind: 'item' } } }
    ];

    await workspace.moveNavigatorNode('beat', { parentId: 'chapters', beforeNodeId: 'chapter' });

    expect(workspace.documents.find((node) => node.id === 'beat')).toMatchObject({
      parentId: 'chapter', title: 'Scene Beat 1 — Claire and the doctor', content: 'Claire challenges the doctor.',
      extensions: { navigator: { collectionId: 'beats', optionalTitle: 'Claire and the doctor', kind: 'item' } }
    });
    expect(workspace.notice).toContain('explicit conversion');
    expect(facade.saveDocument).not.toHaveBeenCalled();
  });

  it('keeps Navigator focus history separate from the active document projection', async () => {
    const facade = fakeFacade();
    facade.suggestionHistory = vi.fn(async () => ({ events: [], stats: { events: 0, costUsd: 0 } }));
    facade.createDocument = vi.fn(async (input) => ({
      id: input.id!, projectId: input.projectId, parentId: input.parentId ?? null, title: input.title,
      order: 3, revision: 1, role: input.role, extensions: input.extensions ?? {}, kind: 'document' as const,
      content: '', updatedAt: '2026-08-18T00:00:00Z'
    }));
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    const workspace = new WorkspaceState(facade);
    workspace.projectId = 'project';
    workspace.branchId = 'spine';
    workspace.projects = [project()];
    workspace.documents = [
      { ...document(), id: 'spine', title: 'Spine', role: 'spine' },
      { ...document(), id: 'chapter', parentId: 'chapters', title: 'Chapter 1', role: 'navigator_node', extensions: { navigator: { collectionId: 'chapters', optionalTitle: '', kind: 'item' } } },
      { ...document(), id: 'scene', parentId: 'chapter', title: 'Scene Beat 1', role: 'navigator_node', extensions: { navigator: { collectionId: 'beats', optionalTitle: '', kind: 'item' } } },
      { ...document(), id: 'todo', parentId: 'todos', title: 'Strengthen the scene', role: 'navigator_todo' }
    ];

    await workspace.openNavigatorNode('chapter');
    await workspace.openNavigatorNode('scene');

    expect(workspace.navigatorMemory.mode).toBe('context');
    expect(workspace.navigatorFocusNode?.id).toBe('scene');
    expect(workspace.selectedNodeParent?.id).toBe('chapter');
    expect(workspace.navigatorBackId).toBe('chapter');

    await workspace.openNavigatorNode('todo');
    expect(workspace.currentDocument?.id).toBe('todo');
    expect(workspace.navigatorFocusNode?.id).toBe('scene');

    await workspace.openNavigatorNode('chapter', 'back');
    expect(workspace.navigatorFocusNode?.id).toBe('chapter');
    expect(workspace.navigatorForwardId).toBe('scene');

    await workspace.openNavigatorNode('spine');
    const spineTodo = await workspace.createNavigatorTodo('Review the project premise');
    expect(workspace.navigatorFocusNode?.id).toBe('spine');
    expect(spineTodo?.targetNodeIds).toEqual(['spine']);
  });

  it('undoes and redoes a persisted Navigator move as one named transaction', async () => {
    const facade = fakeFacade();
    const workspace = new WorkspaceState(facade);
    facade.saveDocument = vi.fn(async (input) => {
      const current = workspace.documents.find((node) => node.id === input.id)!;
      return { ...current, ...input, revision: current.revision + 1, updatedAt: '2026-08-18T00:00:01Z' } as WorkspaceDocument;
    });
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.navigator.collections = [{
      id: 'scenes', name: 'Scenes', singularName: 'Scene', order: 0, icon: 'folder',
      numbering: { enabled: true, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true }
    }];
    workspace.documents = [
      document(),
      { ...document(), id: 'scenes', title: 'Scenes', role: 'navigator_collection' },
      { ...document(), id: 'chapter', parentId: 'scenes', title: 'Scene 1 — Chapter', role: 'navigator_node', order: 0, extensions: { navigator: { collectionId: 'scenes', optionalTitle: 'Chapter', kind: 'item' } } },
      { ...document(), id: 'arrival', parentId: 'scenes', title: 'Scene 2 — Arrival', role: 'navigator_node', order: 1, extensions: { navigator: { collectionId: 'scenes', optionalTitle: 'Arrival', kind: 'item' } } }
    ];

    await workspace.recordNavigatorChange('Place Arrival inside Chapter', () => workspace.moveNavigatorNode('arrival', { parentId: 'chapter' }));

    expect(workspace.documents.find((node) => node.id === 'arrival')?.parentId).toBe('chapter');
    expect(workspace.navigatorUndoLabel).toBe('Place Arrival inside Chapter');
    await workspace.undoNavigator();
    expect(workspace.documents.find((node) => node.id === 'arrival')?.parentId).toBe('scenes');
    expect(workspace.canRedoNavigator).toBe(true);
    await workspace.redoNavigator();
    expect(workspace.documents.find((node) => node.id === 'arrival')?.parentId).toBe('chapter');
    expect(facade.saveProject).toHaveBeenCalledTimes(2);
  });

  it('restores removed material, Todos, and relationships with Navigator Undo', async () => {
    const facade = fakeFacade();
    const workspace = new WorkspaceState(facade);
    facade.saveDocument = vi.fn(async (input) => {
      const current = workspace.documents.find((node) => node.id === input.id) ?? { ...document(), id: input.id };
      return { ...current, ...input, revision: current.revision + 1, updatedAt: '2026-08-18T00:00:01Z' } as WorkspaceDocument;
    });
    facade.createDocument = vi.fn(async (input) => ({
      id: input.id!, projectId: input.projectId, parentId: input.parentId ?? null, title: input.title,
      order: 0, revision: 1, role: input.role, extensions: input.extensions ?? {}, kind: 'document' as const,
      content: input.content ?? '', updatedAt: '2026-08-18T00:00:00Z'
    }));
    facade.deleteDocument = vi.fn(async () => undefined);
    facade.saveProject = vi.fn(async (_id, _title, extensions) => ({ ...project(), extensions: extensions ?? {} }));
    workspace.projectId = 'project';
    workspace.projects = [project()];
    workspace.navigator = {
      version: 1,
      revision: 1,
      collections: [{ id: 'notes', name: 'Notes', singularName: 'Note', order: 0, icon: 'folder', numbering: { enabled: false, start: 1 }, capabilities: { contentBearing: true, mayContainChildren: true } }],
      relationshipDefinitions: [],
      todos: [{ id: 'todo', title: 'Check clue', targetNodeIds: ['clue'], state: 'open', createdAt: '2026-08-18T00:00:00Z' }],
      relationships: [{ id: 'relation', sourceNodeId: 'clue', targetNodeId: 'main', type: 'supports', inverseType: 'supported by', confirmed: true }]
    };
    workspace.documents = [
      document(),
      { ...document(), id: 'notes', title: 'Notes', role: 'navigator_collection' },
      { ...document(), id: 'clue', parentId: 'notes', title: 'Clue', role: 'navigator_node', extensions: { navigator: { collectionId: 'notes', optionalTitle: 'Clue', kind: 'item' } } },
      { ...document(), id: 'todo', parentId: 'clue', title: 'Check clue', role: 'navigator_todo' }
    ];

    await workspace.recordNavigatorChange('Remove selected Navigator entries', () => workspace.removeNavigatorEntries({ nodeIds: ['clue'], todoIds: ['todo'], relationshipIds: ['relation'] }));

    expect(workspace.documents.find((node) => node.id === 'clue')?.extensions.navigator).toMatchObject({ archived: true });
    expect(workspace.documents.some((node) => node.id === 'todo')).toBe(false);
    expect(workspace.navigator.relationships).toHaveLength(0);
    await workspace.undoNavigator();
    expect(workspace.documents.find((node) => node.id === 'clue')?.parentId).toBe('notes');
    expect(workspace.documents.find((node) => node.id === 'clue')?.extensions.navigator).not.toHaveProperty('archived');
    expect(workspace.documents.find((node) => node.id === 'todo')?.title).toBe('Check clue');
    expect(workspace.navigator.todos).toHaveLength(1);
    expect(workspace.navigator.relationships).toHaveLength(1);
  });
});
