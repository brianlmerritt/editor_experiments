<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, TextSelection, type Command, type Transaction } from 'prosemirror-state';
  import { EditorView } from 'prosemirror-view';
  import type { Node as ProseMirrorNode, Slice } from 'prosemirror-model';
  import { keymap } from 'prosemirror-keymap';
  import { baseKeymap } from 'prosemirror-commands';
  import type { Suggestion } from '$lib/domain';
  import type { FormatAttachment, TextChange } from '$lib/workspace/attachments';
  import type { EditorDocumentSnapshot, EditorTransactionDetail, EditorTransactionOrigin } from '$lib/workspace/transactions';
  import { suggestionPlugin, suggestionPluginMeta, pushSuggestionState, currentSuggestionRange } from './suggestion-plugin';
  import { planDocumentDeletion } from './deletion';
  import { editorSchema as schema } from './schema';
  import { clipboardImageStrategy, mapPastedImageNodes, pastedImageSources, removeUnusablePastedImages } from './image-paste';
  import { normalizeListSlice, normalizeSelectedList } from './list-normalization';
  import { richDocumentFromProseMirror, richDocumentFromText, richDocumentToProseMirror, type RichDocument } from '$lib/workspace/rich-document';
  import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
  import {
    clearFormatting,
    formattingState as readFormattingState,
    setLink,
    setTextBlockStyle,
    toggleBlockquote,
    toggleInlineMark,
    toggleList,
    type FormattingState,
    type TextBlockStyle
  } from './formatting';

  interface UploadedImageAsset {
    id: string;
    url: string;
    fileName: string;
    mimeType: string;
  }

  interface Props {
    branchId?: string;
    initialContent?: string;
    initialDocument?: RichDocument;
    zoomPercent?: number;
    suggestions?: Suggestion[];
    formats?: FormatAttachment[];
    attachmentRevision?: number;
    activeSuggestionId?: string | null;
    preview?: { suggestionId: string; text: string } | null;
    onTextChange?: (detail: { text: string; characters: number; origin?: EditorTransactionOrigin }) => void;
    onEditorReady?: (snapshot: EditorDocumentSnapshot) => void;
    onAssetUpload?: (file: File) => Promise<UploadedImageAsset>;
    onEditorTransaction?: (detail: EditorTransactionDetail) => { suggestions: Suggestion[]; formats: FormatAttachment[] } | void;
    onUndoRequest?: () => void;
    onRedoRequest?: () => void;
    onSelectionChange?: (detail: { from: number; to: number; text: string }) => void;
    onSuggestionActivate?: (id: string) => void;
    onSuggestionHover?: (id: string | null) => void;
  }

  let {
    branchId = 'main', initialContent = '', initialDocument, zoomPercent = 100, suggestions = [], formats = [], attachmentRevision = 0,
    activeSuggestionId = null, preview = null,
    onTextChange = () => {}, onEditorReady = () => {}, onAssetUpload = async () => { throw new Error('Asset upload is not configured'); }, onEditorTransaction = () => {},
    onUndoRequest = () => {}, onRedoRequest = () => {}, onSelectionChange = () => {},
    onSuggestionActivate = () => {}, onSuggestionHover = () => {}
  }: Props = $props();

  let mount = $state<HTMLDivElement | null>(null);
  let view = $state<EditorView | null>(null);
  let currentFormatting = $state<FormattingState>({
    blockStyle: 'paragraph', bold: false, italic: false, underline: false,
    strikethrough: false, bulletList: false, orderedList: false,
    blockquote: false, link: false, linkHref: '', hasSelection: false
  });
  let linkEditorOpen = $state(false);
  let linkHref = $state('');

  function refreshFormattingState(): void {
    if (view) currentFormatting = readFormattingState(view.state);
  }

  function notifySelection(): void {
    if (!view) return;
    const { from, to } = view.state.selection;
    onSelectionChange({ from, to, text: view.state.doc.textBetween(from, to, '\n') });
    refreshFormattingState();
  }

  function runFormatting(command: Command): boolean {
    if (!view) return false;
    const handled = command(view.state, (transaction) => {
      transaction.setMeta('workspaceOrigin', { kind: 'human', source: 'formatting' } satisfies EditorTransactionOrigin);
      view?.dispatch(transaction);
    }, view);
    if (handled) view.focus();
    refreshFormattingState();
    return handled;
  }

  function chooseTextBlock(event: Event): void {
    runFormatting(setTextBlockStyle((event.currentTarget as HTMLSelectElement).value as TextBlockStyle));
  }

  function openLinkEditor(): void {
    if (!currentFormatting.hasSelection) return;
    linkHref = currentFormatting.linkHref;
    linkEditorOpen = true;
  }

  function applyLink(event: SubmitEvent): void {
    event.preventDefault();
    if (runFormatting(setLink(linkHref))) linkEditorOpen = false;
  }

  function removeLink(): void {
    if (runFormatting(setLink(''))) linkEditorOpen = false;
  }

  function snapshot(state: EditorState): EditorDocumentSnapshot {
    return {
      doc: state.doc.toJSON() as Record<string, unknown>,
      richDocument: richDocumentFromProseMirror(state.doc.toJSON() as Record<string, unknown>),
      text: state.doc.textBetween(0, state.doc.content.size, '\n\n'),
      selection: { from: state.selection.from, to: state.selection.to }
    };
  }

  async function finishImagePaste(pasteId: string, file: File, objectUrl: string): Promise<void> {
    try {
      const asset = await onAssetUpload(file);
      if (!view) return;
      let position: number | null = null;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.pasteId === pasteId) {
          position = pos;
          return false;
        }
        return position === null;
      });
      if (position === null) return;
      const current = view.state.doc.nodeAt(position);
      if (!current) return;
      const transaction = view.state.tr.setNodeMarkup(position, undefined, {
        ...current.attrs,
        pasteId: null,
        assetId: asset.id,
        src: asset.url,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        state: 'ready'
      });
      transaction.setMeta('workspaceOrigin', { kind: 'system', source: 'asset_upload' } satisfies EditorTransactionOrigin);
      transaction.setMeta('addToHistory', false);
      view.dispatch(transaction);
      URL.revokeObjectURL(objectUrl);
    } catch {
      if (!view) return;
      let position: number | null = null;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && node.attrs.pasteId === pasteId) {
          position = pos;
          return false;
        }
        return position === null;
      });
      if (position === null) return;
      const current = view.state.doc.nodeAt(position);
      if (!current) return;
      const transaction = view.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, state: 'failed' });
      transaction.setMeta('workspaceOrigin', { kind: 'system', source: 'asset_upload' } satisfies EditorTransactionOrigin);
      transaction.setMeta('addToHistory', false);
      view.dispatch(transaction);
    }
  }

  function embeddedImageFile(source: string, index: number): File | null {
    const match = source.match(/^data:(image\/[^;,]+);base64,(.+)$/s);
    if (!match) return null;
    try {
      const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
      const extension = match[1].split('/')[1]?.replace(/[^a-z0-9]+/gi, '') || 'image';
      return new File([bytes], `embedded-${index + 1}.${extension}`, { type: match[1] });
    } catch {
      return null;
    }
  }

  function pasteImages(event: ClipboardEvent, pastedSlice: Slice): boolean {
    if (!view || !event.clipboardData) return false;
    const clipboardFiles = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));
    const imageSources = pastedImageSources(pastedSlice);
    const strategy = clipboardImageStrategy(
      event.clipboardData.getData('text/plain'),
      event.clipboardData.getData('text/html'),
      imageSources
    );
    if (strategy === 'html_only') {
      const cleaned = removeUnusablePastedImages(pastedSlice);
      if (!cleaned.removed) return false;
      event.preventDefault();
      const transaction = view.state.tr.replaceSelection(cleaned.slice).scrollIntoView();
      transaction.setMeta('workspaceOrigin', { kind: 'human', source: 'clipboard' } satisfies EditorTransactionOrigin);
      view.dispatch(transaction);
      return true;
    }
    const files = strategy === 'embedded_data'
      ? imageSources.map(embeddedImageFile).filter((file): file is File => file !== null)
      : clipboardFiles;
    if (!files.length) return false;
    event.preventDefault();
    const pending: { file: File; pasteId: string; objectUrl: string; image: ProseMirrorNode }[] = [];
    const pendingImage = (file: File): ProseMirrorNode => {
      const pasteId = globalThis.crypto?.randomUUID?.() ?? `paste_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const objectUrl = URL.createObjectURL(file);
      const image = schema.nodes.image.create({
        pasteId,
        src: objectUrl,
        alt: file.name || 'Pasted image',
        fileName: file.name || 'Pasted image',
        mimeType: file.type,
        state: 'pending'
      });
      pending.push({ file, pasteId, objectUrl, image });
      return image;
    };
    const mapped = mapPastedImageNodes(pastedSlice, files.length, (index) => pendingImage(files[index]));
    let fileIndex = mapped.consumed;
    let transaction = view.state.tr.replaceSelection(mapped.slice);
    while (fileIndex < files.length) {
      const image = pendingImage(files[fileIndex++]);
      transaction = transaction.replaceSelectionWith(schema.nodes.paragraph.create(null, image));
    }
    transaction = transaction.scrollIntoView();
    transaction.setMeta('workspaceOrigin', { kind: 'human', source: 'clipboard' } satisfies EditorTransactionOrigin);
    view.dispatch(transaction);
    for (const item of pending) void finishImagePaste(item.pasteId, item.file, item.objectUrl);
    return true;
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
    const initialDoc = schema.nodeFromJSON(richDocumentToProseMirror(initialDocument ?? richDocumentFromText(initialContent)));
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
          'Mod-y': () => { onRedoRequest(); return true; },
          'Mod-b': toggleInlineMark('bold'),
          'Mod-i': toggleInlineMark('italic'),
          'Mod-u': toggleInlineMark('underline'),
          'Mod-Shift-x': toggleInlineMark('strikethrough'),
          'Mod-k': () => { openLinkEditor(); return true; },
          'Enter': splitListItem(schema.nodes.list_item),
          'Tab': sinkListItem(schema.nodes.list_item),
          'Shift-Tab': liftListItem(schema.nodes.list_item)
        }),
        keymap(baseKeymap)
      ]
    });
    view = new EditorView(mount, {
      state,
      transformPasted: (slice) => normalizeListSlice(slice, schema),
      handlePaste: (_view, event, slice) => pasteImages(event, slice),
      dispatchTransaction(transaction) {
        if (!view) return;
        const before = snapshot(view.state);
        const origin = transactionOrigin(transaction);
        const changes = transaction.docChanged ? transactionChanges(transaction) : [];
        const provisional = view.state.apply(transaction);
        if (transaction.docChanged) {
          const after = snapshot(provisional);
          const projection = onEditorTransaction({ before, after, changes, origin });
          if (projection) transaction.setMeta(suggestionPluginMeta, {
            suggestions: projection.suggestions,
            formats: projection.formats,
            documentId: branchId,
            activeId: activeSuggestionId,
            preview
          });
        }
        const next = view.state.apply(transaction);
        view.updateState(next);
        if (transaction.docChanged) {
          const after = snapshot(next);
          onTextChange({ text: after.text, characters: Math.abs(after.text.length - before.text.length), origin });
        }
        if (transaction.docChanged || transaction.selectionSet) notifySelection();
      }
    });
    const initialSnapshot = snapshot(view.state);
    refreshFormattingState();
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
    const anchor = [...view.dom.querySelectorAll<HTMLElement>('.mn-suggestion[data-suggestion-id]')]
      .find((element) => element.dataset.suggestionId === suggestion.id);
    anchor?.scrollIntoView({ block: 'center', inline: 'nearest' });
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

<div class="formatting-toolbar" aria-label="Document formatting">
  <select aria-label="Paragraph style" value={currentFormatting.blockStyle} onchange={chooseTextBlock}>
    <option value="paragraph">Paragraph</option>
    <option value="heading1">Heading 1</option>
    <option value="heading2">Heading 2</option>
    <option value="heading3">Heading 3</option>
  </select>
  <span class="toolbar-divider" aria-hidden="true"></span>
  <button type="button" class:active={currentFormatting.bold} aria-pressed={currentFormatting.bold} aria-label="Bold" title="Bold (Command+B)" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleInlineMark('bold'))}><strong>B</strong></button>
  <button type="button" class:active={currentFormatting.italic} aria-pressed={currentFormatting.italic} aria-label="Italic" title="Italic (Command+I)" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleInlineMark('italic'))}><em>I</em></button>
  <button type="button" class:active={currentFormatting.underline} aria-pressed={currentFormatting.underline} aria-label="Underline" title="Underline (Command+U)" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleInlineMark('underline'))}><u>U</u></button>
  <button type="button" class:active={currentFormatting.strikethrough} aria-pressed={currentFormatting.strikethrough} aria-label="Strikethrough" title="Strikethrough (Command+Shift+X)" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleInlineMark('strikethrough'))}><s>S</s></button>
  <span class="toolbar-divider" aria-hidden="true"></span>
  <button type="button" class:active={currentFormatting.bulletList} aria-pressed={currentFormatting.bulletList} aria-label="Bullet list" title="Bullet list" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleList('bullet_list'))}>• List</button>
  <button type="button" class:active={currentFormatting.orderedList} aria-pressed={currentFormatting.orderedList} aria-label="Numbered list" title="Numbered list" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleList('ordered_list'))}>1. List</button>
  <button type="button" aria-label="Normalise list" title="Repair list markers in the selected text" disabled={!currentFormatting.hasSelection} onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(normalizeSelectedList)}>Fix list</button>
  <button type="button" class:active={currentFormatting.blockquote} aria-pressed={currentFormatting.blockquote} aria-label="Block quote" title="Block quote" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(toggleBlockquote)}>“ ”</button>
  <span class="toolbar-divider" aria-hidden="true"></span>
  <button type="button" class:active={currentFormatting.link} aria-pressed={currentFormatting.link} aria-label="Edit link" title="Link (Command+K)" disabled={!currentFormatting.hasSelection} onmousedown={(event) => event.preventDefault()} onclick={openLinkEditor}>Link</button>
  <button type="button" aria-label="Clear formatting" title="Clear inline formatting and return selected blocks to paragraphs" onmousedown={(event) => event.preventDefault()} onclick={() => runFormatting(clearFormatting)}>Clear</button>
</div>
{#if linkEditorOpen}
  <form class="link-editor" onsubmit={applyLink}>
    <label>Link URL <input type="url" bind:value={linkHref} placeholder="https://example.com" /></label>
    <button type="submit" disabled={!linkHref.trim()}>Apply</button>
    {#if currentFormatting.link}<button type="button" onclick={removeLink}>Remove</button>{/if}
    <button type="button" onclick={() => linkEditorOpen = false}>Cancel</button>
  </form>
{/if}
<div class="editor-frame" style={`--editor-zoom:${zoomPercent / 100}`}>
  <div class="editor" role="presentation" bind:this={mount} onmouseup={notifySelection} onkeyup={notifySelection}></div>
</div>

<style>
  .formatting-toolbar { position: sticky; z-index: 13; top: 58px; display: flex; min-height: 34px; flex-wrap: wrap; align-items: center; gap: 2px; margin-bottom: 8px; padding: 4px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--paper) 96%, transparent); box-shadow: 0 5px 18px rgb(38 31 22 / .07); backdrop-filter: blur(10px); }
  .formatting-toolbar select, .formatting-toolbar button, .link-editor input, .link-editor button { border: 1px solid transparent; border-radius: 3px; background: transparent; color: var(--ink-soft); font: 600 10px/1 var(--font-ui); }
  .formatting-toolbar select { height: 27px; min-width: 96px; border-color: var(--line); background: var(--paper); padding: 0 22px 0 7px; }
  .formatting-toolbar button { min-width: 28px; height: 27px; padding: 0 7px; cursor: pointer; }
  .formatting-toolbar button:hover, .formatting-toolbar button.active { border-color: var(--line-strong); background: var(--paper-deep); color: var(--accent); }
  .formatting-toolbar button:disabled, .formatting-toolbar select:disabled { cursor: default; opacity: .38; }
  .toolbar-divider { width: 1px; height: 19px; margin: 0 3px; background: var(--line); }
  .link-editor { position: sticky; z-index: 13; top: 101px; display: flex; align-items: end; gap: 5px; margin: -3px 4px 8px; padding: 7px; border: 1px solid var(--line-strong); border-radius: 4px; background: var(--paper); box-shadow: 0 8px 22px rgb(38 31 22 / .12); }
  .link-editor label { display: grid; flex: 1; gap: 4px; color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .link-editor input { height: 28px; border-color: var(--line); background: var(--canvas); padding: 0 8px; font-weight: 500; text-transform: none; letter-spacing: 0; }
  .link-editor button { height: 28px; border-color: var(--line); background: var(--paper-deep); padding: 0 9px; cursor: pointer; }
  .link-editor button[type='submit'] { border-color: var(--accent); background: var(--accent); color: white; }
  .link-editor button:disabled { opacity: .4; cursor: default; }
  .editor-frame { position: relative; min-height: 68vh; background: var(--paper); border: 1px solid var(--line); border-radius: 4px; box-shadow: 0 18px 60px rgb(38 31 22 / .08); overflow: hidden; }
  .editor { min-height: 68vh; }
  :global(.ProseMirror) { box-sizing: border-box; min-height: 68vh; padding: 48px clamp(24px, 3vw, 52px) 100px; outline: none; color: var(--ink); font-family: var(--font-reading); font-size: calc(20px * var(--editor-zoom, 1)); line-height: 1.82; caret-color: var(--accent); }
  :global(.ProseMirror p) { position: relative; margin: 0 0 1.2em; }
  :global(.ProseMirror h1), :global(.ProseMirror h2), :global(.ProseMirror h3), :global(.ProseMirror h4), :global(.ProseMirror h5), :global(.ProseMirror h6) { margin: 1.2em 0 .55em; font-family: var(--font-reading); line-height: 1.25; }
  :global(.ProseMirror blockquote) { margin: 1.2em 0; padding-left: 1.1em; border-left: 3px solid var(--line-strong); color: var(--ink-soft); }
  :global(.ProseMirror ul), :global(.ProseMirror ol) { margin: 1em 0 1.3em; padding-left: 1.8em; }
  :global(.ProseMirror li) { margin: .32em 0; padding-left: .15em; }
  :global(.ProseMirror li > p) { margin: 0; }
  :global(.ProseMirror table) { width: 100%; margin: 1.4em 0; border-collapse: collapse; font-family: var(--font-ui); font-size: .78em; line-height: 1.5; }
  :global(.ProseMirror td), :global(.ProseMirror th) { min-width: 64px; padding: 8px 10px; border: 1px solid var(--line-strong); vertical-align: top; }
  :global(.ProseMirror td p), :global(.ProseMirror th p) { margin: 0; }
  :global(.ProseMirror img) { display: block; max-width: 100%; height: auto; margin: 1.4em auto; }
  :global(.ProseMirror img[data-state='pending']) { opacity: .62; }
  :global(.ProseMirror img[data-state='failed']) { outline: 2px solid var(--reject); opacity: .72; }
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
  :global(.mn-preview-text) { color: var(--ink); background: color-mix(in srgb, var(--category-color) 13%, var(--paper)); border-bottom: 2px solid var(--category-color); white-space: pre-wrap; overflow-wrap: anywhere; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  :global(.mn-paragraph-note) { border-left: 2px solid color-mix(in srgb, var(--category-color, var(--accent)) 55%, transparent); padding-left: 14px; margin-left: -16px !important; }
  :global(.mn-format-strikethrough) { text-decoration-line: line-through; text-decoration-thickness: 1.5px; text-decoration-color: color-mix(in srgb, var(--reject) 72%, currentColor); }
</style>
