# Margin Note

Margin Note is a meta-first creative writing support POC. Svelte 5 Rune workspace
state is the live application source of truth. ProseMirror renders and reports editor
transactions; immutable SQLite document versions provide durable storage; Yjs and
IndexedDB form a write-behind document mirror behind the facade; and SQLite records
the event ledger. None of those adapters independently owns live manuscript state.

The domain direction is described in [ARCHITECTURE.md](./ARCHITECTURE.md), and the
deliberately small persistence boundary in [FACADE_V1.md](./FACADE_V1.md).
The future adapter boundary between the project domain and document systems such as
ProseMirror or desktop Word is recorded in
[DOCUMENT_SYSTEM_ADAPTERS.md](./DOCUMENT_SYSTEM_ADAPTERS.md).
Native complete-project `.mnote.zip` export and the validated inverse-import contract
are specified in [PROJECT_TRANSFER_V1.md](./PROJECT_TRANSFER_V1.md).
Moving development, writing projects, Codex context, and provider configuration
between computers is covered by [DEVELOPMENT_HANDOFF.md](./DEVELOPMENT_HANDOFF.md).
The Phase 1 AI request, Writing Context, provider, proposal, and adoption contract is
documented in [AI_BOUNDARY.md](./AI_BOUNDARY.md). It also defines existing-work
assimilation: using a manuscript, supplied reviews, and the current project vocabulary
to propose human-approved Spine, Material, relationship, and Todo changes.
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
remaining developer tools are not the final Navigator UX. The former Margin/Tray
split has been consolidated into one Inputs panel, and that panel now owns
project-defined AI actions, document review, run status, Input filters, source
participation, provider status, spend, and Input history.

## Run it

Requirements: Node 22+.

```bash
npm install
npm run dev
```

`npm install` runs SvelteKit's setup step automatically and generates the local
`.svelte-kit/tsconfig.json` required by the root TypeScript configuration. The
generated `.svelte-kit` directory is deliberately not committed. If dependencies
were installed with lifecycle scripts disabled, run `npx svelte-kit sync` once before
`npm run dev`.

Open the local URL printed by Vite. No API keys are required: the local craft checks
and deterministic replay sentinel are enabled by default.

For a new computer, do not copy `node_modules`, `.svelte-kit`, the SQLite ledger, or
provider settings as though they were one portable workspace. Follow
[DEVELOPMENT_HANDOFF.md](./DEVELOPMENT_HANDOFF.md) for the separate Git,
`.mnote.zip`, Codex-context, and credential transfer paths.

For a quick tour:

1. Click **Perform action…** in the Inputs panel to discuss or review the exact
   document, or select text and use the same command beside the selection to target
   only that selection. Confirm the
   response contract and read-only Writing Context in the preflight before running.
   Use **Manage actions** to edit the four project-owned defaults or add another.
2. Click **Review document** in the Inputs panel for the existing passage-by-passage
   review workflow. Edit the **Review Instructions** and start the review. Inputs
   appear progressively as each passage/provider check completes.
3. Preview a replacement, accept/reject it, or use `Tab`, `1`–`3`, `Enter`, and `X`
   for keyboard review. Drag an Input's grip to reorder it, or focus the grip and use
   Arrow Up/Down.
4. Open **Ledger** to verify the instrumentation.
5. Visit **Compare** to evaluate current unresolved alternatives against the original wording. This records blind research judgments; it does not edit the draft.
6. Open **Context** to exercise the historical POC context path. It is not the target
   Spine/Collection interface.
7. Click **History** at the bottom of the Inputs panel to search, filter, reopen, or
   dismiss current and historical human/AI/system material.
8. Select text or use **Strike work** to exercise attachment-backed formatting, then
   use **Undo/Redo** to restore prose, input state, targets, and formatting together.
9. Use the editor pane's `−`, percentage, and `+` controls to change the local reading
   size without changing manuscript formatting.
10. Use the writing toolbar for paragraph and heading styles, bold, italic, underline,
   strikethrough, bullet and numbered lists, block quotes, links, and clearing inline
   formatting. These commands enter the same Svelte-owned transaction and Undo/Redo
   path as typing and rich paste.
11. Pasted sequences beginning with recognised bullets or sequential numbers are
    normalised into semantic lists. Select existing malformed material and use
    **Fix list** when an earlier paste needs the same repair.
12. Open the project menu beside the Navigator's project selector and choose **Export
    project** to download a compact `.mnote.zip` archive. This includes current
    structure, Inputs/runs/provenance/usage, context, forks, and assets once, but never
    API keys or provider profiles. **Export forensic archive** separately includes all
    immutable revisions. Use **Import project…** to validate a compact archive and
    create it as a separate project. **Delete project** removes an unwanted complete
    project and this browser’s known recovery mirrors after typed confirmation; the
    final project is protected. Document-menu **Export Markdown** remains a publishing
    export.

## Change-aware workspace proof of concept

The implemented architecture slice provides:

- one continuous writing-and-editing surface rather than separate drafting/reviewing
  modes; AI interruption is controlled through independent per-project Reviews and
  Actions switches, source participation, Input visibility filters, and density
  controls. New projects begin with Actions enabled and Reviews disabled;
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
- rejection of mid-word or whitespace-padded AI anchors; ambiguous review findings
  remain visible as unanchored Inputs that require an explicit selection attachment,
  while selection-scoped revisions use the captured selection as authoritative;
- provider responses treated as proposals from which Svelte creates authoritative
  input IDs, targets, lifecycle, and provenance;
- typed Svelte-owned AI activities and runs that capture an immutable target, action,
  permitted proposal kinds, selected sources, and inspectable Writing Context before
  a narrow interaction service reaches the existing craft transport;
- project-owned, editable action definitions with explicit selection/document scope,
  provider preference, read-only context choices, response contract, option count,
  token ceiling, and optional temperature; compact export/import preserves them;
- four initial response contracts: readable commentary, precisely anchored findings,
  multiple complete revision options, and one complete alternative. Commentary and
  alternatives avoid unnecessary JSON, while structured output uses local repair and
  bounded corrective retries;
- rejection of hidden or rewritten returned context and unpermitted proposal kinds
  before provider output can become an Input;
- diagnosis-only margin notes can select their current live target and immediately
  dispatch a contextual multi-option revision request; the same toolbar can request
  more options or accept one-shot custom writer instructions without introducing a
  separate chat history;
- common malformed AI JSON repaired locally before validation, followed by at most
  two corrective retries when output remains unusable; every malformed reply is
  retained in run diagnostics and logged to the browser console with its recovery
  outcome, while exhausted output failures do not produce a transient popup;
- retained failed output can be replayed from **History** without another provider
  call; recovered unanchored Inputs remain non-applicable until attached to selected
  text, and that attachment participates in writing undo/redo;
- typed provider failures distinguish malformed output, truncation, transient
  transport, rate limits, authentication, and configuration; bounded automatic
  recovery retries transient failures and raises truncated output budgets, while
  completed work is retained and failed providers can be retried manually as a new
  run against an unchanged target;
- document review opens a Writing Context preflight with locked target and
  **Spine (including story brief)** evidence; optional Material, relationships, Todos, and writer-added
  Navigator Material are remembered per project/action and frozen into each run;
  additional Material choices are compactly grouped by the project's Material types
  with numeric title ordering and selected/available counts;
- Review Instructions live in that Inputs preflight rather than in a separate Brief
  screen. The Spine owns the story brief and overall writing direction;
- enabled remote providers each receive one whole-document request within a review
  activity; deterministic local sources share one local request. Successful Inputs
  become visible as each source completes, without repeating the full selected Writing
  Context for every paragraph;
- whole-document findings are mapped from provider text offsets back to exact editor
  positions, including content after block boundaries and inline images;
- Reviews and Actions have independent activity state. Suggesting revisions from an
  Input uses that card's canonical Svelte target, while Show filters and dismissal
  update immediately before their durable logging completes;
- provider spend is recorded once per completed provider call rather than once per
  resulting Input. OpenRouter-reported charges are retained directly; known direct
  Anthropic/OpenAI models use token-based estimates, including bounded corrective
  retries and successful calls whose output could not be adopted;
- startup reconciliation turns orphaned queued/running work into explicit interrupted
  run evidence with retry and complete-without-this-passage actions;
- atomic acceptance and undo/redo of prose plus input lifecycle state;
- explicit `target_changed` and `target_removed` input states with recorded events;
- selection- and whole-work strikethrough through the same attachment path;
- a first-class input manager rather than margin-only access;
- an undoable **Clear pending Inputs** action that removes the current live batch from
  the panel without treating it as rejection or suppressing the same issue in a later
  review; run evidence and accepted work are retained;
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

Open **Providers** at the bottom of the Inputs panel. Named profiles can use the
OpenAI-compatible protocol (including OpenRouter, OpenAI, Ollama, and compatible local
or hosted services), Anthropic Messages, or the official local Codex app-server.
Presets fill the usual endpoint and protocol; enter the exact model ID accepted by
that provider. More than one profile may be enabled for the same review.

**Codex / ChatGPT** is the no-API-key path for a local personal installation. It
requires the `codex` CLI to be installed and uses that installation's ChatGPT-managed
sign-in through `codex app-server`; it does not route through this development chat or
copy a ChatGPT token into Svelte. Choose the preset, check or start ChatGPT sign-in,
save the profile, and then enable its **Use** control. Each request runs as an
ephemeral, read-only Codex thread with approvals disabled and an isolated empty
working directory. JSON-based actions also pass a response schema to app-server;
Margin Note still validates, repairs, and anchors the returned proposal before Svelte
can create an Input. See the official [Codex app-server documentation](https://learn.chatgpt.com/docs/app-server).

The server stores profiles in `data/provider-settings.json`, an ignored
owner-readable file (`0600`), rather than in the document, browser storage, database,
or event ledger. The Inputs panel displays only a masked credential hint such as
`sk-or******456`. This POC local file is not encrypted; an OS keychain adapter remains
the appropriate production replacement. Existing single-profile OpenRouter settings
are migrated automatically. A Codex profile stores only its name, model, and local
adapter kind; ChatGPT authentication remains owned by the local Codex installation.

After saving, open **Filters**, then use the profile's **Use** control to include or
exclude it from future work. **Show** only filters Inputs that already exist. Open
**Runs** for the captured action, participating sources, outcome, attempts, recovery
classification, and retained error details. A failed or partially successful run can
retry only its failed configured providers; this creates a new auditable run and never
overwrites the earlier attempt or repeats successful providers.

**Review document** first opens the Writing Context preflight. Edit the **Review
Instructions**, inspect the required target and **Spine (including story brief)**,
choose whether applicable Material, relationships, and open Todos are included, and
use **Add context…** for other content-bearing project Material. Those choices are
remembered for that project and action, but the exact content and revisions are
captured afresh for every run. Inputs appear as individual provider checks complete.

For a server-start configuration instead, copy `.env.example` to `.env` and configure
OpenRouter, OpenAI, Anthropic, or Ollama. Provider sources start **off** when configured through the
environment; click their source buttons to make them visible before dispatching.
Unavailable sources are labelled **not configured** rather than appearing usable.
Configured paid providers return to **off** after an app restart so a page load cannot
silently spend money; enable **Use** before using a selection action or document
review.

Environment profiles use the matching `*_API_KEY`, `*_MODEL`, and optional
`*_BASE_URL` variables shown in `.env.example`. Ollama uses `OLLAMA_MODEL` and,
optionally, `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434/v1`). Providers are
called only from SvelteKit server routes.

## Persistence

- Browser recovery/collaboration mirror: Yjs in IndexedDB keys named
  `margin-note:document:<document-id>`, written only through the facade document
  driver after Svelte commits.
- Projects, durable documents, immutable document/context versions, and the event
  ledger: `data/writing-ledger.sqlite` by default.
- Inputs, formats, behaviour profiles, and workspace revision are stored under the
  document's `extensions.margin_note` payload and included in immutable document
  versions. Craft run records are stored there as well.
- Svelte captures dirty documents into independent background save queues. Navigator
  changes do not wait for a durable write or history fetch, and the editor header's
  animated book-and-pen indicator reports pending, saving, saved, or failed state
  across all documents.
- On load, the durable document hydrates Svelte and the facade's downstream mirror;
  the browser mirror does not replace live Svelte state.
- Immediate undo/redo is intentionally session-local in this POC; durable document
  versions remain the recovery history across reloads.
- Displayed provider spend is approximate when a direct provider reports tokens but
  not a dollar charge. Older successful calls are reconstructed from their run-level
  token evidence without multiplying calls that returned several Inputs; historical
  failed calls recorded before usage accounting cannot be reconstructed.
- Codex app-server runs retain token usage but show no API-dollar estimate: ChatGPT
  plan limits and usage do not have the same per-call price contract as API billing.
  The Inputs footer and Ledger show the aggregate Margin Note Codex usage in millions
  of input-plus-output tokens beneath tracked provider spend.
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
