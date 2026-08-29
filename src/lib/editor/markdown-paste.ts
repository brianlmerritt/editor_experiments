import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from 'prosemirror-model';

const markdownBlock = /^(?: {0,3}#{1,6}\s+| {0,3}(?:[-+*]|\d+[.)])\s+| {0,3}>\s*| {0,3}(?:`{3,}|~{3,})| {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$)/m;

export function isMarkdownClipboard(text: string, html: string): boolean {
  if (!text.trim() || html.includes('data-pm-slice')) return false;
  return markdownBlock.test(text.replace(/\r\n?/g, '\n'));
}

export function collapseDuplicateEmptyParagraphs(slice: Slice): { slice: Slice; changed: boolean } {
  const blocks: ProseMirrorNode[] = [];
  let previousWasEmptyParagraph = false;
  let changed = false;

  slice.content.forEach((block) => {
    const emptyParagraph = block.type.name === 'paragraph' && block.content.size === 0;
    if (emptyParagraph && previousWasEmptyParagraph) {
      changed = true;
      return;
    }
    blocks.push(block);
    previousWasEmptyParagraph = emptyParagraph;
  });

  return changed
    ? { slice: new Slice(Fragment.fromArray(blocks), slice.openStart, slice.openEnd), changed: true }
    : { slice, changed: false };
}

function textNode(schema: Schema, text: string): ProseMirrorNode[] {
  return text ? [schema.text(text)] : [];
}

/**
 * Parse the structural Markdown that matters during paste without turning the editor
 * into a Markdown source editor. Wrapped source lines become one paragraph and blank
 * separator lines do not become empty editor paragraphs.
 */
export function markdownPasteSlice(text: string, schema: Schema): Slice {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ProseMirrorNode[] = [];
  let paragraph: string[] = [];
  let pendingBlankParagraph = false;

  const preservePendingBlank = (): void => {
    if (!pendingBlankParagraph || !blocks.length) return;
    blocks.push(schema.nodes.paragraph.create());
    pendingBlankParagraph = false;
  };

  const flushParagraph = (): void => {
    const value = paragraph.map((line) => line.trim()).filter(Boolean).join(' ');
    if (value) {
      preservePendingBlank();
      blocks.push(schema.nodes.paragraph.create(null, textNode(schema, value)));
    }
    paragraph = [];
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      flushParagraph();
      pendingBlankParagraph = blocks.length > 0;
      index += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      preservePendingBlank();
      blocks.push(schema.nodes.heading.create(
        { level: Math.min(6, heading[1].length) },
        textNode(schema, heading[2])
      ));
      index += 1;
      continue;
    }

    if (/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushParagraph();
      preservePendingBlank();
      blocks.push(schema.nodes.horizontal_rule.create());
      index += 1;
      continue;
    }

    const list = /^ {0,3}([-+*]|(\d+)[.)])\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      preservePendingBlank();
      const ordered = Boolean(list[2]);
      const items: ProseMirrorNode[] = [];
      const start = ordered ? Number(list[2]) : 1;
      while (index < lines.length) {
        const item = /^ {0,3}([-+*]|(\d+)[.)])\s+(.+)$/.exec(lines[index]);
        if (!item || Boolean(item[2]) !== ordered) break;
        const itemParagraph = schema.nodes.paragraph.create(null, textNode(schema, item[3].trim()));
        items.push(schema.nodes.list_item.create(null, itemParagraph));
        index += 1;
      }
      const listType = ordered ? schema.nodes.ordered_list : schema.nodes.bullet_list;
      blocks.push(listType.create(ordered ? { order: start } : null, items));
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return new Slice(Fragment.fromArray(blocks), 0, 0);
}
