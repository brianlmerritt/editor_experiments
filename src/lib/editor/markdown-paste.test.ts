import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from './schema';
import { Fragment, Slice } from 'prosemirror-model';
import { collapseDuplicateEmptyParagraphs, isMarkdownClipboard, markdownPasteSlice } from './markdown-paste';

describe('Markdown paste', () => {
  it('does not reinterpret an internal ProseMirror copy', () => {
    expect(isMarkdownClipboard('# Heading', '<h1 data-pm-slice="0 0 []">Heading</h1>')).toBe(false);
  });

  it('does not reinterpret ordinary plain prose', () => {
    expect(isMarkdownClipboard('One paragraph\nAnother paragraph', '')).toBe(false);
  });

  it('recognises Markdown copied as source text', () => {
    expect(isMarkdownClipboard('# Heading\n\nFirst paragraph.', '')).toBe(true);
  });

  it('prefers Google Docs HTML paragraphs even when the prose contains a Markdown separator', () => {
    const text = ['First paragraph.', 'Second paragraph.', '***', 'Third paragraph.'].join('\n');
    const html = '<b id="docs-internal-guid-test"><p>First paragraph.</p><p>Second paragraph.</p><hr><p>Third paragraph.</p></b>';

    expect(isMarkdownClipboard(text, html, [
      'text/plain',
      'text/html',
      'application/x-vnd.google-docs-document-slice-clip+wrapped'
    ])).toBe(false);
  });

  it('prefers structured rich HTML over a coincidental Markdown marker', () => {
    expect(isMarkdownClipboard(
      'First paragraph.\n***\nSecond paragraph.',
      '<p>First paragraph.</p><hr><p>Second paragraph.</p>'
    )).toBe(false);
  });

  it('groups wrapped Markdown lines and preserves one blank separator paragraph', () => {
    const slice = markdownPasteSlice([
      '# Chapter One',
      '',
      'This paragraph is wrapped across',
      'two source lines.',
      '',
      '',
      'The next paragraph.'
    ].join('\n'), editorSchema);

    expect(slice.content.toJSON()).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter One' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'This paragraph is wrapped across two source lines.' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'The next paragraph.' }] }
    ]);
  });

  it('recognises basic Markdown lists', () => {
    const slice = markdownPasteSlice('- One\n- Two\n\n3. Three\n4. Four', editorSchema);
    const json = slice.content.toJSON();

    expect(json[0].type).toBe('bullet_list');
    expect(json[1]).toEqual({ type: 'paragraph' });
    expect(json[2]).toMatchObject({ type: 'ordered_list', attrs: { order: 3 } });
  });

  it('does not leave the destination empty paragraph around a full Markdown paste', () => {
    const state = EditorState.create({
      schema: editorSchema,
      doc: editorSchema.nodes.doc.create(null, editorSchema.nodes.paragraph.create())
    });
    const transaction = state.tr.replaceSelection(markdownPasteSlice('# Heading\n\nFirst paragraph.\n\nSecond paragraph.', editorSchema));

    expect(transaction.doc.toJSON().content).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph.' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph.' }] }
    ]);
  });

  it('collapses duplicate pasted empty paragraphs but preserves one intentional blank', () => {
    const paragraph = (text?: string) => editorSchema.nodes.paragraph.create(
      null,
      text ? editorSchema.text(text) : undefined
    );
    const source = new Slice(Fragment.fromArray([
      paragraph('First'), paragraph(), paragraph(), paragraph('Second')
    ]), 0, 0);

    const result = collapseDuplicateEmptyParagraphs(source);

    expect(result.changed).toBe(true);
    expect(result.slice.content.toJSON()).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }
    ]);
  });

  it('leaves a single intentional empty paragraph unchanged', () => {
    const empty = editorSchema.nodes.paragraph.create();
    const source = new Slice(Fragment.fromArray([empty]), 0, 0);

    expect(collapseDuplicateEmptyParagraphs(source)).toEqual({ slice: source, changed: false });
  });
});
