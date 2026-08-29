import { describe, expect, it } from 'vitest';
import type { EditorDocumentSnapshot } from './transactions';
import { completeDocumentMappedRange, completeDocumentRange, documentCraftParagraphs, documentParagraphs, documentTextBetween } from './document';

const snapshot: EditorDocumentSnapshot = {
  doc: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] }
    ]
  },
  text: 'First paragraph.\n\nSecond paragraph.',
  selection: { from: 1, to: 1 }
};

describe('canonical document ranges', () => {
  it('derives craft-pass paragraphs from the Svelte document snapshot', () => {
    expect(documentParagraphs(snapshot)).toEqual([
      { from: 1, to: 17, text: 'First paragraph.' },
      { from: 19, to: 36, text: 'Second paragraph.' }
    ]);
  });

  it('reads selected text from the canonical snapshot', () => {
    expect(documentTextBetween(snapshot, 19, 25)).toBe('Second');
  });

  it('captures one exact rich-document range for a whole-document action', () => {
    expect(completeDocumentRange(snapshot)).toEqual({
      from: 0,
      to: 37,
      text: 'First paragraph.\nSecond paragraph.'
    });
  });

  it('maps whole-document review offsets back to editor positions across blocks and inline leaves', () => {
    const mapped = completeDocumentMappedRange({
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'A' },
              { type: 'image', attrs: { src: 'asset:test' } },
              { type: 'text', text: 'B' }
            ]
          }
        ]
      },
      text: 'One\n\nA\uFFFCB',
      selection: { from: 0, to: 0 }
    });

    expect(mapped.text).toBe('One\nA\uFFFCB');
    expect(mapped.textMap.starts).toEqual([1, 2, 3, 4, 6, 7, 8]);
    expect(mapped.textMap.ends).toEqual([2, 3, 4, 6, 7, 8, 9]);
  });

  it('does not dispatch standalone craft requests for headings or scene dividers', () => {
    const structured: EditorDocumentSnapshot = {
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '# Summer Storm' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Mara reached the station.' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '---' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'The porter waited.' }] }
        ]
      },
      text: '# Summer Storm\n\nMara reached the station.\n\n---\n\nThe porter waited.',
      selection: { from: 1, to: 1 }
    };

    expect(documentCraftParagraphs(structured).map((range) => range.text)).toEqual([
      'Mara reached the station.',
      'The porter waited.'
    ]);
  });
});
