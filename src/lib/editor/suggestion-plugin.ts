import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { ySyncPluginKey, relativePositionToAbsolutePosition } from 'y-prosemirror';
import * as Y from 'yjs';
import type { Suggestion } from '$lib/domain';
import { planDocumentDeletion } from './deletion';

export const suggestionPluginKey = new PluginKey<SuggestionPluginState>('margin-note-suggestions');
export const suggestionPluginMeta = 'margin-note:update-suggestions';

export interface SuggestionPluginState {
  suggestions: Suggestion[];
  activeId: string | null;
  preview: { suggestionId: string; text: string } | null;
}

export interface SuggestionPluginOptions {
  onActivate: (id: string) => void;
  onHover?: (id: string | null) => void;
}

function resolvedRange(state: Parameters<typeof ySyncPluginKey.getState>[0], suggestion: Suggestion): { from: number; to: number } | null {
  let from = suggestion.anchor.from;
  let to = suggestion.anchor.to;
  const sync = ySyncPluginKey.getState(state);
  if (suggestion.anchor.start && suggestion.anchor.end && sync?.binding) {
    const start = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(suggestion.anchor.start), sync.binding.mapping);
    const end = relativePositionToAbsolutePosition(sync.doc, sync.type, Y.createRelativePositionFromJSON(suggestion.anchor.end), sync.binding.mapping);
    if (start != null && end != null) {
      from = start;
      to = end;
    }
  }
  const max = state.doc.content.size;
  if (from < 0 || from > max || to < from || to > max) return null;
  return { from, to };
}

function buildDecorations(state: Parameters<typeof ySyncPluginKey.getState>[0], pluginState: SuggestionPluginState): DecorationSet {
  const decorations: Decoration[] = [];
  for (const suggestion of pluginState.suggestions) {
    const range = resolvedRange(state, suggestion);
    if (!range) continue;
    const active = pluginState.activeId === suggestion.id;
    const preview = pluginState.preview?.suggestionId === suggestion.id ? pluginState.preview : null;
    const deletionPreview = preview?.text === '' ? planDocumentDeletion(state.doc, range.from, range.to) : null;
    const renderedRange = deletionPreview ? { from: deletionPreview.from, to: deletionPreview.to } : range;
    const attrs = {
      class: `mn-suggestion mn-cat-${suggestion.category} mn-type-${suggestion.type}${active ? ' is-active' : ''}${preview ? ' is-previewing' : ''}`,
      'data-suggestion-id': suggestion.id,
      'data-category': suggestion.category
    };
    if (renderedRange.from < renderedRange.to) decorations.push(Decoration.inline(renderedRange.from, renderedRange.to, attrs, { suggestionId: suggestion.id }));
    if (suggestion.type === 'annotation') {
      const $pos = state.doc.resolve(Math.min(range.from, state.doc.content.size));
      const paragraphStart = $pos.before(Math.max(1, $pos.depth));
      if (paragraphStart >= 0 && paragraphStart < state.doc.content.size) {
        decorations.push(Decoration.node(paragraphStart, paragraphStart + $pos.parent.nodeSize, { class: `mn-paragraph-note mn-paragraph-${suggestion.category}` }, { suggestionId: suggestion.id }));
      }
    }
    if (preview) {
      decorations.push(Decoration.widget(renderedRange.from, () => {
        const ghost = document.createElement('span');
        ghost.className = `mn-preview-text mn-cat-${suggestion.category}`;
        ghost.textContent = deletionPreview ? deletionPreview.insert : preview.text;
        return ghost;
      }, { side: -1, suggestionId: suggestion.id }));
    }
  }
  return DecorationSet.create(state.doc, decorations);
}

export function suggestionPlugin(options: SuggestionPluginOptions): Plugin<SuggestionPluginState> {
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  return new Plugin<SuggestionPluginState>({
    key: suggestionPluginKey,
    state: {
      init: () => ({ suggestions: [], activeId: null, preview: null }),
      apply(transaction, previous) {
        const update = transaction.getMeta(suggestionPluginMeta) as Partial<SuggestionPluginState> | undefined;
        if (update) return { ...previous, ...update };
        if (transaction.docChanged) return { ...previous };
        return previous;
      }
    },
    props: {
      decorations(state) {
        return buildDecorations(state, suggestionPluginKey.getState(state) ?? { suggestions: [], activeId: null, preview: null });
      },
      handleClick(view: EditorView, position: number, event: MouseEvent) {
        const target = event.target as HTMLElement;
        const explicit = target.closest<HTMLElement>('[data-suggestion-id]')?.dataset.suggestionId;
        const state = suggestionPluginKey.getState(view.state);
        const hit = explicit ?? state?.suggestions.find((suggestion) => {
          const range = resolvedRange(view.state, suggestion);
          return range && position >= range.from && position <= range.to;
        })?.id;
        if (!hit) return false;
        options.onActivate(hit);
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
        view.focus();
        return false;
      },
      handleDoubleClick(view: EditorView, position: number, event: MouseEvent) {
        const hit = (event.target as HTMLElement).closest<HTMLElement>('[data-suggestion-id]')?.dataset.suggestionId;
        if (!hit) return false;
        const $position = view.state.doc.resolve(position);
        const text = $position.parent.textContent;
        let from = Math.min($position.parentOffset, Math.max(0, text.length - 1));
        let to = from;
        const wordCharacter = (character: string | undefined) => Boolean(character && /[\p{L}\p{N}'’_-]/u.test(character));
        while (from > 0 && wordCharacter(text[from - 1])) from -= 1;
        while (to < text.length && wordCharacter(text[to])) to += 1;
        if (from === to) return false;
        options.onActivate(hit);
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, $position.start() + from, $position.start() + to)));
        view.focus();
        return true;
      },
      handleDOMEvents: {
        mouseover(_view, event) {
          const id = (event.target as HTMLElement).closest<HTMLElement>('[data-suggestion-id]')?.dataset.suggestionId;
          if (!id || !options.onHover) return false;
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => options.onHover?.(id), 150);
          return false;
        },
        mouseout(_view, event) {
          const leaving = (event.target as HTMLElement).closest<HTMLElement>('[data-suggestion-id]');
          if (!leaving || !options.onHover) return false;
          if (hoverTimer) clearTimeout(hoverTimer);
          hoverTimer = setTimeout(() => options.onHover?.(null), 150);
          return false;
        }
      }
    }
  });
}

export function pushSuggestionState(view: EditorView, update: Partial<SuggestionPluginState>): void {
  view.dispatch(view.state.tr.setMeta(suggestionPluginMeta, update).setMeta('addToHistory', false));
}

export function currentSuggestionRange(view: EditorView, suggestion: Suggestion): { from: number; to: number } | null {
  return resolvedRange(view.state, suggestion);
}
