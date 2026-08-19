import { schema } from 'prosemirror-schema-basic';
import type { EditorDocumentSnapshot } from './transactions';

export interface DocumentRange {
  from: number;
  to: number;
  text: string;
}

export function documentTextBetween(snapshot: EditorDocumentSnapshot, from: number, to: number): string {
  const document = schema.nodeFromJSON(snapshot.doc);
  if (from < 0 || to < from || to > document.content.size) return '';
  return document.textBetween(from, to, '\n');
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
