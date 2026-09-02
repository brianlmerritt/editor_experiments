import { describe, expect, it } from 'vitest';
import type { Suggestion } from '$lib/domain';
import { EditorState } from 'prosemirror-state';
import { editorSchema } from './schema';
import { currentSuggestionRange, suggestionRange, suggestionRanges } from './suggestion-plugin';

const suggestion = {
  target: { mode: 'snapshot', targets: [{ type: 'text', nodeId: 'main', start: 10, end: 17 }] },
  anchor: { from: 10, to: 17, text: 'noticed' }
} as Suggestion;

describe('suggestion range resolution', () => {
  it('projects the range owned by the Svelte input target', () => {
    expect(suggestionRange(suggestion)).toEqual({ from: 10, to: 17 });
  });

  it('projects every exact evidence anchor for a recurring-pattern input', () => {
    const repeated = {
      ...suggestion,
      target: {
        mode: 'snapshot',
        targets: [
          { type: 'text', nodeId: 'main', start: 30, end: 34 },
          { type: 'text', nodeId: 'main', start: 2, end: 6 },
          { type: 'text', nodeId: 'main', start: 16, end: 20 }
        ]
      }
    } as Suggestion;

    expect(suggestionRange(repeated)).toEqual({ from: 30, to: 34 });
    expect(suggestionRanges(repeated)).toEqual([
      { from: 30, to: 34 },
      { from: 2, to: 6 },
      { from: 16, to: 20 }
    ]);
  });

  it('refuses to resolve a coordinate whose expected source text is no longer there', () => {
    const state = EditorState.create({
      schema: editorSchema,
      doc: editorSchema.nodes.doc.create(null, editorSchema.nodes.paragraph.create(null, editorSchema.text('Mara waited.')))
    });
    const misplaced = {
      ...suggestion,
      target: { mode: 'snapshot', targets: [{ type: 'text', nodeId: 'main', start: 1, end: 7 }] },
      anchor: { from: 1, to: 7, text: 'porter' }
    } as Suggestion;

    expect(currentSuggestionRange({ state } as never, misplaced)).toBeNull();
  });
});
