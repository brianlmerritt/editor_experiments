import { describe, expect, it, vi } from 'vitest';
import type { InputProposal, LedgerEvent, Suggestion, TaskPrompt } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
import type { WorkspaceFacade } from '$lib/workspace/facade';
import type { WorkspaceDocument, WorkspaceProject } from '$lib/workspace/model';
import type { EditorDocumentSnapshot } from '$lib/workspace/transactions';
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
  });
});
