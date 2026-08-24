export type RichMarkType = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'code' | 'link';

export interface RichMark {
  type: RichMarkType;
  href?: string;
  title?: string;
}

export interface RichText {
  type: 'text';
  text: string;
  marks?: RichMark[];
}

export interface RichHardBreak {
  type: 'hard_break';
}

export interface RichImage {
  type: 'image';
  pasteId?: string;
  assetId?: string;
  src: string;
  alt?: string;
  title?: string;
  caption?: string;
  mimeType?: string;
  fileName?: string;
  state?: 'pending' | 'ready' | 'failed';
}

export type RichInline = RichText | RichHardBreak | RichImage;

export interface RichParagraph {
  type: 'paragraph';
  content: RichInline[];
}

export interface RichHeading {
  type: 'heading';
  level: number;
  content: RichInline[];
}

export interface RichBlockquote {
  type: 'blockquote';
  content: RichBlock[];
}

export interface RichTableCell {
  type: 'table_cell';
  content: RichBlock[];
}

export interface RichTableRow {
  type: 'table_row';
  cells: RichTableCell[];
}

export interface RichTable {
  type: 'table';
  rows: RichTableRow[];
}

export interface RichListItem {
  type: 'list_item';
  content: RichBlock[];
}

export interface RichBulletList {
  type: 'bullet_list';
  items: RichListItem[];
}

export interface RichOrderedList {
  type: 'ordered_list';
  order: number;
  items: RichListItem[];
}

export type RichList = RichBulletList | RichOrderedList;

export interface RichHorizontalRule {
  type: 'horizontal_rule';
}

export type RichBlock = RichParagraph | RichHeading | RichBlockquote | RichTable | RichList | RichHorizontalRule;

export interface RichDocument {
  version: 1;
  blocks: RichBlock[];
}

interface ProseMirrorJsonNode {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  marks?: ProseMirrorJsonNode[];
  content?: ProseMirrorJsonNode[];
}

function richMark(mark: ProseMirrorJsonNode): RichMark | null {
  switch (mark.type) {
    case 'strong': return { type: 'bold' };
    case 'em': return { type: 'italic' };
    case 'underline': return { type: 'underline' };
    case 'strikethrough': return { type: 'strikethrough' };
    case 'code': return { type: 'code' };
    case 'link': return {
      type: 'link',
      href: typeof mark.attrs?.href === 'string' ? mark.attrs.href : '',
      title: typeof mark.attrs?.title === 'string' ? mark.attrs.title : undefined
    };
    default: return null;
  }
}

function proseMirrorMark(mark: RichMark): ProseMirrorJsonNode {
  switch (mark.type) {
    case 'bold': return { type: 'strong' };
    case 'italic': return { type: 'em' };
    case 'underline': return { type: 'underline' };
    case 'strikethrough': return { type: 'strikethrough' };
    case 'code': return { type: 'code' };
    case 'link': return { type: 'link', attrs: { href: mark.href ?? '', title: mark.title ?? null } };
  }
}

function inlineFromProseMirror(node: ProseMirrorJsonNode): RichInline | null {
  if (node.type === 'text' && typeof node.text === 'string') {
    const marks = (node.marks ?? []).map(richMark).filter((mark): mark is RichMark => mark !== null);
    return { type: 'text', text: node.text, ...(marks.length ? { marks } : {}) };
  }
  if (node.type === 'hard_break') return { type: 'hard_break' };
  if (node.type === 'image' && typeof node.attrs?.src === 'string') {
    return {
      type: 'image',
      src: node.attrs.src,
      pasteId: typeof node.attrs.pasteId === 'string' ? node.attrs.pasteId : undefined,
      assetId: typeof node.attrs.assetId === 'string' ? node.attrs.assetId : undefined,
      alt: typeof node.attrs.alt === 'string' ? node.attrs.alt : undefined,
      title: typeof node.attrs.title === 'string' ? node.attrs.title : undefined,
      caption: typeof node.attrs.caption === 'string' ? node.attrs.caption : undefined,
      mimeType: typeof node.attrs.mimeType === 'string' ? node.attrs.mimeType : undefined,
      fileName: typeof node.attrs.fileName === 'string' ? node.attrs.fileName : undefined,
      state: node.attrs.state === 'pending' || node.attrs.state === 'failed' ? node.attrs.state : 'ready'
    };
  }
  return null;
}

function inlineToProseMirror(node: RichInline): ProseMirrorJsonNode {
  if (node.type === 'text') {
    return {
      type: 'text',
      text: node.text,
      ...(node.marks?.length ? { marks: node.marks.map(proseMirrorMark) } : {})
    };
  }
  if (node.type === 'hard_break') return { type: 'hard_break' };
  return {
    type: 'image',
    attrs: {
      src: node.src,
      pasteId: node.pasteId ?? null,
      assetId: node.assetId ?? null,
      alt: node.alt ?? null,
      title: node.title ?? null,
      caption: node.caption ?? null,
      mimeType: node.mimeType ?? null,
      fileName: node.fileName ?? null,
      state: node.state ?? 'ready'
    }
  };
}

function paragraphFromUnknown(node: ProseMirrorJsonNode): RichParagraph | null {
  const content = (node.content ?? []).map(inlineFromProseMirror).filter((item): item is RichInline => item !== null);
  if (!content.length) return null;
  return { type: 'paragraph', content };
}

function blockFromProseMirror(node: ProseMirrorJsonNode): RichBlock | null {
  if (node.type === 'paragraph') {
    return { type: 'paragraph', content: (node.content ?? []).map(inlineFromProseMirror).filter((item): item is RichInline => item !== null) };
  }
  if (node.type === 'heading') {
    return {
      type: 'heading',
      level: typeof node.attrs?.level === 'number' ? node.attrs.level : 1,
      content: (node.content ?? []).map(inlineFromProseMirror).filter((item): item is RichInline => item !== null)
    };
  }
  if (node.type === 'blockquote') {
    return { type: 'blockquote', content: (node.content ?? []).map(blockFromProseMirror).filter((item): item is RichBlock => item !== null) };
  }
  if (node.type === 'horizontal_rule') return { type: 'horizontal_rule' };
  if (node.type === 'table') {
    return {
      type: 'table',
      rows: (node.content ?? []).filter((row) => row.type === 'table_row').map((row) => ({
        type: 'table_row',
        cells: (row.content ?? []).filter((cell) => cell.type === 'table_cell' || cell.type === 'table_header').map((cell) => ({
          type: 'table_cell',
          content: (cell.content ?? []).map(blockFromProseMirror).filter((item): item is RichBlock => item !== null)
        }))
      }))
    };
  }
  if (node.type === 'bullet_list') {
    return {
      type: 'bullet_list',
      items: (node.content ?? []).filter((item) => item.type === 'list_item').map((item) => ({
        type: 'list_item',
        content: (item.content ?? []).map(blockFromProseMirror).filter((block): block is RichBlock => block !== null)
      }))
    };
  }
  if (node.type === 'ordered_list') {
    return {
      type: 'ordered_list',
      order: typeof node.attrs?.order === 'number' ? node.attrs.order : 1,
      items: (node.content ?? []).filter((item) => item.type === 'list_item').map((item) => ({
        type: 'list_item',
        content: (item.content ?? []).map(blockFromProseMirror).filter((block): block is RichBlock => block !== null)
      }))
    };
  }
  return paragraphFromUnknown(node);
}

function blockToProseMirror(node: RichBlock): ProseMirrorJsonNode {
  if (node.type === 'paragraph') return { type: 'paragraph', content: node.content.map(inlineToProseMirror) };
  if (node.type === 'heading') return { type: 'heading', attrs: { level: node.level }, content: node.content.map(inlineToProseMirror) };
  if (node.type === 'blockquote') return { type: 'blockquote', content: node.content.map(blockToProseMirror) };
  if (node.type === 'horizontal_rule') return { type: 'horizontal_rule' };
  if (node.type === 'bullet_list' || node.type === 'ordered_list') {
    return {
      type: node.type,
      ...(node.type === 'ordered_list' ? { attrs: { order: node.order ?? 1 } } : {}),
      content: node.items.map((item) => ({
        type: 'list_item',
        content: item.content.length ? item.content.map(blockToProseMirror) : [{ type: 'paragraph' }]
      }))
    };
  }
  if (node.type === 'table') {
    return {
      type: 'table',
      content: node.rows.map((row) => ({
        type: 'table_row',
        content: row.cells.map((cell) => ({
          type: 'table_cell',
          content: cell.content.length ? cell.content.map(blockToProseMirror) : [{ type: 'paragraph' }]
        }))
      }))
    };
  }
  return node satisfies never;
}

export function richDocumentFromProseMirror(value: Record<string, unknown>): RichDocument {
  const document = value as ProseMirrorJsonNode;
  return {
    version: 1,
    blocks: (document.content ?? []).map(blockFromProseMirror).filter((item): item is RichBlock => item !== null)
  };
}

export function richDocumentToProseMirror(document: RichDocument): Record<string, unknown> {
  return { type: 'doc', content: document.blocks.map(blockToProseMirror) };
}

export function richDocumentFromText(text: string): RichDocument {
  const paragraphs = text ? text.split(/\n\n/) : [''];
  return {
    version: 1,
    blocks: paragraphs.map((paragraph) => ({
      type: 'paragraph',
      content: paragraph ? [{ type: 'text', text: paragraph }] : []
    }))
  };
}

function inlineText(content: RichInline[]): string {
  return content.map((node) => {
    if (node.type === 'text') return node.text;
    if (node.type === 'hard_break') return '\n';
    return '\uFFFC';
  }).join('');
}

function blockText(block: RichBlock): string {
  if (block.type === 'paragraph' || block.type === 'heading') return inlineText(block.content);
  if (block.type === 'blockquote') return block.content.map(blockText).join('\n\n');
  if (block.type === 'horizontal_rule') return '---';
  if (block.type === 'bullet_list' || block.type === 'ordered_list') {
    return block.items.map((item, index) => {
      const marker = block.type === 'ordered_list' ? `${(block.order ?? 1) + index}.` : '•';
      return `${marker} ${item.content.map(blockText).join('\n')}`;
    }).join('\n');
  }
  if (block.type === 'table') {
    return block.rows.map((row) => row.cells.map((cell) => cell.content.map(blockText).join('\n')).join('\t')).join('\n');
  }
  return block satisfies never;
}

export function richDocumentText(document: RichDocument): string {
  return document.blocks.map(blockText).join('\n\n');
}

export function isRichDocument(value: unknown): value is RichDocument {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as { version?: unknown }).version === 1
    && Array.isArray((value as { blocks?: unknown }).blocks));
}
