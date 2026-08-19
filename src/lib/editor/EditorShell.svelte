<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import { schema } from 'prosemirror-schema-basic';
  import { keymap } from 'prosemirror-keymap';
  import { baseKeymap } from 'prosemirror-commands';
  import type { Suggestion } from '$lib/domain';
  import type { FormatAttachment, TextChange } from '$lib/workspace/attachments';
  import type { EditorDocumentSnapshot, EditorTransactionDetail, EditorTransactionOrigin } from '$lib/workspace/transactions';
  import { suggestionPlugin, suggestionPluginMeta, pushSuggestionState, currentSuggestionRange } from './suggestion-plugin';
  import { planDocumentDeletion } from './deletion';

  interface Props {
    branchId?: string;
    initialContent?: string;
    suggestions?: Suggestion[];
    formats?: FormatAttachment[];
    attachmentRevision?: number;
    activeSuggestionId?: string | null;
    preview?: { suggestionId: string; text: string } | null;
    paused?: boolean;
    onTextChange?: (detail: { text: string; characters: number; origin?: EditorTransactionOrigin }) => void;
    onEditorReady?: (snapshot: EditorDocumentSnapshot) => void;
    onEditorTransaction?: (detail: EditorTransactionDetail) => { suggestions: Suggestion[]; formats: FormatAttachment[] } | void;
    onUndoRequest?: () => void;
    onRedoRequest?: () => void;
    onSelectionChange?: (detail: { from: number; to: number; text: string }) => void;
    onSuggestionActivate?: (id: string) => void;
    onSuggestionHover?: (id: string | null) => void;
  }

  let {
    branchId = 'main', initialContent = '', suggestions = [], formats = [], attachmentRevision = 0,
    activeSuggestionId = null, preview = null, paused = false,
    onTextChange = () => {}, onEditorReady = () => {}, onEditorTransaction = () => {},
    onUndoRequest = () => {}, onRedoRequest = () => {}, onSelectionChange = () => {},
    onSuggestionActivate = () => {}, onSuggestionHover = () => {}
  }: Props = $props();

  let mount = $state<HTMLDivElement | null>(null);
  let view = $state<EditorView | null>(null);

  function notifySelection(): void {
    if (!view) return;
    const { from, to } = view.state.selection;
    onSelectionChange({ from, to, text: view.state.doc.textBetween(from, to, '\n') });
  }

  function snapshot(state: EditorState): EditorDocumentSnapshot {
    return {
      doc: state.doc.toJSON() as Record<string, unknown>,
      text: state.doc.textBetween(0, state.doc.content.size, '\n\n'),
      selection: { from: state.selection.from, to: state.selection.to }
    };
  }

  function transactionOrigin(transaction: Transaction): EditorTransactionOrigin {
    const explicit = transaction.getMeta('workspaceOrigin') as EditorTransactionOrigin | undefined;
    if (explicit) return explicit;
    const acceptance = transaction.getMeta('suggestionOrigin') as { suggestionId?: string; source?: string } | undefined;
    if (acceptance?.suggestionId) return { kind: 'input_acceptance', inputId: acceptance.suggestionId, source: acceptance.source };
    return { kind: 'human' };
  }

  function transactionChanges(transaction: Transaction): TextChange[] {
    const changes: TextChange[] = [];
    transaction.steps.forEach((step, index) => {
      const before = transaction.docs[index] ?? view?.state.doc;
      step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
        changes.push({
          nodeId: branchId,
          from: oldStart,
          to: oldEnd,
          insertedLength: newEnd - newStart,
          deletedText: before?.textBetween(oldStart, oldEnd, '\n') ?? ''
        });
      });
    });
    return changes;
  }

  onMount(() => {
    const initialDoc = schema.node('doc', null, initialContent.split(/\n\n/).map((paragraph) => schema.node('paragraph', null, paragraph ? schema.text(paragraph) : undefined)));
    const state = EditorState.create({
      schema,
      doc: initialDoc,
      plugins: [
        suggestionPlugin({ onActivate: onSuggestionActivate, onHover: onSuggestionHover }),
        keymap({
          'Mod-z': () => {
            onUndoRequest();
            return true;
          },
          'Mod-Shift-z': () => { onRedoRequest(); return true; },
          'Mod-y': () => { onRedoRequest(); return true; }
        }),
        keymap(baseKeymap)
      ]
    });
    view = new EditorView(mount, {
      state,
      editable: () => !paused,
      dispatchTransaction(transaction) {
        if (!view) return;
        const before = snapshot(view.state);
        const origin = transactionOrigin(transaction);
        const changes = transaction.docChanged ? transactionChanges(transaction) : [];
        const provisional = view.state.apply(transaction);
        if (transaction.docChanged) {
          const after = snapshot(provisional);
          if (after.text !== before.text) {
            const projection = onEditorTransaction({ before, after, changes, origin });
            if (projection) transaction.setMeta(suggestionPluginMeta, {
              suggestions: projection.suggestions,
              formats: projection.formats,
              documentId: branchId,
              activeId: activeSuggestionId,
              preview
            });
          }
        }
        const next = view.state.apply(transaction);
        view.updateState(next);
        if (transaction.docChanged) {
          const after = snapshot(next);
          if (after.text !== before.text) {
            onTextChange({ text: after.text, characters: Math.abs(after.text.length - before.text.length), origin });
          }
        }
        if (transaction.docChanged || transaction.selectionSet) notifySelection();
      }
    });
    const initialSnapshot = snapshot(view.state);
    onEditorReady(initialSnapshot);
    onTextChange({ text: initialSnapshot.text, characters: initialSnapshot.text.length });
    pushSuggestionState(view, { suggestions, formats, documentId: branchId, activeId: activeSuggestionId, preview });
    return () => {
      view?.destroy();
    };
  });

  $effect(() => {
    if (!view) return;
    void attachmentRevision;
    pushSuggestionState(view, { suggestions, formats, documentId: branchId, activeId: activeSuggestionId, preview });
  });

  $effect(() => {
    if (view) view.setProps({ editable: () => !paused });
  });

  export function syncAttachments(nextSuggestions: Suggestion[], nextFormats: FormatAttachment[]): void {
    if (!view) return;
    pushSuggestionState(view, {
      suggestions: nextSuggestions,
      formats: nextFormats,
      documentId: branchId,
      activeId: activeSuggestionId,
      preview
    });
  }
  export function acceptSuggestion(suggestion: Suggestion, text: string): { ok: boolean; reason?: string; from?: number; to?: number } {
    if (!view) return { ok: false, reason: 'Editor is not ready' };
    const range = currentSuggestionRange(view, suggestion);
    if (!range) return { ok: false, reason: 'Anchor no longer resolves' };
    const current = view.state.doc.textBetween(range.from, range.to, '\n');
    if (current !== suggestion.anchor.text) return { ok: false, reason: 'Anchored text changed' };
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
    transaction.setMeta('workspaceOrigin', { kind: 'input_acceptance', inputId: suggestion.id, source: suggestion.source } satisfies EditorTransactionOrigin);
    transaction.setMeta('addToHistory', true);
    view.dispatch(transaction);
    return { ok: true, from: acceptedFrom, to: acceptedFrom + acceptedText.length };
  }
  export function restoreSnapshot(value: EditorDocumentSnapshot, action: 'undo' | 'redo'): void {
    if (!view) return;
    const restored = schema.nodeFromJSON(value.doc);
    let transaction = view.state.tr.replaceWith(0, view.state.doc.content.size, restored.content);
    const max = transaction.doc.content.size;
    const from = Math.max(1, Math.min(value.selection.from, max));
    const to = Math.max(from, Math.min(value.selection.to, max));
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, from, to));
    transaction.setMeta('workspaceOrigin', { kind: 'workspace_history', source: action } satisfies EditorTransactionOrigin);
    transaction.setMeta('addToHistory', false);
    view.dispatch(transaction);
    view.focus();
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
</script>

<div class="editor-frame" class:is-paused={paused}>
  <div class="paper-rule" aria-hidden="true"></div>
  <div class="editor" role="presentation" bind:this={mount} onmouseup={notifySelection} onkeyup={notifySelection}></div>
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
  :global(.mn-format-strikethrough) { text-decoration-line: line-through; text-decoration-thickness: 1.5px; text-decoration-color: color-mix(in srgb, var(--reject) 72%, currentColor); }
</style>
