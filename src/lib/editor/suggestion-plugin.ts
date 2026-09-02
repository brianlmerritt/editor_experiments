import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Suggestion } from '$lib/domain';
import type { FormatAttachment } from '$lib/workspace/attachments';
import { planDocumentDeletion } from './deletion';

export const suggestionPluginKey = new PluginKey<SuggestionPluginState>('margin-note-suggestions');
export const suggestionPluginMeta = 'margin-note:update-suggestions';

export interface SuggestionPluginState {
  suggestions: Suggestion[];
  formats: FormatAttachment[];
  documentId: string;
  activeId: string | null;
  preview: { suggestionId: string; text: string } | null;
}

export interface SuggestionPluginOptions {
  onActivate: (id: string) => void;
  onHover?: (id: string | null) => void;
}

export function suggestionRange(suggestion: Suggestion): { from: number; to: number } {
  const domainTarget = suggestion.target.targets.find((target) => target.type === 'text');
  return {
    from: domainTarget?.type === 'text' ? domainTarget.start : suggestion.anchor.from,
    to: domainTarget?.type === 'text' ? domainTarget.end : suggestion.anchor.to
  };
}

export function suggestionRanges(suggestion: Suggestion): Array<{ from: number; to: number }> {
  const ranges = suggestion.target.targets
    .filter((target) => target.type === 'text')
    .map((target) => ({ from: target.start, to: target.end }));
  return ranges.length ? ranges : [suggestionRange(suggestion)];
}

function resolvedRange(state: EditorState, suggestion: Suggestion): { from: number; to: number } | null {
  const primary = suggestionRange(suggestion);
  return resolvedRanges(state, suggestion)
    .find((range) => range.from === primary.from && range.to === primary.to) ?? null;
}

function resolvedRanges(state: EditorState, suggestion: Suggestion): Array<{ from: number; to: number }> {
  const max = state.doc.content.size;
  const expected = suggestion.evidenceAnchors ?? [suggestion.anchor];
  return suggestionRanges(suggestion).filter(({ from, to }, index) => from >= 0 && from <= max && to > from && to <= max
    && (!expected[index]?.text || state.doc.textBetween(from, to, '\n') === expected[index].text));
}

interface FormatRange { from: number; to: number }

function mergeRanges(ranges: FormatRange[]): FormatRange[] {
  const sorted = ranges.filter((range) => range.from < range.to).sort((left, right) => left.from - right.from || left.to - right.to);
  const merged: FormatRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function subtractRange(ranges: FormatRange[], removed: FormatRange): FormatRange[] {
  return ranges.flatMap((range) => {
    if (removed.to <= range.from || removed.from >= range.to) return [range];
    const pieces: FormatRange[] = [];
    if (range.from < removed.from) pieces.push({ from: range.from, to: removed.from });
    if (range.to > removed.to) pieces.push({ from: removed.to, to: range.to });
    return pieces;
  });
}

function targetRanges(state: EditorState, format: FormatAttachment, documentId: string): FormatRange[] {
  const ranges: FormatRange[] = [];
  for (const target of format.target.targets) {
    if (target.type === 'text' && target.nodeId === documentId) {
      const from = Math.max(0, Math.min(target.start, state.doc.content.size));
      const to = Math.max(from, Math.min(target.end, state.doc.content.size));
      if (from < to) ranges.push({ from, to });
    }
    if (target.type === 'node' && target.nodeId === documentId) {
      state.doc.descendants((node, position) => {
        if (node.isTextblock && node.content.size) ranges.push({ from: position + 1, to: position + node.nodeSize - 1 });
        return true;
      });
    }
  }
  return ranges;
}

function effectiveStrikethroughRanges(state: EditorState, formats: FormatAttachment[], documentId: string): FormatRange[] {
  let effective: FormatRange[] = [];
  const ordered = formats
    .map((format, index) => ({ format, index }))
    .filter(({ format }) => format.properties.strikethrough !== undefined)
    .sort((left, right) => left.format.priority - right.format.priority
      || left.format.createdAtRevision - right.format.createdAtRevision
      || left.index - right.index);
  for (const { format } of ordered) {
    const ranges = targetRanges(state, format, documentId);
    if (format.properties.strikethrough) effective = mergeRanges([...effective, ...ranges]);
    else for (const range of ranges) effective = subtractRange(effective, range);
  }
  return effective;
}

function buildDecorations(state: EditorState, pluginState: SuggestionPluginState): DecorationSet {
  const decorations: Decoration[] = [];
  for (const range of effectiveStrikethroughRanges(state, pluginState.formats, pluginState.documentId)) {
    decorations.push(Decoration.inline(range.from, range.to, { class: 'mn-format-strikethrough' }, { formatId: 'effective-strikethrough' }));
  }
  for (const suggestion of pluginState.suggestions) {
    const range = resolvedRange(state, suggestion);
    if (!range) continue;
    const ranges = resolvedRanges(state, suggestion);
    const active = pluginState.activeId === suggestion.id;
    const preview = pluginState.preview?.suggestionId === suggestion.id ? pluginState.preview : null;
    const deletionPreview = preview?.text === '' ? planDocumentDeletion(state.doc, range.from, range.to) : null;
    const renderedRange = deletionPreview ? { from: deletionPreview.from, to: deletionPreview.to } : range;
    const attrs = {
      class: `mn-suggestion mn-cat-${suggestion.category} mn-type-${suggestion.type}${active ? ' is-active' : ''}${preview ? ' is-previewing' : ''}`,
      'data-suggestion-id': suggestion.id,
      'data-category': suggestion.category
    };
    for (const evidenceRange of ranges) {
      const renderedEvidence = evidenceRange.from === range.from && evidenceRange.to === range.to ? renderedRange : evidenceRange;
      if (renderedEvidence.from < renderedEvidence.to) decorations.push(Decoration.inline(renderedEvidence.from, renderedEvidence.to, attrs, { suggestionId: suggestion.id }));
    }
    if (suggestion.type === 'annotation') {
      const decoratedParagraphs = new Set<number>();
      for (const evidenceRange of ranges) {
        const $pos = state.doc.resolve(Math.min(evidenceRange.from, state.doc.content.size));
        const paragraphStart = $pos.before(Math.max(1, $pos.depth));
        if (paragraphStart >= 0 && paragraphStart < state.doc.content.size && !decoratedParagraphs.has(paragraphStart)) {
          decoratedParagraphs.add(paragraphStart);
          decorations.push(Decoration.node(paragraphStart, paragraphStart + $pos.parent.nodeSize, { class: `mn-paragraph-note mn-paragraph-${suggestion.category}` }, { suggestionId: suggestion.id }));
        }
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
      init: () => ({ suggestions: [], formats: [], documentId: '', activeId: null, preview: null }),
      apply(transaction, previous) {
        const update = transaction.getMeta(suggestionPluginMeta) as Partial<SuggestionPluginState> | undefined;
        if (update) return { ...previous, ...update };
        if (transaction.docChanged) return { ...previous };
        return previous;
      }
    },
    props: {
      decorations(state) {
        return buildDecorations(state, suggestionPluginKey.getState(state) ?? { suggestions: [], formats: [], documentId: '', activeId: null, preview: null });
      },
      handleClick(view: EditorView, position: number, event: MouseEvent) {
        const target = event.target as HTMLElement;
        const explicit = target.closest<HTMLElement>('[data-suggestion-id]')?.dataset.suggestionId;
        const state = suggestionPluginKey.getState(view.state);
        const hit = explicit ?? state?.suggestions.find((suggestion) => {
          const ranges = resolvedRanges(view.state, suggestion);
          return ranges.some((range) => position >= range.from && position <= range.to);
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
