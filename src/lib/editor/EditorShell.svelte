<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, TextSelection } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { schema } from 'prosemirror-schema-basic';
  import { keymap } from 'prosemirror-keymap';
  import { baseKeymap } from 'prosemirror-commands';
  import { ySyncPlugin, yUndoPlugin, undo, redo, yUndoPluginKey, ySyncPluginKey, absolutePositionToRelativePosition } from 'y-prosemirror';
  import { IndexeddbPersistence } from 'y-indexeddb';
  import * as Y from 'yjs';
  import type { Suggestion } from '$lib/domain';
  import { suggestionPlugin, pushSuggestionState, currentSuggestionRange } from './suggestion-plugin';
  import { planDocumentDeletion } from './deletion';

  export let branchId = 'main';
  export let initialContent = '';
  export let suggestions: Suggestion[] = [];
  export let activeSuggestionId: string | null = null;
  export let preview: { suggestionId: string; text: string } | null = null;
  export let paused = false;
  export let onTextChange: (detail: { text: string; characters: number; origin?: unknown }) => void = () => {};
  export let onSelectionChange: (detail: { from: number; to: number; text: string }) => void = () => {};
  export let onSuggestionActivate: (id: string) => void = () => {};
  export let onSuggestionHover: (id: string | null) => void = () => {};
  export let onUndoAcceptance: (origin: { suggestionId: string; source: string }) => void = () => {};

  let mount: HTMLDivElement;
  let view: EditorView | null = null;
  let ydoc: Y.Doc | null = null;
  let persistence: IndexeddbPersistence | null = null;
  let lastText = '';
  let previousSuggestions = suggestions;
  let previousActive = activeSuggestionId;
  let previousPreview = preview;
  let lastAcceptanceOrigin: { suggestionId: string; source: string } | null = null;
  let lastChangeWasAcceptance = false;

  function plainText(): string {
    return view?.state.doc.textBetween(0, view.state.doc.content.size, '\n\n') ?? '';
  }

  function notifySelection(): void {
    if (!view) return;
    const { from, to } = view.state.selection;
    onSelectionChange({ from, to, text: view.state.doc.textBetween(from, to, '\n') });
  }

  onMount(() => {
    let destroyed = false;
    void (async () => {
      ydoc = new Y.Doc();
      persistence = new IndexeddbPersistence(`margin-note:${branchId}`, ydoc);
      await persistence.whenSynced;
      if (destroyed || !ydoc) return;
      const fragment = ydoc.getXmlFragment('prosemirror');
      const initialDoc = schema.node('doc', null, initialContent.split(/\n\n/).map((paragraph) => schema.node('paragraph', null, paragraph ? schema.text(paragraph) : undefined)));
      const state = EditorState.create({
        schema,
        doc: initialDoc,
        plugins: [
          ySyncPlugin(fragment),
          yUndoPlugin(),
          suggestionPlugin({ onActivate: onSuggestionActivate, onHover: onSuggestionHover }),
          keymap({
            'Mod-z': () => {
              const origin = lastChangeWasAcceptance ? lastAcceptanceOrigin : null;
              const handled = view ? undo(view.state) : false;
              if (handled && origin) onUndoAcceptance(origin);
              if (handled) lastChangeWasAcceptance = false;
              return handled;
            },
            'Mod-Shift-z': () => view ? redo(view.state) : false,
            'Mod-y': () => view ? redo(view.state) : false
          }),
          keymap(baseKeymap)
        ]
      });
      view = new EditorView(mount, {
        state,
        editable: () => !paused,
        dispatchTransaction(transaction) {
          if (!view) return;
          const origin = transaction.getMeta('suggestionOrigin');
          if (transaction.docChanged) lastChangeWasAcceptance = Boolean(origin);
          const next = view.state.apply(transaction);
          view.updateState(next);
          if (transaction.docChanged) {
            const text = plainText();
            if (text !== lastText) {
              const characters = Math.abs(text.length - lastText.length);
              lastText = text;
              onTextChange({ text, characters, origin });
            }
          }
          if (transaction.docChanged || transaction.selectionSet) notifySelection();
        }
      });
      lastText = plainText();
      onTextChange({ text: lastText, characters: lastText.length });
      pushSuggestionState(view, { suggestions, activeId: activeSuggestionId, preview });
    })();
    return () => {
      destroyed = true;
      view?.destroy();
      persistence?.destroy();
      ydoc?.destroy();
    };
  });

  $: if (view && (suggestions !== previousSuggestions || activeSuggestionId !== previousActive || preview !== previousPreview)) {
    previousSuggestions = suggestions;
    previousActive = activeSuggestionId;
    previousPreview = preview;
    pushSuggestionState(view, { suggestions, activeId: activeSuggestionId, preview });
  }

  $: if (view) view.setProps({ editable: () => !paused });

  export function getText(): string { return plainText(); }
  export function getTextBetween(from: number, to: number): string {
    return view?.state.doc.textBetween(from, to, '\n') ?? '';
  }
  export function resolveSuggestionAnchor(suggestion: Suggestion): { from: number; to: number; text: string } | null {
    if (!view) return null;
    const range = currentSuggestionRange(view, suggestion);
    return range ? { ...range, text: view.state.doc.textBetween(range.from, range.to, '\n') } : null;
  }
  export function getParagraphs(): { from: number; to: number; text: string }[] {
    if (!view) return [];
    const paragraphs: { from: number; to: number; text: string }[] = [];
    view.state.doc.descendants((node, position) => {
      if (node.isTextblock && node.textContent.trim()) paragraphs.push({ from: position + 1, to: position + node.nodeSize - 1, text: node.textContent });
      return true;
    });
    return paragraphs;
  }
  export function getSelection(): { from: number; to: number; text: string } {
    if (!view) return { from: 1, to: 1, text: '' };
    const { from, to } = view.state.selection;
    return { from, to, text: view.state.doc.textBetween(from, to, '\n') };
  }
  export function getRelativeAnchor(from: number, to: number): { start?: Record<string, unknown>; end?: Record<string, unknown> } {
    if (!view) return {};
    const sync = ySyncPluginKey.getState(view.state);
    if (!sync?.binding) return {};
    return {
      start: Y.relativePositionToJSON(absolutePositionToRelativePosition(from, sync.type, sync.binding.mapping)),
      end: Y.relativePositionToJSON(absolutePositionToRelativePosition(to, sync.type, sync.binding.mapping))
    };
  }
  export function acceptSuggestion(suggestion: Suggestion, text: string): { ok: boolean; reason?: string; from?: number; to?: number } {
    if (!view) return { ok: false, reason: 'Editor is not ready' };
    const range = currentSuggestionRange(view, suggestion);
    if (!range) return { ok: false, reason: 'Anchor no longer resolves' };
    const current = view.state.doc.textBetween(range.from, range.to, '\n');
    if (current !== suggestion.anchor.text) return { ok: false, reason: 'Anchored text changed' };
    yUndoPluginKey.getState(view.state)?.undoManager?.stopCapturing();
    let transaction = view.state.tr;
    let acceptedFrom = range.from;
    let acceptedText = text;
    if (text) transaction = transaction.replaceWith(range.from, range.to, schema.text(text));
    else {
      const deletion = planDocumentDeletion(view.state.doc, range.from, range.to);
      acceptedFrom = deletion.from;
      acceptedText = deletion.insert;
      transaction = deletion.insert
        ? transaction.replaceWith(deletion.from, deletion.to, schema.text(deletion.insert))
        : transaction.delete(deletion.from, deletion.to);
    }
    const caret = Math.max(1, Math.min(acceptedFrom + acceptedText.length, transaction.doc.content.size));
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, caret));
    transaction.setMeta('suggestionOrigin', { suggestionId: suggestion.id, source: suggestion.source });
    transaction.setMeta('addToHistory', true);
    view.dispatch(transaction);
    lastAcceptanceOrigin = { suggestionId: suggestion.id, source: suggestion.source };
    lastChangeWasAcceptance = true;
    yUndoPluginKey.getState(view.state)?.undoManager?.stopCapturing();
    return { ok: true, from: acceptedFrom, to: acceptedFrom + acceptedText.length };
  }
  export function focusSuggestion(suggestion: Suggestion): void {
    if (!view) return;
    const range = currentSuggestionRange(view, suggestion);
    if (!range) return;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).scrollIntoView());
    view.focus();
  }
  export function getSuggestionTop(suggestion: Suggestion): number {
    if (!view || !mount) return 18;
    const range = currentSuggestionRange(view, suggestion);
    if (!range) return 18;
    const coordinates = view.coordsAtPos(range.from);
    return Math.max(18, coordinates.top - mount.getBoundingClientRect().top - 8);
  }
  export function focusAt(position: number): void {
    if (!view) return;
    const safe = Math.max(1, Math.min(position, view.state.doc.content.size));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, safe)).scrollIntoView());
    view.focus();
  }
  export function selectRange(from: number, to: number): void {
    if (!view) return;
    const max = view.state.doc.content.size;
    const safeFrom = Math.max(1, Math.min(from, max));
    const safeTo = Math.max(safeFrom, Math.min(to, max));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, safeFrom, safeTo)).scrollIntoView());
    view.focus();
  }
  export async function forkTo(targetBranchId: string): Promise<void> {
    if (!ydoc) throw new Error('Editor is not ready');
    const copy = new Y.Doc();
    const target = new IndexeddbPersistence(`margin-note:${targetBranchId}`, copy);
    await target.whenSynced;
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc), { kind: 'branch-fork', source: branchId });
    await new Promise((resolve) => setTimeout(resolve, 60));
    target.destroy();
    copy.destroy();
  }
</script>

<div class="editor-frame" class:is-paused={paused}>
  <div class="paper-rule" aria-hidden="true"></div>
  <div class="editor" role="presentation" bind:this={mount} on:mouseup={notifySelection} on:keyup={notifySelection}></div>
</div>

<style>
  .editor-frame { position: relative; min-height: 68vh; background: var(--paper); border: 1px solid var(--line); border-radius: 4px; box-shadow: 0 18px 60px rgb(38 31 22 / .08); overflow: hidden; }
  .paper-rule { position: absolute; inset: 0 auto 0 54px; width: 1px; background: color-mix(in srgb, var(--accent) 20%, transparent); pointer-events: none; }
  .editor { min-height: 68vh; }
  .is-paused .editor { opacity: .72; }
  :global(.ProseMirror) { box-sizing: border-box; min-height: 68vh; padding: 64px clamp(40px, 8vw, 104px) 120px; outline: none; color: var(--ink); font-family: var(--font-reading); font-size: clamp(18px, 1.5vw, 21px); line-height: 1.82; caret-color: var(--accent); }
  :global(.ProseMirror p) { position: relative; margin: 0 0 1.2em; }
  :global(.mn-suggestion) { cursor: text; border-radius: 2px; text-decoration-line: underline; text-decoration-thickness: 1.5px; text-underline-offset: 4px; background: color-mix(in srgb, var(--category-color) 9%, transparent); }
  :global(.mn-type-annotation) { text-decoration-style: dotted; }
  :global(.mn-type-replacement) { text-decoration-style: solid; }
  :global(.mn-cat-pov), :global(.mn-cat-tense), :global(.mn-cat-canon) { text-decoration-style: wavy; }
  :global(.mn-cat-pov) { --category-color: var(--cat-pov); }
  :global(.mn-cat-tense) { --category-color: var(--cat-tense); }
  :global(.mn-cat-canon) { --category-color: var(--cat-canon); }
  :global(.mn-cat-cadence) { --category-color: var(--cat-cadence); }
  :global(.mn-cat-diction) { --category-color: var(--cat-diction); }
  :global(.mn-cat-distance) { --category-color: var(--cat-distance); }
  :global(.mn-suggestion.is-active) { background: color-mix(in srgb, var(--category-color) 19%, transparent); text-decoration-thickness: 2px; }
  :global(.mn-suggestion.is-previewing) { color: transparent; text-decoration: none; background: color-mix(in srgb, var(--category-color) 5%, transparent); }
  :global(.mn-preview-text) { color: var(--ink); background: color-mix(in srgb, var(--category-color) 13%, var(--paper)); border-bottom: 2px solid var(--category-color); white-space: pre; }
  :global(.mn-paragraph-note) { border-left: 2px solid color-mix(in srgb, var(--category-color, var(--accent)) 55%, transparent); padding-left: 14px; margin-left: -16px !important; }
</style>
