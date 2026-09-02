import { describe, expect, it } from 'vitest';
import type { Suggestion } from '$lib/domain';
import { textTarget, type FormatAttachment } from './attachments';
import { applyAttachmentChanges } from './mutations';

function craftInput(overrides: Partial<Suggestion> = {}): Suggestion {
  return {
    id: 'input-1',
    kind: 'craft_suggestion',
    source: 'local-craft',
    sourceNumber: 1,
    sourceKind: 'local',
    target: textTarget('main', 10, 17, 'noticed'),
    behaviourId: 'craft-input',
    events: [],
    anchor: { from: 10, to: 17, text: 'noticed' },
    type: 'annotation',
    payload: { comment: 'Check the filter word.' },
    category: 'distance',
    confidence: 0.8,
    variants: [],
    state: 'pending',
    order: 10,
    createdAt: '2026-08-18T00:00:00Z',
    provenance: { promptVersion: 1, briefVersion: 1 },
    ...overrides
  };
}

describe('attachment mutations', () => {
  it('moves resolved inputs as preceding prose changes', () => {
    const result = applyAttachmentChanges({
      inputs: [craftInput({ state: 'rejected' })],
      formats: [],
      changes: [{ nodeId: 'main', from: 1, to: 1, insertedLength: 8 }],
      revision: 2,
      transactionId: 'tx-1'
    });

    expect(result.inputs[0]).toMatchObject({ state: 'rejected', anchor: { from: 18, to: 25 } });
    expect(result.inputs[0].target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 18, end: 25 }]);
  });

  it('retains a fully deleted input in a managed target-removed state', () => {
    const result = applyAttachmentChanges({
      inputs: [craftInput()],
      formats: [],
      changes: [{ nodeId: 'main', from: 10, to: 17, insertedLength: 0 }],
      revision: 2,
      transactionId: 'tx-delete'
    });

    expect(result.inputs[0].state).toBe('target_removed');
    expect(result.inputs[0].events.at(-1)).toMatchObject({
      type: 'target_removed',
      revision: 3,
      transactionId: 'tx-delete',
      previousExcerpt: 'noticed'
    });
  });

  it('accepts proxied application state at the mutation boundary', () => {
    const record = craftInput();
    record.target = new Proxy(record.target, {});

    const result = applyAttachmentChanges({
      inputs: [record],
      formats: [],
      changes: [{ nodeId: 'main', from: 10, to: 17, insertedLength: 0 }],
      revision: 2,
      transactionId: 'tx-proxy'
    });

    expect(result.inputs[0].events.at(-1)?.previousTarget?.targets).toHaveLength(1);
  });

  it('marks the accepted input accepted while other overlapping inputs become changed', () => {
    const result = applyAttachmentChanges({
      inputs: [craftInput(), craftInput({ id: 'input-2' })],
      formats: [],
      changes: [{ nodeId: 'main', from: 10, to: 17, insertedLength: 3 }],
      revision: 2,
      transactionId: 'tx-accept',
      acceptedInputId: 'input-1'
    });

    expect(result.inputs.map((item) => item.state)).toEqual(['accepted', 'target_changed']);
  });

  it('keeps replacement text within the same formatted target', () => {
    const format: FormatAttachment = {
      id: 'format-1',
      target: textTarget('main', 10, 30),
      properties: { strikethrough: true },
      behaviourId: 'format-default',
      priority: 10,
      createdAtRevision: 1
    };
    const result = applyAttachmentChanges({
      inputs: [],
      formats: [format],
      changes: [{ nodeId: 'main', from: 16, to: 20, insertedLength: 6 }],
      revision: 2,
      transactionId: 'tx-format'
    });

    expect(result.formats[0].target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 10, end: 32 }]);
  });

  it('moves every evidence anchor through one Svelte-owned editor transaction', () => {
    const repeated = craftInput({
      target: {
        mode: 'snapshot',
        targets: [
          { type: 'text', nodeId: 'main', start: 30, end: 34 },
          { type: 'text', nodeId: 'main', start: 10, end: 14 },
          { type: 'text', nodeId: 'main', start: 20, end: 24 }
        ]
      },
      anchor: { from: 30, to: 34, text: 'third' },
      evidenceAnchors: [
        { from: 30, to: 34, text: 'third' },
        { from: 10, to: 14, text: 'first' },
        { from: 20, to: 24, text: 'second' }
      ]
    });
    const result = applyAttachmentChanges({
      inputs: [repeated], formats: [],
      changes: [{ nodeId: 'main', from: 2, to: 2, insertedLength: 5 }],
      revision: 2, transactionId: 'tx-move-cluster'
    });

    expect(result.inputs[0].target.targets).toEqual([
      { type: 'text', nodeId: 'main', start: 35, end: 39 },
      { type: 'text', nodeId: 'main', start: 15, end: 19 },
      { type: 'text', nodeId: 'main', start: 25, end: 29 }
    ]);
    expect(result.inputs[0].evidenceAnchors?.map(({ from, to }) => ({ from, to }))).toEqual([
      { from: 35, to: 39 }, { from: 15, to: 19 }, { from: 25, to: 29 }
    ]);
  });
});
