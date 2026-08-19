import { describe, expect, it, vi } from 'vitest';
import type { InputProposal, LedgerEvent, Suggestion, TaskPrompt } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
import type { WorkspaceFacade } from '$lib/workspace/facade';
import type { WorkspaceDocument } from '$lib/workspace/model';
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
