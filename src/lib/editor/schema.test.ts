// @vitest-environment jsdom
import { DOMParser as ProseMirrorDomParser } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { richDocumentFromProseMirror } from '$lib/workspace/rich-document';
import { editorSchema } from './schema';

describe('editor paste schema', () => {
  it('parses table structure and supported Word-style inline formatting', () => {
    document.body.innerHTML = `
        <p><strong>Important</strong> and <span style="text-decoration: underline">underlined</span></p>
        <ul><li><p>First point</p></li><li><p>Second point</p></li></ul>
        <table><tbody><tr><td><p>Name</p></td><td><p>Claire</p></td></tr></tbody></table>
    `;
    const parsed = ProseMirrorDomParser.fromSchema(editorSchema).parse(document.body);
    const canonical = richDocumentFromProseMirror(parsed.toJSON());

    expect(canonical.blocks[0]).toMatchObject({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Important', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        { type: 'text', text: 'underlined', marks: [{ type: 'underline' }] }
      ]
    });
    expect(canonical.blocks[1]).toMatchObject({
      type: 'bullet_list',
      items: [
        { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First point' }] }] },
        { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second point' }] }] }
      ]
    });
    expect(canonical.blocks[2]).toMatchObject({
      type: 'table',
      rows: [{ cells: [{ content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] }, { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claire' }] }] }] }]
    });
  });
});
