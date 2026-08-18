import { describe, expect, it } from 'vitest';
import type { Suggestion } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
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

describe('semantic workspace history', () => {
  it('undoes and redoes accepted prose and input state together', () => {
    const workspace = new WorkspaceState();
    workspace.branchId = 'main';
    workspace.inputs = [input()];
    workspace.setEditorReady(beforeDocument);

    workspace.recordEditorTransaction({
      before: beforeDocument,
      after: afterDocument,
      changes: [{ nodeId: 'main', from: 1, to: 8, insertedLength: 3 }],
      origin: { kind: 'input_acceptance', inputId: 'input-1', source: 'local-craft' }
    });

    expect(workspace.inputs[0].state).toBe('accepted');
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
});
