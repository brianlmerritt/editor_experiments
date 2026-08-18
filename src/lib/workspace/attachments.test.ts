import { describe, expect, it } from 'vitest';
import { defaultAttachmentBehaviours, textTarget, transformTargetSet } from './attachments';

describe('shared content targets', () => {
  it('moves a target when text is inserted before it', () => {
    const result = transformTargetSet(
      textTarget('main', 10, 17, 'noticed'),
      [{ nodeId: 'main', from: 2, to: 2, insertedLength: 6 }],
      defaultAttachmentBehaviours['craft-input']
    );

    expect(result.change).toBe('moved');
    expect(result.target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 16, end: 23 }]);
  });

  it('marks a craft input changed when its text is edited', () => {
    const result = transformTargetSet(
      textTarget('main', 10, 17, 'noticed'),
      [{ nodeId: 'main', from: 12, to: 14, insertedLength: 3 }],
      defaultAttachmentBehaviours['craft-input']
    );

    expect(result.change).toBe('changed');
    expect(result.target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 10, end: 18 }]);
  });

  it('removes a format whose complete text target is deleted', () => {
    const result = transformTargetSet(
      textTarget('main', 10, 17),
      [{ nodeId: 'main', from: 10, to: 17, insertedLength: 0 }],
      defaultAttachmentBehaviours['format-default']
    );

    expect(result.change).toBe('removed');
    expect(result.target.targets).toEqual([]);
  });

  it('splits formatting around replacement text that should not inherit it', () => {
    const result = transformTargetSet(
      textTarget('main', 10, 30),
      [{ nodeId: 'main', from: 16, to: 20, insertedLength: 6 }],
      { ...defaultAttachmentBehaviours['format-default'], replacementText: 'exclude' }
    );

    expect(result.change).toBe('changed');
    expect(result.target.targets).toEqual([
      { type: 'text', nodeId: 'main', start: 10, end: 16 },
      { type: 'text', nodeId: 'main', start: 22, end: 32 }
    ]);
  });

  it('keeps replacement text formatted at either edge of a formatted range', () => {
    const atStart = transformTargetSet(
      textTarget('main', 10, 30),
      [{ nodeId: 'main', from: 10, to: 14, insertedLength: 7 }],
      defaultAttachmentBehaviours['format-default']
    );
    const atEnd = transformTargetSet(
      textTarget('main', 10, 30),
      [{ nodeId: 'main', from: 26, to: 30, insertedLength: 7 }],
      defaultAttachmentBehaviours['format-default']
    );

    expect(atStart.target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 10, end: 33 }]);
    expect(atEnd.target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 10, end: 33 }]);
  });

  it('includes text inserted at the start and end formatting boundaries', () => {
    const atStart = transformTargetSet(
      textTarget('main', 10, 30),
      [{ nodeId: 'main', from: 10, to: 10, insertedLength: 4 }],
      defaultAttachmentBehaviours['format-default']
    );
    const atEnd = transformTargetSet(
      textTarget('main', 10, 30),
      [{ nodeId: 'main', from: 30, to: 30, insertedLength: 4 }],
      defaultAttachmentBehaviours['format-default']
    );

    expect(atStart.target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 10, end: 34 }]);
    expect(atEnd.target.targets).toEqual([{ type: 'text', nodeId: 'main', start: 10, end: 34 }]);
  });

  it('keeps a live whole-document target attached through text edits', () => {
    const result = transformTargetSet(
      { mode: 'live', targets: [{ type: 'node', nodeId: 'main', includeDescendants: true }] },
      [{ nodeId: 'main', from: 10, to: 17, insertedLength: 0 }],
      defaultAttachmentBehaviours['format-default']
    );

    expect(result.change).toBe('changed');
    expect(result.target.targets).toEqual([{ type: 'node', nodeId: 'main', includeDescendants: true }]);
  });
});
