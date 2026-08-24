// @vitest-environment jsdom
import { DOMParser as ProseMirrorDomParser } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { editorSchema } from './schema';
import { clipboardImageStrategy, mapPastedImageNodes, pastedImageSources, removeUnusablePastedImages } from './image-paste';

describe('mixed clipboard image mapping', () => {
  it('replaces an embedded image without dropping surrounding prose or a table', () => {
    document.body.innerHTML = '<p>Before <img src="word-image.png"> after</p><table><tr><td>Cell</td></tr></table>';
    const source = ProseMirrorDomParser.fromSchema(editorSchema).parseSlice(document.body);
    const mapped = mapPastedImageNodes(source, 1, () => editorSchema.nodes.image.create({
      pasteId: 'paste-1', src: 'blob:pending', alt: 'Pasted image', state: 'pending'
    }));
    const json = mapped.slice.content.toJSON() as Array<{ type: string; content?: unknown[] }>;

    expect(mapped.consumed).toBe(1);
    expect(JSON.stringify(json)).toContain('Before ');
    expect(JSON.stringify(json)).toContain('paste-1');
    expect(JSON.stringify(json)).toContain('after');
    expect(json.some((node) => node.type === 'table')).toBe(true);
  });

  it('does not confuse a macOS Word selection preview with an embedded image', () => {
    document.body.innerHTML = '<p>Several paragraphs from Word</p><img src="file:///word/media/image1.png">';
    const source = ProseMirrorDomParser.fromSchema(editorSchema).parseSlice(document.body);
    const sources = pastedImageSources(source);

    expect(sources).toEqual(['file:///word/media/image1.png']);
    const html = '<p>Several paragraphs from Word</p><img src="file:///word/media/image1.png">';
    expect(clipboardImageStrategy('Several paragraphs from Word', html, sources)).toBe('html_only');
    expect(clipboardImageStrategy('', html, sources)).toBe('html_only');
    expect(clipboardImageStrategy('', '<img src="preview.png">', sources)).toBe('clipboard_files');
    expect(clipboardImageStrategy('Text', '<p>Text</p>', ['data:image/png;base64,AAAA'])).toBe('embedded_data');

    const cleaned = removeUnusablePastedImages(source);
    expect(cleaned.removed).toBe(1);
    expect(JSON.stringify(cleaned.slice.content.toJSON())).toContain('Several paragraphs from Word');
    expect(JSON.stringify(cleaned.slice.content.toJSON())).not.toContain('file:///word/media/image1.png');
  });
});
