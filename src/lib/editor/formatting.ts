import type { MarkType, Node as ProseMirrorNode, NodeType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';

export type TextBlockStyle = 'paragraph' | 'heading1' | 'heading2' | 'heading3';

export interface FormattingState {
  blockStyle: TextBlockStyle;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  bulletList: boolean;
  orderedList: boolean;
  blockquote: boolean;
  link: boolean;
  linkHref: string;
  hasSelection: boolean;
}

function ancestor(state: EditorState, type: NodeType): { node: ProseMirrorNode; pos: number } | null {
  const { $from, $to } = state.selection;
  for (let depth = Math.min($from.depth, $to.depth); depth > 0; depth -= 1) {
    if ($from.node(depth) === $to.node(depth) && $from.node(depth).type === type) {
      return { node: $from.node(depth), pos: $from.before(depth) };
    }
  }
  return null;
}

function markActive(state: EditorState, type: MarkType): boolean {
  const { empty, from, to, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

function activeLink(state: EditorState): { active: boolean; href: string } {
  const type = state.schema.marks.link;
  const { empty, from, to, $from } = state.selection;
  if (empty) {
    const mark = type.isInSet(state.storedMarks ?? $from.marks());
    return { active: Boolean(mark), href: typeof mark?.attrs.href === 'string' ? mark.attrs.href : '' };
  }
  let href = '';
  let active = false;
  state.doc.nodesBetween(from, to, (node) => {
    const mark = type.isInSet(node.marks);
    if (mark) {
      active = true;
      if (!href && typeof mark.attrs.href === 'string') href = mark.attrs.href;
    }
  });
  return { active, href };
}

export function formattingState(state: EditorState): FormattingState {
  const parent = state.selection.$from.parent;
  const blockStyle: TextBlockStyle = parent.type === state.schema.nodes.heading
    ? `heading${Math.max(1, Math.min(3, Number(parent.attrs.level) || 1))}` as TextBlockStyle
    : 'paragraph';
  const link = activeLink(state);
  return {
    blockStyle,
    bold: markActive(state, state.schema.marks.strong),
    italic: markActive(state, state.schema.marks.em),
    underline: markActive(state, state.schema.marks.underline),
    strikethrough: markActive(state, state.schema.marks.strikethrough),
    bulletList: Boolean(ancestor(state, state.schema.nodes.bullet_list)),
    orderedList: Boolean(ancestor(state, state.schema.nodes.ordered_list)),
    blockquote: Boolean(ancestor(state, state.schema.nodes.blockquote)),
    link: link.active,
    linkHref: link.href,
    hasSelection: !state.selection.empty
  };
}

export function setTextBlockStyle(style: TextBlockStyle): Command {
  return (state, dispatch) => {
    if (style === 'paragraph') return setBlockType(state.schema.nodes.paragraph)(state, dispatch);
    return setBlockType(state.schema.nodes.heading, { level: Number(style.slice(-1)) })(state, dispatch);
  };
}

export function toggleInlineMark(mark: 'bold' | 'italic' | 'underline' | 'strikethrough'): Command {
  return (state, dispatch) => {
    const type = {
      bold: state.schema.marks.strong,
      italic: state.schema.marks.em,
      underline: state.schema.marks.underline,
      strikethrough: state.schema.marks.strikethrough
    }[mark];
    return toggleMark(type)(state, dispatch);
  };
}

export function toggleList(typeName: 'bullet_list' | 'ordered_list'): Command {
  return (state, dispatch, view) => {
    const type = state.schema.nodes[typeName];
    const otherType = state.schema.nodes[typeName === 'bullet_list' ? 'ordered_list' : 'bullet_list'];
    const current = ancestor(state, type);
    if (current) return liftListItem(state.schema.nodes.list_item)(state, dispatch, view);
    const other = ancestor(state, otherType);
    if (other) {
      if (dispatch) dispatch(state.tr.setNodeMarkup(other.pos, type, typeName === 'ordered_list' ? { order: 1 } : null).scrollIntoView());
      return true;
    }
    return wrapInList(type)(state, dispatch, view);
  };
}

export const toggleBlockquote: Command = (state, dispatch, view) => {
  if (ancestor(state, state.schema.nodes.blockquote)) return lift(state, dispatch, view);
  return wrapIn(state.schema.nodes.blockquote)(state, dispatch, view);
};

export function setLink(href: string): Command {
  return (state, dispatch) => {
    if (state.selection.empty) return false;
    const { from, to } = state.selection;
    const transaction = state.tr.removeMark(from, to, state.schema.marks.link);
    if (href.trim()) transaction.addMark(from, to, state.schema.marks.link.create({ href: href.trim(), title: null }));
    if (dispatch) dispatch(transaction.scrollIntoView());
    return true;
  };
}

export const clearFormatting: Command = (state, dispatch) => {
  const { from, to, empty } = state.selection;
  let transaction = state.tr;
  if (empty) transaction = transaction.setStoredMarks([]);
  else transaction = transaction.removeMark(from, to);
  transaction = transaction.setBlockType(from, to, state.schema.nodes.paragraph);
  if (!transaction.steps.length && !transaction.storedMarksSet) return false;
  if (dispatch) dispatch(transaction.scrollIntoView());
  return true;
};
