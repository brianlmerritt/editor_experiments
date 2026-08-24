import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from 'prosemirror-model';
import type { Command } from 'prosemirror-state';

type ListKind = 'bullet_list' | 'ordered_list';

interface ListMarker {
  kind: ListKind;
  length: number;
  order?: number;
}

interface NormalizeOptions {
  minimumRun?: number;
}

const bulletMarker = /^[\s\u00a0]*[•◦▪●○‣⁃·\uF0A7\uF0B7\uF0D8](?:[\s\u00a0]+)/u;
const orderedMarker = /^[\s\u00a0]*(?:(\d{1,4})[.)]|\((\d{1,4})\))(?:[\s\u00a0]+)/u;

function markerAtStart(text: string): ListMarker | null {
  const bullet = text.match(bulletMarker);
  if (bullet) return { kind: 'bullet_list', length: bullet[0].length };
  const ordered = text.match(orderedMarker);
  if (!ordered) return null;
  return {
    kind: 'ordered_list',
    length: ordered[0].length,
    order: Number(ordered[1] ?? ordered[2])
  };
}

function stripInlinePrefix(node: ProseMirrorNode, length: number): ProseMirrorNode {
  let remaining = length;
  const content: ProseMirrorNode[] = [];
  node.content.forEach((child) => {
    if (!remaining || !child.isText) {
      content.push(child);
      return;
    }
    const size = child.text?.length ?? 0;
    if (size <= remaining) {
      remaining -= size;
      return;
    }
    content.push(child.cut(remaining));
    remaining = 0;
  });
  return node.copy(Fragment.fromArray(content));
}

function normalizeListItem(item: ProseMirrorNode, marker: ListMarker | null): ProseMirrorNode {
  if (!marker || !item.firstChild?.isTextblock) return item;
  const first = stripInlinePrefix(item.firstChild, marker.length);
  const children: ProseMirrorNode[] = [first];
  for (let index = 1; index < item.childCount; index += 1) children.push(item.child(index));
  return item.copy(Fragment.fromArray(children));
}

function matchingRun(children: ProseMirrorNode[], start: number): { kind: ListKind; end: number; markers: ListMarker[] } | null {
  const first = children[start];
  if (first.type.name !== 'paragraph') return null;
  const initial = markerAtStart(first.textContent);
  if (!initial) return null;
  const markers = [initial];
  let end = start + 1;
  while (end < children.length && children[end].type.name === 'paragraph') {
    const marker = markerAtStart(children[end].textContent);
    if (!marker || marker.kind !== initial.kind) break;
    if (initial.kind === 'ordered_list' && marker.order !== (initial.order ?? 1) + markers.length) break;
    markers.push(marker);
    end += 1;
  }
  return { kind: initial.kind, end, markers };
}

function normalizeContainer(node: ProseMirrorNode, schema: Schema, minimumRun: number): ProseMirrorNode {
  if (node.isText || node.isLeaf) return node;

  if (node.type.name === 'bullet_list' || node.type.name === 'ordered_list') {
    const kind = node.type.name as ListKind;
    const start = kind === 'ordered_list' ? Number(node.attrs.order) || 1 : 1;
    const items: ProseMirrorNode[] = [];
    node.content.forEach((item, _offset, index) => {
      const first = item.firstChild;
      const marker = first ? markerAtStart(first.textContent) : null;
      const duplicate = marker?.kind === kind
        && (kind === 'bullet_list' || marker.order === start + index)
        ? marker
        : null;
      const cleaned = normalizeListItem(item, duplicate);
      const nested: ProseMirrorNode[] = [];
      cleaned.content.forEach((child) => nested.push(normalizeContainer(child, schema, minimumRun)));
      items.push(cleaned.copy(Fragment.fromArray(nested)));
    });
    return node.copy(Fragment.fromArray(items));
  }

  const children: ProseMirrorNode[] = [];
  node.content.forEach((child) => children.push(normalizeContainer(child, schema, minimumRun)));
  if (node.type.name === 'list_item') return node.copy(Fragment.fromArray(children));

  const normalized: ProseMirrorNode[] = [];
  for (let index = 0; index < children.length;) {
    const run = matchingRun(children, index);
    if (!run || run.markers.length < minimumRun) {
      normalized.push(children[index]);
      index += 1;
      continue;
    }
    const items = run.markers.map((marker, markerIndex) => {
      const paragraph = stripInlinePrefix(children[index + markerIndex], marker.length);
      return schema.nodes.list_item.create(null, paragraph);
    });
    const attrs = run.kind === 'ordered_list' ? { order: run.markers[0].order ?? 1 } : null;
    normalized.push(schema.nodes[run.kind].create(attrs, items));
    index = run.end;
  }
  return node.copy(Fragment.fromArray(normalized));
}

export function normalizeListSlice(slice: Slice, schema: Schema, options: NormalizeOptions = {}): Slice {
  const wrapper = schema.nodes.doc.create(null, slice.content);
  const normalized = normalizeContainer(wrapper, schema, options.minimumRun ?? 2);
  return new Slice(normalized.content, slice.openStart, slice.openEnd);
}

export const normalizeSelectedList: Command = (state, dispatch) => {
  if (state.selection.empty) return false;
  const before = state.selection.content();
  const after = normalizeListSlice(before, state.schema, { minimumRun: 1 });
  if (before.content.eq(after.content) && before.openStart === after.openStart && before.openEnd === after.openEnd) return false;
  if (dispatch) dispatch(state.tr.replaceSelection(after).scrollIntoView());
  return true;
};
