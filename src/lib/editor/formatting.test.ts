import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection, type Command } from 'prosemirror-state';
import { editorSchema as schema } from './schema';
import {
  clearFormatting,
  formattingState,
  setLink,
  setTextBlockStyle,
  toggleBlockquote,
  toggleInlineMark,
  toggleList
} from './formatting';

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, schema.text(text));
}

function stateWithSelection(from = 1, to = 4): EditorState {
  const doc = schema.nodes.doc.create(null, [paragraph('One'), paragraph('Two')]);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, from, to) });
}

function run(state: EditorState, command: Command): EditorState {
  const handled = command(state, (transaction) => { state = state.apply(transaction); });
  expect(handled).toBe(true);
  return state;
}

describe('structural formatting commands', () => {
  it('toggles inline marks and reports the active selection state', () => {
    let state = run(stateWithSelection(), toggleInlineMark('bold'));
    expect(formattingState(state).bold).toBe(true);
    expect(state.doc.rangeHasMark(1, 4, schema.marks.strong)).toBe(true);

    state = run(state, toggleInlineMark('bold'));
    expect(formattingState(state).bold).toBe(false);
  });

  it('sets headings and clears marks and heading structure together', () => {
    let state = run(stateWithSelection(), setTextBlockStyle('heading2'));
    state = run(state, toggleInlineMark('italic'));
    expect(formattingState(state).blockStyle).toBe('heading2');
    expect(formattingState(state).italic).toBe(true);

    state = run(state, clearFormatting);
    expect(formattingState(state).blockStyle).toBe('paragraph');
    expect(formattingState(state).italic).toBe(false);
  });

  it('wraps, converts and removes lists without changing their text', () => {
    let state = stateWithSelection(1, 8);
    state = run(state, toggleList('bullet_list'));
    expect(state.doc.firstChild?.type).toBe(schema.nodes.bullet_list);
    expect(state.doc.textContent).toBe('OneTwo');

    state = run(state, toggleList('ordered_list'));
    expect(state.doc.firstChild?.type).toBe(schema.nodes.ordered_list);

    state = run(state, toggleList('ordered_list'));
    expect(state.doc.firstChild?.type).toBe(schema.nodes.paragraph);
    expect(state.doc.textContent).toBe('OneTwo');
  });

  it('toggles a block quote and adds or removes a link', () => {
    let state = run(stateWithSelection(), toggleBlockquote);
    expect(formattingState(state).blockquote).toBe(true);
    state = run(state, toggleBlockquote);
    expect(formattingState(state).blockquote).toBe(false);

    state = run(state, setLink('https://example.com'));
    expect(formattingState(state).linkHref).toBe('https://example.com');
    state = run(state, setLink(''));
    expect(formattingState(state).link).toBe(false);
  });
});
