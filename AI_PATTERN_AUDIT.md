# AI Pattern Audit

## Purpose and boundary

**AI Pattern Audit** is a narrow editorial action for recognised formulas and
statistical habits associated with unedited generated prose. It is not an authorship
detector. It never claims that AI wrote a passage, assigns an AI probability, or uses
an ordinary phrase as evidence of origin.

It does not perform general document review. Plot, pacing, continuity, character
development, ordinary emotion labels, voice effectiveness, and scene structure belong
to **Document Review** or **Prose Pattern Audit**.

The persisted action ID remains `ai-tell-audit` and its Input category remains
`ai_tell` for project compatibility. Their user-facing name and label are **AI pattern
audit** and **AI pattern**.

## Implemented behaviour

The action is project-owned and available through **Perform action…** for a selection
or current document. It uses frozen Writing Context, run recovery, exact anchors,
multi-anchor Inputs, and the Svelte-owned adoption and undo path.

With **Local craft checks** enabled, a deterministic precision-biased detector checks:

- stock openings, invitations, importance labels, conclusion announcements, corporate
  vocabulary, buzzword clusters, ceremonial significance and historic inflation;
- forced contrasts, double promises, synthetic balance, binary packaging, unnamed
  authorities, hedge and transition parades, and dangling significance;
- recurrent negative assertions, “thought about” catalogues, repeated sentence
  openings, excessive section breaks, and high em-dash density;
- a limited set of conspicuous generated-fiction formulas such as unknown held breath,
  generic emotion waves and mechanically heavy silence.

It deliberately does not flag literal physical phrases such as “the weight of the
mattress”, ordinary statements such as “he was scared”, or every occurrence of the
idiom “the way”.

Enabled providers receive a constrained semantic version of the same audit. The
instruction explicitly excludes general editorial commentary and requires a named,
recognised pattern with exact evidence. One repeated pattern produces one Input with
multiple anchors rather than one card per occurrence. Very frequent patterns use
representative anchors distributed through the passage and state their total observed
recurrence.

## Authority and lifecycle

- Svelte owns the target, action definition, run, Input, state and accepted change.
- Local and provider detectors return untrusted proposals through the same interaction
  boundary; neither writes to the document or Input store.
- Every primary and related anchor is checked against canonical text before adoption
  and current editor text before decoration.
- Dismissal, target transformation, history, export/import and undo/redo use normal
  Input behaviour.
- Cross-source/category duplicate coalescing prefers a more specific actionable craft
  Input over a generic diagnostic while preserving distinct replacement spans.

Older projects receive the renamed version once through the action-default migration.
A project deliberately removing the action after the current migration version does
not have it silently restored.

## Limits

- The local catalogue currently targets English prose.
- Deliberate formula, genre convention and technical language can still resemble a
  generated pattern.
- Provider judgement can over-report. Confidence means confidence in the editorial
  finding, never confidence in AI authorship.
- A future benchmark remains useful but is postponed until the action boundaries and
  live false-positive burden have been tested.

## Manual test

1. Open **Inputs → Perform action…**.
2. Choose **AI pattern audit** and select **Selection** or **Current document**.
3. For a free deterministic run, enable **Local craft checks** and disable configured
   providers for that run.
4. Confirm that recognised formulas appear as **AI pattern** Inputs and that ordinary
   emotion or physical wording is not reported.
5. Select a recurrent finding and confirm its card reports multiple anchors and every
   highlighted span is exact.
6. Repeat with one provider to compare semantic findings without treating agreement as
   an authorship vote.
