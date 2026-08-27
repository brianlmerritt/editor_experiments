import { Fragment, Slice, type Schema } from 'prosemirror-model';

export function multilineReplacementSlice(text: string, schema: Schema): Slice | null {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.includes('\n')) return null;
  const paragraphs = normalized
    .split(/\n(?:[\t ]*\n)*/)
    .map((paragraph) => schema.nodes.paragraph.create(null, paragraph ? schema.text(paragraph) : undefined));
  return new Slice(Fragment.fromArray(paragraphs), 0, 0);
}
