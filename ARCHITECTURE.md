# Margin Note architecture

This document is the authority for Margin Note's intended application architecture.
It describes the direction of the experiment, not a claim that every part is already
implemented. Where the original POC plan conflicts with this document, this document
wins.

Margin Note remains an experiment. The architecture should keep the next experiment
cheap while protecting the things a writer must be able to trust: the current work,
its formatting, its inputs, and undo/redo.

## Current decisions

1. Margin Note works on **one work at a time**. It is not a multi-project manager.
2. The Svelte workspace state is the authoritative live application state.
3. The rendered editor, ProseMirror, Yjs, IndexedDB, SQLite, and exported files are
   adapters, persistence mechanisms, or projections. None defines the domain model.
4. The façade hydrates, persists, synchronises, and exports workspace state. It is not
   the source of truth. Its v1 boundary is specified in
   [FACADE_V1.md](./FACADE_V1.md).
5. Formats and inputs use the same content-target system. They have different payloads
   and lifecycle behaviours, not different anchoring technologies.
6. Every accepted mutation is an atomic transaction. Undo/redo reverses or reapplies
   the complete transaction, including text, formatting, input state, targets, and
   selection.
7. Behaviour such as what happens to an attachment when its target is edited is
   explicit workspace state, interpreted by one domain reducer. It is not scattered
   through Svelte components or editor plugins.
8. Writing, reviewing, and revising are one continuous workflow. Interruption is
   controlled with Pause, input visibility, source state, filters, and density—not a
   global drafting/reviewing mode that hides part of the workspace.

## Authority and boundaries

```text
Svelte pages and editor UI
  -> workspace commands
    -> WorkspaceState + domain reducer       AUTHORITATIVE LIVE STATE
      -> derived views and editor projection
      -> transaction outbox
        -> WorkspaceFacade                   BOUNDARY, NOT AUTHORITY
          -> browser persistence
          -> optional collaboration driver
          -> durable snapshots / server storage
          -> import and export

Remote or restored data
  -> WorkspaceFacade
    -> normalised workspace transaction or snapshot
      -> WorkspaceState + domain reducer
```

`EditorShell` adapts the active rich-text editor. It reports commands, selections, and
editor transactions in domain terms and renders the state it receives. ProseMirror and
Yjs types stay inside their implementations.

After initial hydration, pages and editor plugins must not independently mutate a
second copy of manuscript, format, or input state. UI-only state such as hover,
selection handles, open panels, and filters may live separately.

## Minimal workspace aggregate

The domain needs a small set of primitives:

1. **Content node** — a stable structural unit.
2. **Content target** — a text selection, node, node range, or union of those.
3. **Format** — presentation attached to content targets.
4. **Input** — human, AI, or system material attached or applicable to content.
5. **Behaviour** — stored rules for transforming an attachment when content changes.
6. **Transaction** — one reversible semantic change.

Conceptually:

```ts
interface WorkspaceState {
  work: WorkIdentity;
  revision: number;
  nodes: Record<NodeId, ContentNode>;
  formats: Record<FormatId, FormatAttachment>;
  inputs: Record<InputId, InputRecord>;
  behaviours: Record<BehaviourId, AttachmentBehaviour>;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  sync: SyncState;
}
```

This is one coordinated writable aggregate. Read-only derived views and indexes may
expose the current scene, visible inputs, effective formatting, or stale reviews, but
they are disposable and must not become competing sources of truth.

## Adaptable work structure

Each content node has a stable ID, a freely named type, an optional parent, ordered
children, revision counters, and JSON-compatible extension data:

```ts
interface ContentNode {
  id: NodeId;
  type: string;
  parentId: NodeId | null;
  childIds: NodeId[];
  text?: string;
  contentRevision: number;
  formatRevision: number;
  extensions: Record<string, JsonValue>;
}
```

`chapter`, `scene`, `section`, `paragraph`, `character`, `research`, and
`narrative_rules` are optional types or roles, not a compulsory hierarchy. Renaming,
moving, or reordering a node does not change its identity. The core preserves extension
data it does not understand.

The Codex remains adaptable: freely named records and buckets can be added without
changing the content model. A specialised add-on is justified only after a real
workflow needs behaviour beyond an ordinary scoped input.

## Content targets

Formats and inputs share this addressing vocabulary:

```ts
type ContentTarget =
  | { type: 'text'; nodeId: NodeId; start: number; end: number }
  | { type: 'node'; nodeId: NodeId; includeDescendants: boolean }
  | { type: 'nodeRange'; fromNodeId: NodeId; toNodeId: NodeId };

interface TargetSet {
  mode: 'snapshot' | 'live';
  targets: ContentTarget[];
}
```

A target set can describe one word, several paragraphs, a scene, scenes 1–3 plus 5
and 8, a chapter subtree, or the whole work. The UI may display ordinal scene numbers,
but state stores stable node IDs.

`snapshot` means the content selected at the time of attachment. `live` means a
structural scope whose later descendants may also be included. Directly formatting a
selection is normally snapshot-based; applying a chapter style is normally live.

Targets store current positions plus enough original evidence—source revision,
quotation, nearby context, and optionally a hash—to explain or recover a detached
target. Hashes validate identity and aid recovery; they are not the primary address.

## Formats

A format is an attachment whose payload affects presentation or export:

```ts
interface FormatAttachment {
  id: FormatId;
  target: TargetSet;
  properties: FormatProperties;
  behaviourId: BehaviourId;
  priority: number;
}
```

Formats may target character ranges, blocks, chapters, or the entire work. A whole chapter
or work may therefore be struck through. More specific formatting can override an
ancestor format; explicit `false` or `unset` values must be representable. Effective
formatting is derived from all applicable formats in a deterministic priority order.

Deleting text removes that text and therefore its current formatting. Remaining
format spans may shrink, split, merge, or disappear. Normalisation may combine
adjacent spans with identical effective properties. The inverse transaction retains
the deleted text and its formats so undo can restore them exactly.

## Inputs

**Input** is the user-facing term for material brought to bear on the work. It includes
human comments, AI findings, rewrite suggestions, todos, questions, instructions,
decisions, character states, continuity facts, research, and foreshadowing.

```ts
interface InputRecord {
  id: InputId;
  kind: string;
  anchors: TargetSet;
  scope?: TargetSet;
  content: JsonValue;
  source: InputSource;
  state: string;
  behaviourId: BehaviourId;
  events: InputEvent[];
  createdAtRevision: number;
  updatedAtRevision: number;
}
```

An **anchor** says where an input is visibly attached or discussed. A **scope** says
where it applies. A character version may be anchored to a character record while its
scope covers scenes 1–3, 5, and 8. A foreshadowing input may have one setup anchor and
several payoff anchors.

Inputs are expected to outnumber formats and need first-class management outside the
margin. Derived views should support filtering and grouping by target, scope, kind,
state, source, author/model, priority, tag, assignee, creation revision, and whether
the target remains attached. These indexes are projections of `inputs`, never the
canonical records.

## State-held attachment behaviour

The reducer implements a small finite vocabulary of target transformations. Workspace
state chooses which behaviour applies through named profiles, with an optional
per-attachment override:

```ts
interface AttachmentBehaviour {
  id: BehaviourId;
  insertionAtStart: 'include' | 'exclude';
  insertionAtEnd: 'include' | 'exclude';
  insertionInside: 'include' | 'exclude';
  partialDeletion: 'shrink' | 'split' | 'detach';
  completeDeletion: 'remove' | 'detach' | 'change_state';
  deletedState?: string;
  copy: 'copy' | 'reference' | 'omit';
  move: 'follow';
}
```

This avoids both extremes: attachment behaviour is not an invisible hard-coded rule,
but it is also not arbitrary executable code stored in the document.

When an input's complete target is deleted, its behaviour may remove it, detach it, or
move it to a state such as `target_removed`. A surviving input records a system event
containing the deleting transaction, prior target, and previous excerpt. It can then be
reattached, addressed, dismissed, or explicitly deleted.

The same transformation engine handles insertion affinity, partial deletion,
paragraph split/merge, structural movement, copying, and complete node deletion.

## Transactions and change awareness

All mutation enters through workspace commands and becomes one atomic transaction:

```ts
interface Transaction {
  id: TransactionId;
  actorId: string;
  source: 'human' | 'ai' | 'remote' | 'import' | 'system';
  beforeRevision: number;
  afterRevision: number;
  forward: Patch[];
  inverse: Patch[];
  affected: AffectedContent[];
  selectionBefore?: EditorSelection;
  selectionAfter?: EditorSelection;
  undoGroup?: string;
}
```

For a text edit, the reducer performs one semantic operation:

1. Apply the content change.
2. Transform every intersecting format and input target using its stored behaviour.
3. Record input lifecycle events and state transitions.
4. Normalise format spans.
5. Mark dependent reviews or other derived inputs stale according to typed affected
   content.
6. Advance revisions and record forward and inverse patches.
7. Add one undo entry, clear redo after a divergent edit, queue persistence, and
   update the rendered projection.

The affected-content record identifies changed nodes and before/after ranges, hashes,
and change kind (`text`, `format`, `structure`, `input`, or `context`). It is the unit
used to trigger review and cascading work. Permanent IDs or hashes for every word are
not required.

Reviews and generated inputs record their source revision and dependencies. A text
change can stale prose and continuity reviews without invalidating unrelated layout
work; a format-only change can invalidate layout checks without rerunning character
analysis; a character-state change can invalidate checks for the scenes in its scope.

## Undo, redo, and durable history

Undo/redo is a domain function, not merely browser, ProseMirror, or Yjs text history.
One semantic user action must restore or reapply all coordinated state:

- manuscript content and structure;
- formatting and normalised spans;
- input targets, states, and lifecycle events;
- invalidation state;
- selection and caret where practical.

Typing bursts, paste, accepting an AI revision, or formatting a chapter should each be
natural single undo units. IME composition must remain atomic. Undo applies stored
inverse patches; it must not rerun target policies and hope to reconstruct the previous
state. Redo applies the recorded forward patches.

In a collaborative implementation, local undo normally affects only the local actor's
transactions. Remote transactions enter through the same reducer and are not inserted
into another writer's undo stack.

Immediate undo/redo and durable version history are separate capabilities. The former
supports editing; the latter supports recovery, audit, comparison, and reopening a
past version.

## Persistence and implementation status

The first vertical slice is implemented. The Svelte workspace now owns inputs,
formats, behaviour profiles, document snapshots, and the active undo/redo stacks.
A separate Svelte writable settings store owns live provider configuration state and
masked provider identity; the façade transports changes, while the server-side secret
adapter owns durable credential storage.
Existing suggestions are normalised as one input kind. Text edits, accepted revisions,
input state changes, and strikethrough formatting enter the same history path; text and
attachments are restored together by undo/redo.

Inputs and formats use the shared `ContentTarget` transformer. Complete target
deletion retains a craft input in `target_removed` state with a lifecycle event;
format ranges shrink, split, or disappear according to their behaviour profile. The
input manager exposes pending and historical states rather than leaving them only in
the margin.

The document's `extensions.margin_note` payload stores the current inputs, formats,
behaviours, and workspace revision in durable document versions. Yjs and IndexedDB
remain editor persistence adapters during the experiment, but Yjs undo no longer owns
the user-facing history.

This remains a proof of concept rather than the completed model above. In particular,
the active document is still a single ProseMirror text tree rather than stable,
user-defined structural nodes; history stores complete snapshots instead of compact
forward and inverse patches; current session undo is not restored after reload; and
collaborative transaction reconciliation is not implemented. Regression evidence and
the exact next cases are recorded in [CRAFT_REVISION_QA.md](./CRAFT_REVISION_QA.md).

## Intentionally deferred

- choosing Yjs, another CRDT, or operational transformation as the collaboration
  implementation;
- a runtime third-party plugin system;
- choosing a permanent extension/plugin contract before real add-ons prove its shape;
- a graph database or ontology;
- OKF, Obsidian, TEI, JSON-LD, or another canonical interchange standard;
- formal temporal reasoning;
- automatic schema migration for arbitrary add-on data;
- multi-work or portfolio management.

Before designing that extension contract, compare Scrivener's binder, document
templates, labels/status/custom metadata, snapshots, editor layouts, and compile model.
The goal is to learn from its separation of project structure, writing presentation,
and published output without copying its storage model or making Scrivener a runtime
dependency.

Markdown, DOCX, EPUB, and other exports are projections. They are not the canonical
workspace state.
