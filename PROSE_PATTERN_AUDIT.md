# Prose Pattern Audit

## Purpose and boundary

**Prose Pattern Audit** finds recurrent writing habits that weaken variety, precision,
or character distinction, regardless of whether the prose was written by a person or
a model.

It is not an AI-authorship detector and not a general document review. It does not
decide whether a scene should exist, whether the plot works, whether continuity is
correct, or whether the work satisfies its brief. Those remain **Document Review**
responsibilities.

## Pattern families

The semantic audit considers:

- cadence monoculture and repeated paragraph or sentence shapes;
- recycled lexical and somatic machinery;
- emotional restatement and explanation after a beat has already landed;
- stock emotional shorthand and transferable metaphors;
- voice convergence across speakers or viewpoint characters when comparison evidence
  exists;
- recurrent filtering, explanatory cappers, catalogue description, or summary that
  duplicates a scene-level beat.

It must distinguish an intentional refrain, character-specific diction, genre
convention, and pressure-appropriate rhythm from a limiting default. One ordinary
phrase is not a pattern.

## Implemented behaviour

The local precision-biased slice currently detects:

- document-wide concentration of paragraphs containing five words or fewer; and
- genuinely repeated breath, nod, swallow, heartbeat, or pulse vocabulary above both
  count and per-thousand-word thresholds.

These are measurable warnings, not automatic faults. Configured providers evaluate
the semantic families that require context, including emotional restatement and voice
convergence.

Each pattern family produces one **Prose pattern** Input. Its primary anchor identifies
the actionable occurrence; related anchors hold exact evidence distributed through the
document. The comment reports the observed recurrence. Local document patterns require
at least 250 words, so a short selection does not acquire a statistical diagnosis.

Svelte owns all targets, runs, Inputs and accepted changes. The action uses the same
frozen Writing Context, recovery, coalescing, persistence, export/import and undo path
as other actions.

## Manual test

1. Open **Inputs → Perform action…** and choose **Prose pattern audit**.
2. Use **Current document** for cadence, vocabulary and voice comparison.
3. Run once with only **Local craft checks** to inspect measurable findings.
4. Confirm that each recurrent habit is one multi-anchor card rather than many
   duplicate cards.
5. Run with one semantic provider and verify that findings remain about recurrent prose
   habits rather than plot, continuity or general review.
6. Compare any overlap with **AI pattern audit**; equivalent anchored findings should
   coalesce while substantively different concerns remain separate.
