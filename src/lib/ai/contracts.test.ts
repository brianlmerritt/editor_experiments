import { describe, expect, it } from 'vitest';
import { textTarget } from '$lib/workspace/attachments';
import { validReturnedContext, type AIContextManifest } from './contracts';

function manifest(): AIContextManifest {
  const target = {
    documentId: 'main',
    sourceRevision: 4,
    target: textTarget('main', 1, 8, 'noticed'),
    exactText: 'noticed',
    formattedText: '*noticed*'
  };
  return {
    workspaceRevision: 4,
    forkId: 'main',
    target,
    items: [
      {
        id: 'action:review:v1', sourceType: 'action', sourceId: 'review', sourceRevision: 1,
        role: 'protocol', title: 'Review', content: 'Review precisely.', reason: 'Selected action',
        inclusion: 'required', sent: true
      },
      {
        id: 'material:mara:2', sourceType: 'material', sourceId: 'mara', sourceRevision: 2,
        role: 'fact', title: 'Mara', content: 'Mara dislikes clocks.', reason: 'Selected Material',
        inclusion: 'resolved', sent: true
      }
    ]
  };
}

describe('AI context contract', () => {
  it('allows an optional item to be explicitly omitted for budget', () => {
    const requested = manifest();
    const returned = structuredClone(requested);
    returned.items[1] = { ...returned.items[1], sent: false, omissionReason: 'budget' };

    expect(validReturnedContext(requested, returned)).toBe(true);
  });

  it('rejects omission of required context', () => {
    const requested = manifest();
    const returned = structuredClone(requested);
    returned.items[0] = { ...returned.items[0], sent: false, omissionReason: 'budget' };

    expect(validReturnedContext(requested, returned)).toBe(false);
  });

  it('rejects hidden or rewritten context', () => {
    const requested = manifest();
    const hidden = structuredClone(requested);
    hidden.items.push({
      id: 'hidden', sourceType: 'material', sourceId: 'hidden', sourceRevision: 1,
      role: 'fact', title: 'Hidden', content: 'Secret database read', reason: 'Unreported lookup',
      inclusion: 'resolved', sent: true
    });
    const rewritten = structuredClone(requested);
    rewritten.items[1].content = 'Mara loves clocks.';
    const reformatted = structuredClone(requested);
    reformatted.target.formattedText = 'noticed';

    expect(validReturnedContext(requested, hidden)).toBe(false);
    expect(validReturnedContext(requested, rewritten)).toBe(false);
    expect(validReturnedContext(requested, reformatted)).toBe(false);
  });
});
