# Margin Note

Margin Note is a meta-first creative writing support POC. Svelte 5 Rune workspace
state is the live application source of truth. ProseMirror renders and reports editor
transactions; immutable SQLite document versions provide durable storage; Yjs and
IndexedDB form a write-behind document mirror behind the facade; and SQLite records
the event ledger. None of those adapters independently owns live manuscript state.

The domain direction is described in [ARCHITECTURE.md](./ARCHITECTURE.md), and the
deliberately small persistence boundary in [FACADE_V1.md](./FACADE_V1.md).
The next major proof of concept—a graph-backed Navigator with a protected, editable
**Spine**, fixed canonical **Todos**, configurable **Collections**, and fork-aware
terminal-style split views—is specified in [NAVIGATION.md](./NAVIGATION.md). AI and
reviewing remain in the right-side Inputs system rather than becoming Navigator
structure. The Navigator switches between a stable **Traditional** hierarchy and a
remembered, selection-aware **Context** projection without mutating the project graph.

The first Navigator POC is implemented: empty Spine-first projects, canonical Todos,
user-created Collections, content-bearing and nestable Nodes, confirmed typed
relationships, and remembered Traditional/Context projections all pass through the
Svelte workspace state and facade. See [NAVIGATION.md](./NAVIGATION.md) for the tested
boundary and deferred multi-pane and fork work.

The current screen is retained as evidence for the change-aware editor slice. Its
fixed AI actions and remaining developer tools are not the final Navigator UX. The
former Margin/Tray split has been consolidated into one Inputs panel, and that panel
now owns document review, run status, Input filters, source participation, provider
status, spend, and Input history.

## Run it

Requirements: Node 22+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. No API keys are required: the local craft checks
and deterministic replay sentinel are enabled by default.

For a quick tour:

1. Click **Review document** in the Inputs panel to populate its live Inputs.
2. Preview a replacement, accept/reject it, or use `Tab`, `1`–`3`, `Enter`, and `X`
   for keyboard review. Drag an Input's grip to reorder it, or focus the grip and use
   Arrow Up/Down.
3. Open **Ledger** to verify the instrumentation.
4. Visit **Compare** to evaluate current unresolved alternatives against the original wording. This records blind research judgments; it does not edit the draft.
5. Open **Context** to exercise the historical POC context path. It is not the target
   Spine/Collection interface.
6. Click **History** at the bottom of the Inputs panel to search, filter, reopen, or
   dismiss current and historical human/AI/system material.
7. Select text or use **Strike work** to exercise attachment-backed formatting, then
   use **Undo/Redo** to restore prose, input state, targets, and formatting together.
8. Use the editor pane's `−`, percentage, and `+` controls to change the local reading
   size without changing manuscript formatting.
9. Use the writing toolbar for paragraph and heading styles, bold, italic, underline,
   strikethrough, bullet and numbered lists, block quotes, links, and clearing inline
   formatting. These commands enter the same Svelte-owned transaction and Undo/Redo
   path as typing and rich paste.
10. Pasted sequences beginning with recognised bullets or sequential numbers are
    normalised into semantic lists. Select existing malformed material and use
    **Fix list** when an earlier paste needs the same repair.

## Change-aware workspace proof of concept

The implemented architecture slice provides:

- one continuous writing-and-editing surface rather than separate drafting/reviewing
  modes; Pause, source participation, Input visibility filters, density, and the Input surface control
  interruption instead;
- Svelte-owned canonical document, transaction, run, input, format, behaviour,
  revision, and undo/redo state;
- neutral structured document persistence for headings, paragraphs, bullet and numbered
  lists, supported inline marks, tables, and image references; pasted image bytes live behind the asset facade
  rather than inside Svelte or ProseMirror;
- an initial formatting toolbar for paragraph and heading styles, bold, italic,
  underline, strikethrough, lists, block quotes, links, and clearing formatting;
- conservative pasted-list normalisation that removes duplicate visible markers from
  semantic lists and converts consecutive marker paragraphs without treating hyphen-led
  prose as a list;
- a dedicated Svelte 5 Rune settings state for provider availability, masked
  credentials, model selection, validation, dialog state, and saving state;
- a shared content-target transformer for inputs and formats;
- delayed AI targets transformed through intervening edits, with changed passages
  discarded and exact provider source text verified before adoption;
- rejection of mid-word or whitespace-padded AI anchors and conservative semantic
  consolidation of paraphrased same-source annotations at the same locus;
- provider responses treated as proposals from which Svelte creates authoritative
  input IDs, targets, lifecycle, and provenance;
- diagnosis-only margin notes can select their current live target and immediately
  dispatch a contextual multi-option revision request; the same toolbar can request
  more options or accept one-shot custom writer instructions without introducing a
  separate chat history;
- common malformed AI JSON repaired locally before validation, followed by one
  corrective provider retry when output remains unusable; every malformed reply is
  retained in run diagnostics and logged to the browser console with its recovery
  outcome, while exhausted output failures do not produce a transient popup;
- atomic acceptance and undo/redo of prose plus input lifecycle state;
- explicit `target_changed` and `target_removed` input states with recorded events;
- selection- and whole-work strikethrough through the same attachment path;
- a first-class input manager rather than margin-only access;
- durable attachment state in document versions.

It does not yet provide complete rich format/style precedence, durable session
history, collaboration reconciliation, typed dependency
cascades, or a third-party plugin runtime. See [CRAFT_REVISION_QA.md](./CRAFT_REVISION_QA.md)
for verified workflows and the concrete remaining cases.

The Navigator now proves the Spine, canonical Todos, user-defined Material,
content-bearing containers, relationship vocabulary, and Traditional/Context
projections described in [NAVIGATION.md](./NAVIGATION.md). Split-pane focus/memory
rules and integrated AI review design remain deliberately postponed. A new visible
workspace starts without static demonstration content; automated tests create
explicit fixtures.

All application reactivity must follow [SVELTE_POLICY.md](./SVELTE_POLICY.md): Svelte
5 Runes, `$props`, snippets, and current event attributes, with a regression test that
rejects legacy reactive syntax.

## Optional providers

Open **OpenRouter settings** at the bottom of the Inputs panel to enter an API key and model without
leaving the editor. The server stores them in `data/provider-settings.json`, an ignored
owner-readable file (`0600`), rather than in the document, browser storage, database,
or event ledger. The Inputs panel displays only a masked credential hint such as
`sk-or******456`. This POC local file is not encrypted; an OS keychain adapter remains
the appropriate production replacement.

For a server-start configuration instead, copy `.env.example` to `.env` and configure
either OpenRouter or Ollama. Provider sources start **off** when configured through the
environment; click their source buttons to make them visible before dispatching.
Unavailable sources are labelled **not configured** rather than appearing usable.
Configured paid providers return to **off** after an app restart so a page load cannot
silently spend money; enable **Use** for A3 before using a selection action or document
review. The separate **Show** control only filters Inputs already returned and never
changes which sources a future review will call.

OpenRouter uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Ollama uses
`OLLAMA_MODEL` and, optionally, `OLLAMA_BASE_URL` (default
`http://127.0.0.1:11434/v1`). Both are called only from SvelteKit server routes.

## Persistence

- Browser recovery/collaboration mirror: Yjs in IndexedDB keys named
  `margin-note:document:<document-id>`, written only through the facade document
  driver after Svelte commits.
- Projects, durable documents, immutable document/context versions, and the event
  ledger: `data/writing-ledger.sqlite` by default.
- Inputs, formats, behaviour profiles, and workspace revision are stored under the
  document's `extensions.margin_note` payload and included in immutable document
  versions. Craft run records are stored there as well.
- On load, the durable document hydrates Svelte and the facade's downstream mirror;
  the browser mirror does not replace live Svelte state.
- Immediate undo/redo is intentionally session-local in this POC; durable document
  versions remain the recovery history across reloads.
- Change the ledger location with `LEDGER_PATH`.
- Markdown export is available from the document toolbar.

## Checks

```bash
npm run check
npm run build
```

The explicitly deferred items in §9 of [PLAN.md](./PLAN.md)—live multi-user sync,
branch comparison, DAG charts, Elo computation, whole-draft audits, and the in-context
variant carousel—remain architectural seams rather than POC features.
