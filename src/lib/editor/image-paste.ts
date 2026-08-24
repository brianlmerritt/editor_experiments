import { Fragment, Slice, type Node as ProseMirrorNode } from 'prosemirror-model';

export function mapPastedImageNodes(
  slice: Slice,
  imageCount: number,
  createImage: (index: number) => ProseMirrorNode
): { slice: Slice; consumed: number } {
  let consumed = 0;
  const mapNode = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.type.name === 'image' && consumed < imageCount) return createImage(consumed++);
    if (!node.content.size) return node;
    const children: ProseMirrorNode[] = [];
    node.content.forEach((child) => children.push(mapNode(child)));
    return node.copy(Fragment.fromArray(children));
  };
  const children: ProseMirrorNode[] = [];
  slice.content.forEach((node) => children.push(mapNode(node)));
  return { slice: new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd), consumed };
}

export function pastedImageSources(slice: Slice): string[] {
  const sources: string[] = [];
  slice.content.descendants((node) => {
    if (node.type.name === 'image' && typeof node.attrs.src === 'string') sources.push(node.attrs.src);
  });
  return sources;
}

export function removeUnusablePastedImages(slice: Slice): { slice: Slice; removed: number } {
  let removed = 0;
  const mapNode = (node: ProseMirrorNode): ProseMirrorNode | null => {
    if (node.type.name === 'image') {
      const source = typeof node.attrs.src === 'string' ? node.attrs.src : '';
      if (!source || source.startsWith('file:') || source.startsWith('blob:')) {
        removed += 1;
        return null;
      }
    }
    if (!node.content.size) return node;
    const children: ProseMirrorNode[] = [];
    node.content.forEach((child) => {
      const mapped = mapNode(child);
      if (mapped) children.push(mapped);
    });
    return node.copy(Fragment.fromArray(children));
  };
  const children: ProseMirrorNode[] = [];
  slice.content.forEach((node) => {
    const mapped = mapNode(node);
    if (mapped) children.push(mapped);
  });
  return { slice: new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd), removed };
}

function htmlHasTextBeyondImages(html: string): boolean {
  const withoutNonContent = html
    .replace(/<(head|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|#160);/gi, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ');
  return withoutNonContent.trim().length > 0;
}

export function clipboardImageStrategy(
  plainText: string,
  html: string,
  imageSources: string[]
): 'clipboard_files' | 'embedded_data' | 'html_only' {
  if (!plainText.trim() && !htmlHasTextBeyondImages(html)) return 'clipboard_files';
  if (imageSources.length && imageSources.every((source) => source.startsWith('data:image/') && source.includes(';base64,'))) {
    return 'embedded_data';
  }
  return 'html_only';
}
