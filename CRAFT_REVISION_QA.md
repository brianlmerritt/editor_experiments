# Craft revision QA

Date: 17 August 2026

## Workflows exercised

- Entered and replaced prose in the rendered ProseMirror editor.
- Clicked inside an underlined word and inserted characters without replacing the whole word.
- Selected a word and ran Heighten, Synonyms, More distant, and one-word Vary cadence requests.
- Selected a sentence and ran Vary cadence.
- Selected an alternative, accepted it, used accept-and-edit, rejected a note, and undid prose edits.
- Used the card keyboard flow to select variant 2 and accept it.
- Re-ran craft passes after edits, rejection, and undo, then checked live-card counts for duplicates and stale anchors.
- Inspected the docked margin with several cards of different heights.

## Reproduced bugs fixed

1. **Card shortcut overwrote prose.** Activating a card focused its selected editor range, so pressing `2` typed the numeral over the prose instead of choosing variant 2. Generated and clicked cards now receive review focus; editor clicks retain editing focus. The shortcut legend now says “Card keys”.
2. **Changed-anchor notes survived an accepted edit.** Provider-originated document changes skipped anchor reconciliation. Reconciliation now runs for every document change, while edit-session timers still ignore provider-originated changes. In the rendered check, accepting the Heighten replacement removed both the accepted card and the old local `noticed` annotation.
3. **Accept-and-edit did not select the accepted wording.** A non-empty replacement is now selected after acceptance, so typing genuinely edits/replaces that wording. The rendered check selected `saw` and cleanly replaced it with `glimpsed`.
4. **Selection state lagged behind document replacements.** Selection notifications now run after document changes as well as explicit selection transactions, preventing a stale selection toolbar after acceptance.
5. **Cadence replay produced broken punctuation.** The observed outputs included `clock. and` and `clock,. And`. The local replay now changes a comma-plus-conjunction pivot to either `clock. And` or `clock — and`; it returns an annotation rather than fabricating a rewrite when no safe local pivot exists.
6. **Some word alternatives broke the surrounding grammar.** Multiword substitutions such as `caught sight of` produced `caught sight of the clock was running`. The small offline replay list now uses part-of-speech-compatible alternatives for its recognised words.

## Verification evidence

- Partial edit: clicking within `felt` and typing `X` produced `feXlt`; its anchored note disappeared immediately as stale.
- Keyboard review: with a Heighten card focused, `2` selected the second alternative without changing the prose; `Enter` applied `observed`.
- Accept-and-edit: the accepted word `saw` was selected and could be overtyped with `glimpsed`.
- Cadence: `Mara noticed the clock, and she stopped.` produced `Mara noticed the clock. And she stopped.` and `Mara noticed the clock — and she stopped.`
- Duplicate control: two consecutive craft passes left exactly one `felt` note, one adverb note, and one POV note. A rejected `felt` note did not return on the next pass.
- Automated tests: 4 files passed, 22 tests passed.
- `npm run check`: 0 errors and 0 warnings.
- `npm run build`: passed.

## Remaining limitations

- The bundled offline selection suggester is deliberately small. Unknown wording yields an annotation; richer contextual rewrites require an enabled AI source.
- “More distant” is only a word-level replay in the bundled sentinel, not a full narrative-distance rewrite.
- A multi-sentence selection is currently reduced to its first sentence by the scripted replay. This should be made explicit or expanded before treating passage-wide selection actions as production-ready.
- Hover preview has no keyboard or touch equivalent and could not be conclusively exercised with the current browser automation surface.
- Undo restores prose, but does not reopen an accepted suggestion card as pending. A writer can rerun a general craft pass, but an identical accepted selection suggestion may remain coalesced as already resolved.
- Drag-to-dismiss and its five-second undo toast were not exercised in this pass; ordinary reject was verified.
