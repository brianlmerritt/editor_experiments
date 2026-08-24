import { Fragment, Slice } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { describe, expect, it } from 'vitest';
import { editorSchema as schema } from './schema';
import { toggleList } from './formatting';
import { normalizeListSlice, normalizeSelectedList } from './list-normalization';

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

function normalize(nodes: ReturnType<typeof paragraph>[], minimumRun = 2) {
  return normalizeListSlice(new Slice(Fragment.fromArray(nodes), 0, 0), schema, { minimumRun });
}

describe('pasted list normalization', () => {
  it('removes visible numbers duplicated inside a semantic ordered list', () => {
    const first = schema.nodes.paragraph.create(null, [
      schema.text('1.', [schema.marks.strong.create()]),
      schema.text(' First')
    ]);
    const items = [first, paragraph('2. Second')].map((content) => schema.nodes.list_item.create(null, content));
    const list = schema.nodes.ordered_list.create({ order: 1 }, items);
    const result = normalizeListSlice(new Slice(Fragment.from(list), 0, 0), schema);

    expect(result.content.firstChild?.type).toBe(schema.nodes.ordered_list);
    expect(result.content.firstChild?.textContent).toBe('FirstSecond');
  });

  it('keeps markers out of item text when a repaired list changes between number and bullet styles', () => {
    const repaired = normalize([paragraph('1. First'), paragraph('2. Second')]);
    const doc = schema.nodes.doc.create(null, repaired.content);
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 3, doc.content.size - 3) });
    expect(toggleList('bullet_list')(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.firstChild?.type).toBe(schema.nodes.bullet_list);
    expect(state.doc.textContent).toBe('FirstSecond');

    expect(toggleList('ordered_list')(state, (transaction) => { state = state.apply(transaction); })).toBe(true);
    expect(state.doc.firstChild?.type).toBe(schema.nodes.ordered_list);
    expect(state.doc.textContent).toBe('FirstSecond');
  });

  it('removes visible bullets duplicated inside a semantic bullet list', () => {
    const items = ['• First', '▪ Second'].map((text) => schema.nodes.list_item.create(null, paragraph(text)));
    const list = schema.nodes.bullet_list.create(null, items);
    const result = normalizeListSlice(new Slice(Fragment.from(list), 0, 0), schema);

    expect(result.content.firstChild?.type).toBe(schema.nodes.bullet_list);
    expect(result.content.firstChild?.textContent).toBe('FirstSecond');
  });

  it('turns consecutive numbered paragraphs into one semantic ordered list', () => {
    const result = normalize([paragraph('3. Third'), paragraph('4) Fourth')]);
    const list = result.content.firstChild;

    expect(list?.type).toBe(schema.nodes.ordered_list);
    expect(list?.attrs.order).toBe(3);
    expect(list?.textContent).toBe('ThirdFourth');
  });

  it('turns recognised bullet paragraphs into a semantic bullet list without treating dashes as bullets', () => {
    const result = normalize([paragraph('• First'), paragraph('\uF0B7 Second'), paragraph('- Dialogue')]);

    expect(result.content.childCount).toBe(2);
    expect(result.content.firstChild?.type).toBe(schema.nodes.bullet_list);
    expect(result.content.firstChild?.textContent).toBe('FirstSecond');
    expect(result.content.lastChild?.textContent).toBe('- Dialogue');
  });

  it('leaves a single marker paragraph alone during automatic paste normalization', () => {
    const result = normalize([paragraph('1. Chapter opening')]);
    expect(result.content.firstChild?.type).toBe(schema.nodes.paragraph);
    expect(result.content.firstChild?.textContent).toBe('1. Chapter opening');
  });

  it('normalises a selected single marker when explicitly requested', () => {
    const doc = schema.nodes.doc.create(null, paragraph('• Only item'));
    let state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1, doc.content.size - 1) });
    const handled = normalizeSelectedList(state, (transaction) => { state = state.apply(transaction); });

    expect(handled).toBe(true);
    expect(state.doc.firstChild?.type).toBe(schema.nodes.bullet_list);
    expect(state.doc.textContent).toBe('Only item');
  });
});
