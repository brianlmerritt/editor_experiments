# Writing Support Tool — POC Specification

> **Historical POC plan.** This file records the assumptions used to build the first
> experiment. Several decisions—especially event-log authority, Yjs-owned anchors,
> text-only undo, and project structure—have been superseded by
> [ARCHITECTURE.md](./ARCHITECTURE.md) and [FACADE_V1.md](./FACADE_V1.md). Retain this
> file as implementation history; do not treat conflicting passages as current
> architecture.
>
> The next workspace UX, protected Spine, canonical Todos, configurable Collections, graph
> relationship, and fork-aware navigation work is specified in
> [NAVIGATION.md](./NAVIGATION.md). The fixed modes, source bar, action buttons,
> Margin/Tray split, and build order below are historical POC choices rather than the
> target interface. Integrated AI review design is postponed until that structure is
> proved. The Navigator's Traditional/Context view switch is navigation state, not a
> return to the historical Drafting/Revising modes below.

A meta-first creative writing support tool. Multiple AI and local suggesters propose
edits and observations against a live draft; every interaction is captured in an
append-only ledger; a judging layer scores outcomes. The ledger and its analysis are
the product as much as the editor.

**Status:** POC. Installs may be rough (Node-based, local). Clean packaging comes later.

---

## 1. Core Concepts

### 1.1 Meta-first principle
The document is a *projection* of an event log. Every meaningful action — suggestion
generated, shown, accepted, rejected, superseded, edited-after-accept, mode switch,
pause, mute, brief change — is an immutable event in an append-only ledger (SQLite).
Analysis, judging, and the branch DAG all read from this ledger.

### 1.2 Suggestion model
A single schema all suggesters (AI or local) emit into:

- `id`
- `source` — which model / prompt / local tool produced it
- `anchor` — Yjs relative position range (converted to absolute positions at render)
- `type` — `replacement` | `insertion` | `annotation` (observation only, no proposed text)
- `payload` — replacement text and/or comment
- `category` — `pov` | `tense` | `canon` | `cadence` | `diction` | `distance`
- `confidence`
- `variants` — multiple candidate texts for the same span (multi-model / multi-prompt)
- `state` — `pending` | `accepted` | `rejected` | `superseded` | `stale` | `hidden`
- provenance: prompt version, brief version, model params, timing, token/cost data

**Rule: suggestions never touch the document.** They are decorations + ledger objects.
Acceptance is an ordinary writer-client transaction, tagged with the suggestion ID via
transaction origin metadata.

### 1.3 Writing brief & prompts
- **Brief** (shared system context for all AI): fiction vs non-fiction, POV, tense,
  narrative distance, background/canon. **Versioned.** Every generation event records
  the brief version it ran under. Material brief changes expire/flag stale suggestions.
- **Task prompts** (per-suggester instructions): user-editable, therefore **versioned
  data**, first-class in the ledger.
- **Canon/background doc:** included in prompts under a character budget (dumb
  truncation for POC; seam left in prompt assembly for retrieval later — see TBD).

### 1.4 Modes
- **Drafting:** decorations hidden; sentinels accumulate silently as a count badge
  ("7 notes"); minimal chrome; writer opts in to seeing findings.
- **Revising:** margin opens, decorations paint, review keymap active, category filter
  bar visible.
- Mode switch is a ledger event and the natural trigger for the post-draft judging pass.
- **Pause button:** suspends sentinels, debounce timers, and API spend; stamps the
  ledger (a coffee break must not look like an 11-minute deliberation). Resume restarts
  the coalescing window fresh.
- **User-controllable dispatch thresholds** (word count and idle time), with per-mode
  defaults (e.g. drafting: 200 words / 90 s; revising: 5 s after a sentence settles).

---

## 2. Suggesters

### 2.1 Local (instant, no AI)
- Thesaurus / word alternatives on selection (WordNet-derived dataset, offline).
- retext/unified plugins: repeated words, passive voice, weasel/intensity words,
  readability.
- Cadence heuristics: sentence-length variance, repeated sentence openers.
- Filter-word detection (saw, felt, noticed, realized, seemed) — a distance tool.

### 2.2 AI — three temporal modes
1. **Continuous sentinels** — cheap/fast model, debounced, only changed paragraphs.
   Checks POV violations, tense slips, distance drift, canon contradictions. Emits
   mostly annotations. Distance rubric written explicitly into the sentinel prompt
   (narrator-intrusion tells, filter words, named-emotion statements vs the brief's
   declared distance).
2. **On-demand passes** — bubble-menu verbs on a selection: Heighten, Vary cadence,
   More distant, Synonyms, free-text prompt (~5 verbs max + "more"). Emit replacement
   suggestions, possibly several variants (different models / prompts / temperatures).
3. **Whole-draft audits** — TBD (see §9).

### 2.3 Providers
- **POC: OpenRouter + Ollama only** — covers all "usual suspects" through two
  OpenAI-shaped endpoints. Vercel AI SDK (server-side functions only) or direct fetch.
- Suggester interface is provider-shaped so more can slot in later (see TBD).

### 2.4 Dispatch & staleness
- Client-initiated fetch (request/response). No SSE/websocket in POC — suggestions
  arrive whole, buffered server-side.
- One AbortController per dispatch, keyed by range; cancel in-flight requests for
  ranges that changed.
- Validate on arrival: if the anchored text no longer matches what was sent, drop
  silently and ledger as `stale_on_arrival`.

### 2.5 Fake/replay suggester (build this first)
A suggester that emits scripted suggestions with configurable delays, or replays a
recorded ledger. Used to build the entire UI with zero token spend, demo without API
keys, and deterministically reproduce async interaction bugs.

---

## 3. Editor & Document Layer

### 3.1 Stack
- **Svelte 5 (runes) + SvelteKit** (node adapter).
- **ProseMirror directly** (not Tiptap) — the suggestion layer is the product, and
  it's all raw PM API (decoration plugin, custom keymaps, margin sync) anyway.
- **Yjs is IN** (decision: keep the multi-user door open):
  - `y-prosemirror` binding, `y-indexeddb` persistence. **No y-websocket in POC** —
    the live CRDT is client-local; the server receives versioned text snapshots via
    the workspace façade, but does not participate in the CRDT.
  - Suggestion anchors stored as **Yjs relative positions**, converted to absolute on
    each decoration render.
  - **AI sources are NOT Yjs participants** — no per-source client identities. They
    never write to the doc. Provenance lives in the ledger, not CRDT metadata.
  - **Transaction origins:** acceptance transactions tagged with suggestion ID +
    source. Enables ledger cross-referencing, atomic undo units, and (later)
    origin-filtered operations.
  - Undo: Yjs undo manager. Accepting a suggestion = one undo step reverting the text
    change only; ledger state is never undone (undo emits a new `reverted` event).
- **State:** runes stores in `.svelte.ts` modules (`$state`/`$derived`); no store
  library. Bridge to the (non-reactive) decoration plugin via metadata-only
  transactions when the store changes.
- **Persistence/backend:** `better-sqlite3`; the append-only event ledger remains JSON
  shaped, while durable projects, documents, document revisions, and context-bucket
  revisions use a deliberately small relational store behind the workspace façade.

### 3.2 Decorations (marks vs decorations rule)
- **Suggestions = decorations, always.** Never marks (marks would sync/undo/serialize
  suggestion clutter into the document).
- Inline decorations: pending-replacement underlines, category tints (8–12% opacity max
  — text always wins the contrast battle).
- Widget decorations: variant-count chip, in-selection spinner while an on-demand verb
  resolves (never a modal, never blocking).
- Node decorations: paragraph-scoped sentinel annotations (subtle left border).
- Underline styles as a redundant channel: solid = replacement proposed; dotted =
  annotation-only; wavy reserved for correctness categories.
- (Future, not POC: accepted-edit provenance visible in the doc would be a *mark* —
  tracked-changes style. See TBD.)

### 3.3 Branching
- **One Y.Doc per branch.** Fork = clone current state into a fresh doc, new IndexedDB
  key, ledger event linking parent snapshot → child. No Yjs subdocuments.
- The document-state DAG: nodes = snapshots, edges labeled with cause (suggestion X /
  human session). Human edits coalesced into sessions ("typing burst, 340 chars,
  4 min") — no keystroke-level nodes. DAG = `parent_id` + edge label in SQLite; no
  graph database.
- Rejected suggestions are dangling branches — kept deliberately; the counterfactuals
  are the most valuable data.
- POC branch UI: "fork from here" + branch switcher (name, word count, last edited).
  Compare view is TBD.

---

## 4. Suggestion UI

### 4.1 Surfaces
- **Inline** (faintest): underline/tint on the span.
- **Docked margin** (default in revising): Google-Docs-style right margin, cards
  anchored beside their text via `coordsAtPos`, re-synced on scroll/resize/doc change.
  Not vertically draggable (vertical position = text location, not priority).
- **Triage tray** (toggled, replaces docked — not both at once): cards detach into a
  plain orderable stack. Review loop then walks suggestions in the writer's order.
  Clicking a card scroll-jumps to and flashes its span.

### 4.2 Card anatomy
- Category hue as a 4px left border on a neutral body; category icon + name in text.
- **Bottom-right corner: source as a number**, tooltip on hover until learned; hovers
  are ledgered ("writer checked the source before deciding" = model-trust signal).
- **`L` or `A` immediately left of the number** (local vs AI).
- A static legend/key panel exists somewhere visible (tooltips remind, they don't
  teach).
- Variant count chip when multiple candidates exist for a span.

### 4.3 Interactions
- **Hover card** on flagged span: category, observation, proposed text, accept/reject.
  Anchored to the decoration (not the mouse), keyed by suggestion ID, ~150 ms debounce;
  must survive decoration re-render.
- **Preview-on-hold:** hovering accept (or holding a key) temporarily shows the
  replacement in place. Paragraph-scale rewrites: side panel, not inline diff.
- **Accept:** green tick on card, or `Enter` in review loop, or click the previewed
  variant. Deliberate gestures only — double-click is *not* accept (it opens the
  card/variants; double-click already means select-word).
- **Accepting one variant dismisses siblings** — ledgered as `superseded` (lost to a
  competitor), distinct from `rejected` (actively unwanted). Superseded pairs feed the
  judge as implicit comparisons.
- **Drag-to-dismiss** (docked + tray): horizontal drag off the margin edge past
  ~40px resistance = reject; slide-out animation; 5 s undo toast; both
  `dismissed_via_drag` and instant-undo are ledgered. 8px activation distance before
  the gesture commits; axis-lock horizontal-vs-vertical.
  Library: pragmatic-drag-and-drop (svelte-dnd-action as fallback).
  **Never drag inline decorations** — drag is a card-layer verb only.
- Tray drag-to-reorder: TBD (buttons/keyboard ordering first — see §9).
- **Keyboard review loop:** `Tab`/`Shift-Tab` next/prev suggestion, `1/2/3` variant,
  `Enter` accept, `Esc`/`x` reject, `e` accept-and-edit (cursor into accepted text;
  `accepted_then_edited` is a distinct ledger event). Full pass with no mouse.
- **Variant presentation (POC):** variants listed in the hover card with
  preview-on-hold. In-context carousel is the flagship v1.5 item (see TBD). Data model
  (variants, chip, superseded) built now regardless.
- Density controls: category visibility toggles (decoration-set filters), cap on
  visible inline suggestions with overflow queued in the tray.

### 4.4 Source buttons (bottom of editor) — three states
Per-source button with three states, default **visible**:

1. **Visible** — normal: dispatched, output shown.
2. **Invisible** — still dispatched; output hidden (`generated_hidden`). Shadow
   suggestions as counterfactual data ("did the hidden model propose what the writer
   wrote themselves?"). Cost readout **conspicuously includes invisible sources**.
3. **Off** — no requests sent to the service at all; in-flight requests for that
   source aborted. No spend, no shadow data.

**Cycle mechanics:** rapid clicks advance visible → invisible → off. If the button is
left in **invisible** for longer than a dwell threshold (~1 s), the cycle resets: the
next click returns it to **visible** (invisible then behaves as a simple toggle).
Reaching **off** therefore requires a deliberate rapid double-step — protecting both
the shadow-data stream and against accidental service cut-off. A click from **off**
always returns to **visible**. Dwell threshold is a tunable constant (see §11).

- Each state visually unmistakable (e.g. full color / dimmed with eye-slash / greyed
  out). Never color alone — icon per state.
- Every state change is a ledger event (`source_state_changed {from, to}`), including
  transient pass-throughs during rapid cycling (cheap, append-only, and "hesitated on
  invisible before committing to off" is itself a signal).
- Returning to visible does *not* dump the hidden backlog: suggestions with changed
  anchors expire as stale; only currently-valid ones surface quietly.
- Pending visible suggestions from a source moved to invisible/off: dimmed, not
  deleted.
- Switching a source **off** mid-dispatch: abort via that source's AbortControllers;
  responses that arrive anyway are ledgered `arrived_after_off` and not shown.

---

## 5. Color System

- **Hue = category. Source is never a hue** (protects blind judging; prevents
  "I ignore the purple ones" prejudice). Source = corner number + L/A badge only.
- **Temperature grouping:** correctness categories (POV, tense, canon) warm hues;
  enhancement categories (cadence, diction, heightening/distance) cool hues. Coarse
  question ("broken vs improvable?") readable peripherally.
- Same hue, three intensities across surfaces: inline faintest → card border →
  saturated swatch in the filter bar.
- **Never color alone:** category icons + text labels + underline styles (colorblind
  redundancy; faster parsing for everyone). Start from Okabe-Ito palette.
- **Design tokens from day one:** CSS variables (`--cat-pov`, …) consumed everywhere —
  editor, cards, filter bar, judging UI, analysis charts. Enables dark mode /
  alternate palettes later as a token swap (themes themselves: TBD).
- State is orthogonal to category: pending = category color; accepted = brief green
  flash then removal; superseded/dismissed = grey fade. Grey reserved system-wide for
  "no longer live."
- Variant count is a chip, never a color.

---

## 6. Ledger & Event Taxonomy

Append-only SQLite. Events include (non-exhaustive; JSON payloads):

`suggestion_generated` (full prompt, model, params, brief+prompt versions, span,
cost/latency/tokens) · `generated_hidden` · `suggestion_shown` · `accepted_via_tick` ·
`accepted_via_keyboard` · `accepted_then_edited` · `rejected` · `dismissed_via_drag` ·
`dismiss_undone` · `superseded_by` · `stale_on_arrival` · `expired_on_brief_change` ·
`human_edit_session` (coalesced) · `mode_switch` · `paused` / `resumed` ·
`source_state_changed {from, to}` · `arrived_after_off` · `brief_updated` (new version) ·
`prompt_updated` (new version) · `branch_forked` · `reverted` (undo of an acceptance) ·
`source_tooltip_hovered` · `judgment_recorded`

Document snapshots (or Yjs state vectors) at event boundaries so any event replays
against the text *as the suggester saw it*.

**Cost telemetry:** tokens, dollars, latency per generation — captured at the provider
layer (impossible to reconstruct later). Running session-cost readout in the UI.

**Ledger tail view:** dev panel showing the last N events live. One hour of work; the
truth serum that verifies instrumentation matches interaction.

---

## 7. Judging Layer

- A SvelteKit route (`/review`) reading the same SQLite. Same design tokens.
- **Pairwise, not absolute scores.** Before/after and variant-vs-variant pairs fall
  out of the graph for free.
- Rubric axes = the same category axes (POV fidelity, distance, cadence, diction,
  brief faithfulness) so scores connect to suggestion types.
- **AI judges are blind** (never see which model produced what), order randomized
  (position bias), judge model is not a contestant or judges rotate (self-preference
  bias).
- Human judging: same UI — two variants, the brief, click the better, optional
  one-line reason (qualitative gold).
- Store raw judgments; Elo/ratings computation is a later query (TBD).
- Triggered naturally at drafting→revising mode switches ("post draft") and after
  revision passes ("post revision").

---

## 8. Export & Dev Affordances

- **Markdown export** — early, it's an afternoon; writers need their words out.
- Full provenance export = copy the SQLite file.
- Fake/replay suggester (§2.5) built before any real provider wiring.

---

## 9. TBD — Designed-for, Not Built in POC

Each item below has a deliberate seam left in the v1 architecture.

| Item | Seam left in v1 | Notes |
|---|---|---|
| **y-websocket / live multi-user** | Yjs already in; doc structure unchanged | Add provider + awareness when a second participant (human or server-side agent) exists |
| **Server-side agent as a real Yjs client** | Per-source identity door open | The one case where AI gets a CRDT identity |
| **In-context variant carousel** | Variant data model + chip built now | Flagship v1.5 polish; arrow-key cycling of candidates rendered in the sentence |
| **Tray drag-to-reorder** | Tray + ordering field exist; buttons/keyboard first | Writer-declared priority ranking is valuable data; fiddliest gesture in the spec |
| **Branch compare view** | Forking + DAG lineage recorded | Side-by-side read-only editors + pairwise judge reuse |
| **Whole-draft audits** (pacing map, distance-over-time chart, POV report) | Ledger + snapshots contain everything needed | Analysis-layer features, side panel not inline |
| **DAG visualization** | DAG rows in SQLite | Mermaid or d3 reading the DB; lives in analysis, not the writing surface |
| **Elo / ratings per model·prompt·category** | Raw pairwise judgments stored | A query, written when there's data |
| **Browser inference (WebLLM / transformers.js)** | Suggester interface is provider-shaped | Viable as sentinels (3–8B classification-ish), not rewrites; Ollama covers local for now |
| **Direct provider keys (Anthropic, OpenAI, Gemini)** | Provider layer normalized | Config additions, not architecture |
| **Ghost-text "continue writing" + streaming** | None needed | A generation feature, not a revision feature; different tool |
| **Canon retrieval** (beyond char-budget truncation) | Seam in prompt assembly | For twenty-page world bibles |
| **Tracked-changes marks** (accepted-edit provenance visible in-document) | Suggestion-vs-mark rule documented | Provenance-as-mark is legitimate; suggestions never are |
| **"Revert all from source X"** | Transaction origins tagged | Selective CRDT undo gets messy with interleaved edits; experiment, not promise |
| **Auto-sorted triage** (learned per-writer priorities) | Reorder + acceptance events ledgered | The ledger will eventually answer whether L/A distinction, categories, etc. matter per writer |
| **Dark mode / colorblind palettes / user-remappable colors** | Design tokens from day one | Token swap |
| **Clean install / packaging** | — | Explicitly out of POC scope |

---

## 10. Build Order (de-risking the interaction layer)

1. **TypeScript types first:** suggestion schema + ledger event taxonomy. Everything
   else is a consumer of this contract.
2. ProseMirror + Yjs (y-indexeddb) editor shell; modes; pause.
3. Fake suggester + ledger writes + ledger tail view.
4. Inline decorations + hover cards (static fake data — design the feel before the
   async plumbing).
5. Accept/reject with correct undo units (transaction origins).
6. Keyboard review loop.
7. Docked margin cards (card anatomy incl. source number + L/A) + drag-to-dismiss.
8. Triage tray (button ordering).
9. Category filter bar + density cap.
10. Real suggesters: local (retext, thesaurus) → sentinels → bubble-menu verbs, via
    OpenRouter/Ollama; staleness handling; cost telemetry; three-state source
    buttons (incl. hidden
    generation).
11. Brief/prompt versioning UI.
12. Branch fork + switcher.
13. Markdown export.
14. `/review` pairwise judging route (human first, then blind AI judges).

---

## 11. Open Questions (settle during build, low risk)

- Runner-up lingering: after acceptance, do superseded variants fade instantly or dim
  for one beat allowing an accepted-vs-runner-up flip? (Extra pairwise signal vs UI
  strangeness — prototype both with fake data.)
- Exact per-mode default thresholds (200 w / 90 s drafting, 5 s revising) — tune by
  feel.
- Sentinel model choice on OpenRouter (Haiku-class candidates) — decide by cost/latency
  telemetry once it exists.
- Source-button dwell threshold (~1 s default): long enough that a deliberate
  visible→invisible→off double-step feels natural, short enough that a considered
  return-to-visible click never accidentally lands on off. Tune by feel; the
  `source_state_changed` timestamps in the ledger will show misfires.
