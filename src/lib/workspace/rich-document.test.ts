import { describe, expect, it } from 'vitest';
import {
  richDocumentFromProseMirror,
  richDocumentFromText,
  richDocumentText,
  richDocumentToProseMirror
} from './rich-document';

describe('rich document adapter', () => {
  it('migrates plain text without changing its paragraph text', () => {
    const document = richDocumentFromText('First paragraph.\n\nSecond paragraph.');
    expect(richDocumentText(document)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('round trips marks, tables and images through neutral canonical data', () => {
    const proseMirror = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A ' },
            { type: 'text', text: 'warning', marks: [{ type: 'strong' }, { type: 'underline' }] }
          ]
        },
        {
          type: 'bullet_list',
          content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this point' }] }] }]
        },
        {
          type: 'table',
          content: [{
            type: 'table_row',
            content: [
              { type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
              { type: 'table_cell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Claire' }] }] }
            ]
          }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { src: '/api/assets/asset_1', assetId: 'asset_1', alt: 'Hospital room', state: 'ready' } }]
        }
      ]
    };

    const canonical = richDocumentFromProseMirror(proseMirror);
    expect(canonical.blocks[0]).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'A ' }, { type: 'text', text: 'warning', marks: [{ type: 'bold' }, { type: 'underline' }] }]
    });
    expect(richDocumentText(canonical)).toBe('A warning\n\n• Keep this point\n\nName\tClaire\n\n\uFFFC');
    expect(richDocumentFromProseMirror(richDocumentToProseMirror(canonical))).toEqual(canonical);
  });
});
