import { editorSchema as schema } from '$lib/editor/schema';
import type { EditorDocumentSnapshot } from './transactions';

export interface DocumentRange {
  from: number;
  to: number;
  text: string;
}

export interface DocumentTextMap {
  starts: number[];
  ends: number[];
}

export interface MappedDocumentRange extends DocumentRange {
  textMap: DocumentTextMap;
  formattedText?: string;
}

export function documentTextBetween(snapshot: EditorDocumentSnapshot, from: number, to: number): string {
  const document = schema.nodeFromJSON(snapshot.doc);
  if (from < 0 || to < from || to > document.content.size) return '';
  return document.textBetween(from, to, '\n');
}

/**
 * Build a provider-only view of a captured range. The canonical passage remains
 * plain text for exact offsets; this parallel reference makes emphasis visible to
 * an AI without inserting Markdown markers into the editor or its anchors.
 */
export function documentMarkdownBetween(snapshot: EditorDocumentSnapshot, from: number, to: number): string {
  const document = schema.nodeFromJSON(snapshot.doc);
  if (from < 0 || to < from || to > document.content.size) return '';
  const parts: Array<{ text: string; italic: boolean }> = [];
  let firstBlock = true;
  const append = (text: string, italic = false) => {
    if (!text) return;
    const previous = parts.at(-1);
    if (previous?.italic === italic) previous.text += text;
    else parts.push({ text, italic });
  };

  document.nodesBetween(from, to, (node, position) => {
    if (node.isBlock && (node.isTextblock || node.isLeaf)) {
      if (firstBlock) firstBlock = false;
      else append('\n');
    }
    if (node.isText) {
      const start = Math.max(from, position);
      const end = Math.min(to, position + node.nodeSize);
      if (start < end) {
        append((node.text ?? '').slice(start - position, end - position), node.marks.some((mark) => mark.type.name === 'em'));
      }
    } else if (node.isLeaf && position >= from && position < to) {
      append(node.type.spec.leafText?.(node) ?? '');
    }
    return true;
  });

  return parts.map((part) => part.italic ? `*${part.text}*` : part.text).join('');
}

export function completeDocumentRange(snapshot: EditorDocumentSnapshot): DocumentRange {
  const document = schema.nodeFromJSON(snapshot.doc);
  return { from: 0, to: document.content.size, text: document.textBetween(0, document.content.size, '\n') };
}

/**
 * Capture the provider-facing document text together with the exact editor
 * position occupied by every visible character. ProseMirror positions include
 * block boundaries and inline atoms, so plain string offsets cannot safely be
 * added to the start of a whole document.
 */
export function completeDocumentMappedRange(snapshot: EditorDocumentSnapshot): MappedDocumentRange {
  const document = schema.nodeFromJSON(snapshot.doc);
  const starts: number[] = [];
  const ends: number[] = [];
  let text = '';
  let firstBlock = true;

  document.nodesBetween(0, document.content.size, (node, position) => {
    if (node.isBlock && (node.isTextblock || node.isLeaf)) {
      if (firstBlock) firstBlock = false;
      else {
        text += '\n';
        starts.push(ends.at(-1) ?? position);
        ends.push(node.isTextblock ? position + 1 : position + node.nodeSize);
      }
    }

    if (node.isText) {
      const value = node.text ?? '';
      text += value;
      for (let offset = 0; offset < value.length; offset += 1) {
        starts.push(position + offset);
        ends.push(position + offset + 1);
      }
    } else if (node.isLeaf) {
      const value = node.type.spec.leafText?.(node) ?? '';
      text += value;
      for (let offset = 0; offset < value.length; offset += 1) {
        starts.push(position);
        ends.push(position + node.nodeSize);
      }
    }
  });

  return {
    from: 0,
    to: document.content.size,
    text,
    formattedText: documentMarkdownBetween(snapshot, 0, document.content.size),
    textMap: { starts, ends }
  };
}

export function mappedDocumentRangeMatches(snapshot: EditorDocumentSnapshot, captured: MappedDocumentRange): boolean {
  const current = completeDocumentMappedRange(snapshot);
  return current.from === captured.from
    && current.to === captured.to
    && current.text === captured.text
    && (captured.formattedText === undefined || current.formattedText === captured.formattedText)
    && current.textMap.starts.length === captured.textMap.starts.length
    && current.textMap.ends.length === captured.textMap.ends.length
    && current.textMap.starts.every((position, index) => position === captured.textMap.starts[index])
    && current.textMap.ends.every((position, index) => position === captured.textMap.ends[index]);
}

export function documentParagraphs(snapshot: EditorDocumentSnapshot): DocumentRange[] {
  const document = schema.nodeFromJSON(snapshot.doc);
  const paragraphs: DocumentRange[] = [];
  document.descendants((node, position) => {
    if (node.isTextblock && node.textContent.trim()) {
      paragraphs.push({ from: position + 1, to: position + node.nodeSize - 1, text: node.textContent });
    }
    return true;
  });
  return paragraphs;
}

function isStructuralMarkdown(text: string): boolean {
  const trimmed = text.trim();
  return /^#{1,6}\s+\S/.test(trimmed)
    || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed.replace(/\s/g, ''));
}

export function documentCraftParagraphs(snapshot: EditorDocumentSnapshot): DocumentRange[] {
  return documentParagraphs(snapshot).filter((range) => !isStructuralMarkdown(range.text));
}
