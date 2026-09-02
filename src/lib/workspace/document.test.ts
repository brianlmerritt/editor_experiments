import { describe, expect, it } from 'vitest';
import type { EditorDocumentSnapshot } from './transactions';
import { completeDocumentMappedRange, completeDocumentRange, documentCraftParagraphs, documentMarkdownBetween, documentParagraphs, documentTextBetween, mappedDocumentRangeMatches } from './document';

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

  it('gives providers a Markdown emphasis reference without changing canonical text', () => {
    const formatted: EditorDocumentSnapshot = {
      doc: {
        type: 'doc',
        content: [{
          type: 'paragraph',
          content: [
            { type: 'text', text: 'The Shard said, ' },
            { type: 'text', text: 'We remember.', marks: [{ type: 'em' }] },
            { type: 'text', text: ' Marcus listened.' }
          ]
        }]
      },
      text: 'The Shard said, We remember. Marcus listened.',
      selection: { from: 1, to: 1 }
    };

    expect(documentTextBetween(formatted, 1, 46)).toBe('The Shard said, We remember. Marcus listened.');
    expect(documentMarkdownBetween(formatted, 1, 46)).toBe('The Shard said, *We remember.* Marcus listened.');
    const captured = completeDocumentMappedRange(formatted);
    expect(mappedDocumentRangeMatches({
      ...formatted,
      doc: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The Shard said, We remember. Marcus listened.' }] }]
      }
    }, captured)).toBe(false);
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

  it('compares whole-document review targets through the same mapped projection used at dispatch', () => {
    const structured: EditorDocumentSnapshot = {
      doc: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Opening' }] },
          { type: 'paragraph' },
          { type: 'horizontal_rule' },
          { type: 'paragraph', content: [{ type: 'text', text: 'The story begins.' }] }
        ]
      },
      text: 'Opening\n\nThe story begins.',
      selection: { from: 0, to: 0 }
    };
    const captured = completeDocumentMappedRange(structured);

    expect(mappedDocumentRangeMatches(structured, captured)).toBe(true);
    expect(documentTextBetween(structured, captured.from, captured.to)).not.toBe(captured.text);
    expect(mappedDocumentRangeMatches({
      ...structured,
      doc: {
        ...structured.doc,
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Opening' }] },
          { type: 'paragraph' },
          { type: 'horizontal_rule' },
          { type: 'paragraph', content: [{ type: 'text', text: 'A changed beginning.' }] }
        ]
      }
    }, captured)).toBe(false);
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
