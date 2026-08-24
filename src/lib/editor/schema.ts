import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';

const underline: MarkSpec = {
  parseDOM: [
    { tag: 'u' },
    { style: 'text-decoration', getAttrs: (value) => typeof value === 'string' && value.includes('underline') ? null : false }
  ],
  toDOM: () => ['u', 0]
};

const strikethrough: MarkSpec = {
  parseDOM: [
    { tag: 's' },
    { tag: 'del' },
    { style: 'text-decoration', getAttrs: (value) => typeof value === 'string' && value.includes('line-through') ? null : false }
  ],
  toDOM: () => ['s', 0]
};

const image: NodeSpec = {
  inline: true,
  attrs: {
    src: {},
    pasteId: { default: null },
    assetId: { default: null },
    alt: { default: null },
    title: { default: null },
    caption: { default: null },
    mimeType: { default: null },
    fileName: { default: null },
    state: { default: 'ready' }
  },
  group: 'inline',
  draggable: true,
  leafText: () => '\uFFFC',
  parseDOM: [{
    tag: 'img[src]',
    getAttrs: (element) => {
      if (!(element instanceof HTMLElement)) return false;
      return {
        src: element.getAttribute('src'),
        pasteId: element.getAttribute('data-paste-id'),
        alt: element.getAttribute('alt'),
        title: element.getAttribute('title'),
        caption: element.getAttribute('data-caption'),
        assetId: element.getAttribute('data-asset-id'),
        mimeType: element.getAttribute('data-mime-type'),
        fileName: element.getAttribute('data-file-name'),
        state: element.getAttribute('data-state') ?? 'ready'
      };
    }
  }],
  toDOM: (node) => ['img', {
    src: node.attrs.src,
    'data-paste-id': node.attrs.pasteId,
    alt: node.attrs.alt,
    title: node.attrs.title,
    'data-caption': node.attrs.caption,
    'data-asset-id': node.attrs.assetId,
    'data-mime-type': node.attrs.mimeType,
    'data-file-name': node.attrs.fileName,
    'data-state': node.attrs.state
  }]
};

const table: NodeSpec = {
  content: 'table_row+',
  group: 'block',
  isolating: true,
  parseDOM: [{ tag: 'table' }],
  toDOM: () => ['table', ['tbody', 0]]
};

const tableRow: NodeSpec = {
  content: 'table_cell+',
  parseDOM: [{ tag: 'tr' }],
  toDOM: () => ['tr', 0]
};

const tableCell: NodeSpec = {
  content: 'block+',
  isolating: true,
  parseDOM: [{ tag: 'td' }, { tag: 'th' }],
  toDOM: () => ['td', 0]
};

const orderedList: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  attrs: { order: { default: 1 } },
  parseDOM: [{ tag: 'ol', getAttrs: (element) => {
    if (!(element instanceof HTMLElement)) return false;
    return { order: element.hasAttribute('start') ? Number(element.getAttribute('start')) : 1 };
  } }],
  toDOM: (node) => node.attrs.order === 1 ? ['ol', 0] : ['ol', { start: node.attrs.order }, 0]
};

const bulletList: NodeSpec = {
  content: 'list_item+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM: () => ['ul', 0]
};

const listItem: NodeSpec = {
  content: 'paragraph block*',
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM: () => ['li', 0]
};

const nodes = basicSchema.spec.nodes
  .update('image', image)
  .append({
    ordered_list: orderedList,
    bullet_list: bulletList,
    list_item: listItem,
    table,
    table_row: tableRow,
    table_cell: tableCell
  });

const marks = basicSchema.spec.marks.append({ underline, strikethrough });

export const editorSchema = new Schema({ nodes, marks });
