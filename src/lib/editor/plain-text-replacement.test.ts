import { describe, expect, it } from 'vitest';
import { EditorState } from 'prosemirror-state';
import { editorSchema as schema } from './schema';
import { multilineReplacementSlice } from './plain-text-replacement';

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
}

describe('plain-text AI replacement', () => {
  it('keeps a single-line replacement inline', () => {
    expect(multilineReplacementSlice('One paragraph.', schema)).toBeNull();
  });

  it('turns LF, CRLF, and blank-line separators into manuscript paragraphs', () => {
    const slice = multilineReplacementSlice('First paragraph.\r\n\r\nSecond paragraph.\nThird paragraph.', schema);

    expect(slice?.content.toJSON()).toEqual([
      paragraph('First paragraph.').toJSON(),
      paragraph('Second paragraph.').toJSON(),
      paragraph('Third paragraph.').toJSON()
    ]);
  });

  it('replaces selected prose with block structure rather than embedded newline characters', () => {
    const state = EditorState.create({
      schema,
      doc: schema.nodes.doc.create(null, paragraph('Original paragraph.'))
    });
    const slice = multilineReplacementSlice('Replacement one.\n\nReplacement two.', schema)!;
    const transaction = state.tr.replaceRange(1, 20, slice);

    expect(transaction.doc.toJSON()).toEqual(schema.nodes.doc.create(null, [
      paragraph('Replacement one.'),
      paragraph('Replacement two.')
    ]).toJSON());
  });
});
