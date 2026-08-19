# Craft revision QA

Updated: 18 August 2026

This records observed POC behaviour and regression evidence. It is not the source of
architectural decisions. The authoritative target model is
[ARCHITECTURE.md](./ARCHITECTURE.md), and persistence responsibilities are specified in
[FACADE_V1.md](./FACADE_V1.md).

## Workflows exercised

- Entered and replaced prose in the rendered ProseMirror editor.
- Clicked inside an underlined word and inserted characters without replacing the whole word.
- Selected a word and ran Heighten, Synonyms, More distant, and one-word Vary cadence requests.
- Selected a sentence and ran Vary cadence.
- Applied an alternative directly, used accept-and-edit, rejected a note, and undid prose edits.
- Configured OpenRouter from the Sources bar, restarted the local server, and verified
  that the provider and masked `sk-or******456` credential returned without exposing
  the entered key to the page or workspace payload.
- Verified the dedicated Svelte 5 Rune settings state opens the provider dialog,
  validates the explicitly named fields, updates A3 to visible, and reactively renders
  the returned masked identity after saving.
- Migrated all Svelte components from mixed legacy reactivity to `$props`, `$state`,
  `$derived`, `$effect`, snippets, and current event attributes. A policy regression
  test rejects reintroduction of the mechanically detectable legacy forms.
- Verified **Save provider** remains actionable even when browser/password-manager
  autofill has not emitted Svelte input events; submission reads the actual form and
  shows an explicit missing-field message when necessary.
- Used the card keyboard flow to select variant 2 and accept it.
- Re-ran craft passes after edits, rejection, and undo, then checked live-card counts for duplicates and stale anchors.
- Inspected the docked margin with several cards of different heights.

## Reproduced bugs fixed

1. **Card shortcut overwrote prose.** Activating a card focused its selected editor range, so pressing `2` typed the numeral over the prose instead of choosing variant 2. Generated and clicked cards now receive review focus; editor clicks retain editing focus. The shortcut legend now says “Card keys”.
2. **Changed-anchor notes survived an accepted edit.** Every ProseMirror document
   transaction now enters the Svelte reducer before it is rendered. The reducer
   transforms or changes the lifecycle of all input and format targets and returns the
   resulting projection in that same editor transaction. There is no later positional
   anchor-reconciliation pass.
3. **Accept-and-edit did not select the accepted wording.** A non-empty replacement is now selected after acceptance, so typing genuinely edits/replaces that wording. The rendered check selected `saw` and cleanly replaced it with `glimpsed`.
4. **Selection state lagged behind document replacements.** Selection notifications now run after document changes as well as explicit selection transactions, preventing a stale selection toolbar after acceptance.
5. **Cadence replay produced broken punctuation.** The observed outputs included `clock. and` and `clock,. And`. The local replay now changes a comma-plus-conjunction pivot to either `clock. And` or `clock — and`; it returns an annotation rather than fabricating a rewrite when no safe local pivot exists.
6. **Some word alternatives broke the surrounding grammar.** Multiword substitutions such as `caught sight of` produced `caught sight of the clock was running`. The small offline replay list now uses part-of-speech-compatible alternatives for its recognised words.
7. **A provider appeared visible without being usable.** Source availability is now
   supplied by the server. OpenRouter has an explicit durable local key/model dialog,
   a masked credential identity, and an unavailable source is labelled `not configured`
   and cannot be enabled. Paid sources deliberately restart in the `off` state.
8. **A real AI request could be hidden by the replay fallback.** Once an available AI
   source is selected, selection craft actions use that provider result rather than
   also generating the sentinel's unsupported-selection annotation.
9. **Strikethrough could be applied but not explicitly removed.** Selection and
   whole-work controls now toggle between apply and remove. Stored false overrides
   take precedence over broader true ranges without destroying the broader format.
10. **Typing at a formatted boundary lost the format.** The format behaviour now
    includes insertion and replacement text at both range boundaries. Existing POC
    documents migrate from the earlier boundary-excluding profile on load.
11. **OpenRouter fenced valid JSON in Markdown.** Provider parsing now extracts JSON
    from code fences or surrounding explanation, removes trailing commas, validates
    each suggestion's required schema, clamps confidence, and applies passage bounds
    before creating inputs. A raw `JSON.parse` no longer discards these responses.
12. **Sequential revision accepts could replace stale numeric positions.** Svelte now
    owns in-flight run targets and transforms them through each edit. A preceding edit
    moves a run target; an intersecting edit discards it. Providers must return exact
    `source_text`; uniquely identifiable wrong offsets can be repaired at the transport
    boundary, while missing or ambiguous anchors are rejected. Svelte verifies the
    original and current excerpts before adopting or applying a proposal.
13. **Choosing an alternative required a second tick.** Clicking an alternative now
    applies that exact alternative immediately. The redundant acceptance tick has been
    removed; accept-and-edit remains available as a separate action.
14. **Selecting provider-setting text could dismiss the dialog.** The OpenRouter
    backdrop no longer closes the dialog. Only Cancel or the explicit close button can
    abandon the form.
15. **Legacy provider cards appeared precisely drawn but discussed different text.**
    Inspection showed that the pre-Svelte inputs themselves stored excerpts such as
    `inutes slow, and she resisted the urge` and `The porter sto`. A one-time authority
    migration now archives live `sg_…` inputs as historical/stale instead of presenting
    their untrustworthy targets. New provider and Svelte validation rejects exact but
    mid-word or whitespace-padded spans.
16. **Paraphrased AI annotations accumulated as separate cards.** Exact fingerprints
    could not recognise differently worded versions of the same distance diagnosis.
    Same-source AI annotations are now conservatively coalesced when category, target
    overlap, stance, and substantive vocabulary indicate the same issue. Differently
    located, oppositely valenced, cross-category, and replacement inputs remain
    separate.
17. **Malformed provider JSON produced a fleeting popup or lost the response.** The
    transport now repairs common model damage including fences, surrounding prose,
    trailing commas, unquoted keys, single quotes, and truncated containers before
    schema validation. If recovery is exhausted, it makes one corrective provider
    retry. Every malformed reply is retained on its craft run and written to the
    browser console with attempt, outcome, and bounded raw output—even when local
    repair or retry succeeds. An exhausted failure does not produce a transient user
    notification.
18. **Diagnosis cards identified a problem but offered no route to a revision.**
    Annotation-only cards now expose **Suggest revisions**. It selects the note's
    current Svelte-owned target and immediately asks an enabled provider for two or
    three category-aware alternatives. While running it reads **Suggesting…**. The
    normal selection toolbar remains open with **Suggest more…**, standard craft
    actions, and a one-shot custom request.
19. **Full craft pass sent a heading as an isolated passage.** Because Markdown headings
    are ordinary paragraphs in the current ProseMirror schema, `# Summer Storm` was
    dispatched by itself and the provider reasonably reported that no prose followed
    it. Craft-pass range selection now excludes structural-only headings and scene
    dividers while leaving them unchanged in the Svelte-owned manuscript.
20. **Custom-request example looked entered but was only a placeholder.** The field now
    uses a neutral placeholder and presents the example as an explicit **Use example**
    action. Clicking it fills the real request value, enables submission, and allows
    Enter or **Suggest revisions** to dispatch without retyping the sentence.

## Verification evidence

- Partial edit: clicking within `felt` and typing `X` produced `feXlt`; its anchored note disappeared immediately as stale.
- Keyboard review: with a Heighten card focused, `2` selected the second alternative without changing the prose; `Enter` applied `observed`.
- Accept-and-edit: the accepted word `saw` was selected and could be overtyped with `glimpsed`.
- Cadence: `Mara noticed the clock, and she stopped.` produced `Mara noticed the clock. And she stopped.` and `Mara noticed the clock — and she stopped.`
- Duplicate control: two consecutive craft passes left exactly one `felt` note, one adverb note, and one POV note. A rejected `felt` note did not return on the next pass.
- Margin-note revision bridge: browser QA clicked **Suggest revisions** on the `felt`
  distance annotation, verified the exact word became the editor selection, and found
  **Address Distance note**, standard craft actions, and the guarded custom request.
- Automated tests: 16 files passed, 82 tests passed.
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: passed.

## Change-aware workspace POC verified

- Accepted the scripted deletion of `slowly`; one Undo restored both the prose and
  pending input, Redo restored both accepted states, and a final Undo returned the
  test document to its starting prose.
- Deleted the complete `noticed` target. The input remained manageable in
  `target_removed` state with a recorded target event and detached-target label.
  Undo restored both the word and the pending attached input.
- Applied strikethrough to the whole work and to the selected word. Formatting
  decorations and the stored format count followed Undo/Redo without stale rendering.
- Opened the input manager with all 293 current and historical inputs, then filtered
  to pending and target-removed `noticed` inputs and located an attached input in the
  editor.
- Removed the global Drafting/Revising switch. Inputs, decorations, filtering,
  selection actions, and review keys now coexist with writing; Pause and visibility
  controls provide focus when wanted.
- Attachment state survived durable document version save/restore in an automated
  store test.
- Architecture-slice automated tests cover format boundary inheritance, reversible
  true/false strikethrough overrides, target mutation, and durable restore.
- Full automated suite: 16 files passed, 82 tests passed.
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: passed.

## Historical findings addressed by this slice

- Dismissing every visible note suppressed it only while the surrounding positions
  remained stable. Inserting a title before the prose caused previously dismissed
  notes to return. Position-bearing fingerprints are therefore not a durable substitute
  for stable targets plus explicit input lifecycle state.
- Editing and accepting suggestions previously exposed two histories. The Svelte
  workspace now records prose and the input lifecycle in one history entry.
- Complete target deletion previously made an annotation disappear from view. It now
  applies an explicit stored behaviour and records a target lifecycle event.

## Remaining limitations

- The bundled offline selection suggester is deliberately small. Unknown wording yields an annotation; richer contextual rewrites require an enabled AI source.
- “More distant” is only a word-level replay in the bundled sentinel, not a full narrative-distance rewrite.
- A multi-sentence selection is currently reduced to its first sentence by the scripted replay. This should be made explicit or expanded before treating passage-wide selection actions as production-ready.
- Hover preview has no keyboard or touch equivalent and could not be conclusively exercised with the current browser automation surface.
- Undo history is session-local and snapshot-based. It is not yet restored after a
  reload, compacted into forward/inverse patches, actor-aware, or reconciled with
  remote changes.
- The implemented structure is still one active ProseMirror document. Stable
  chapter/scene/paragraph node IDs, structural move/copy operations, and scoped
  formatting are not yet present.
- Only strikethrough proves the format path. Rich text properties, precedence,
  paragraph/section styles, editor-versus-compile presentation, and format export are
  not implemented.
- Existing ledgers can contain many superseded inputs. The manager exposes them, but
  needs grouping, pagination/virtualisation, bulk actions, and an explicit archival
  policy before production use.
- Drag-to-dismiss and its five-second undo toast were not exercised in this pass; ordinary reject was verified.

## Remaining target and undo regression coverage

The checked cases are complete in this POC; the unchecked cases remain before treating
the architecture as production-ready:

1. [x] Accept an input-proposed replacement, undo it, and verify both the original prose
   and pending input return; redo restores the accepted prose and accepted input state.
2. [x] Delete part of an input target and verify the stored behaviour shrinks, splits, or
   detaches it without creating a duplicate input.
3. [x] Delete an input's complete target and verify the configured removal, detachment, or
   state transition plus its system event; undo restores the exact prior target and
   state.
4. [x] Insert a title or paragraph before existing inputs and verify targets move without
   dismissed or resolved inputs reappearing.
5. [x] Delete or replace part of a formatted span and verify the format shrinks, splits,
   merges, or disappears correctly; undo restores text and formatting together.
6. [ ] Apply a format to a paragraph, chapter subtree, and whole work; verify precedence,
   future-content behaviour for live targets, and one-step undo/redo.
7. [ ] Split, merge, move, copy, and delete nodes while testing both format and input
   behaviour profiles.
8. [ ] Verify typing bursts, paste, IME composition, AI acceptance, and chapter formatting
   form natural atomic undo units and restore the caret or selection where practical.
9. [ ] Verify a text change invalidates only dependent reviews, while format-only and
   context-only changes trigger their respective typed cascades.
10. [ ] Reload with queued or persisted transactions and verify current input states and
    targets are reconstructed without duplicate notes.

## Svelte source-of-truth regression evidence

- A ProseMirror transaction updates `WorkspaceState.documentSnapshot`, the active
  `WorkspaceDocument.content`, targets, revision, and undo history synchronously.
- Save, fork, word count, export, formatting, and craft dispatch use the Svelte
  document rather than querying the editor view.
- An in-flight selection run moved from positions 1–8 to 5–12 after text was inserted
  before it; its returned proposal was adopted at 5–12.
- The same run was discarded when its selected text was replaced before the response
  arrived.
- Wrong provider offsets were repaired only with one exact `source_text` match;
  ambiguous and absent text were rejected.
- Facade tests verify that a durable document save precedes the downstream document
  mirror and that load hydrates the driver without exposing it to Svelte state.
- `y-prosemirror` and the former Yjs-relative request-anchor path are absent.
