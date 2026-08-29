# Margin Note architecture

This document is the authority for Margin Note's application architecture. The core
Svelte-source-of-truth slice described below is implemented; explicitly deferred
parts remain design targets rather than claims of completion. Where the original POC
plan conflicts with this document, this document wins.

The next graph-backed workspace and UX slice is specified in
[NAVIGATION.md](./NAVIGATION.md). It is a design target, not implemented behaviour.
The AI request, context, provider, proposal, and adoption contract is specified in
[AI_BOUNDARY.md](./AI_BOUNDARY.md). It refines this architecture without changing the
Svelte authority rule.
The native project archive and safe inverse-import boundary are specified in
[PROJECT_TRANSFER_V1.md](./PROJECT_TRANSFER_V1.md).
The distinction between replaceable persistence backends and replaceable authoring
systems—including a possible Windows/macOS Word adapter—is recorded in
[DOCUMENT_SYSTEM_ADAPTERS.md](./DOCUMENT_SYSTEM_ADAPTERS.md).

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
5. Formats, inputs, and Todos use the same content-target vocabulary. They have
   different payloads and lifecycle behaviours, not different anchoring technologies.
6. Every accepted mutation is an atomic transaction. Undo/redo reverses or reapplies
   the complete transaction, including text, formatting, input state, targets, and
   selection.
7. Behaviour such as what happens to an attachment when its target is edited is
   explicit workspace state, interpreted by one domain reducer. It is not scattered
   through Svelte components or editor plugins.
8. Writing, reviewing, and revising are one continuous workflow. Interruption is
   controlled with Pause, input visibility, source state, filters, and density—not a
   global drafting/reviewing mode that hides part of the workspace.
9. The **Navigator** is a derived structural and relationship projection over the
   Svelte workspace. It is not the domain model and does not own copied node data.
10. Collections are project-configurable, content-bearing Navigator Nodes that also
    organise stable, potentially content-bearing child Nodes. `chapter`, `scene`,
    `character`, and `location` are examples, not compulsory built-in hierarchy.
11. Every work has a protected, editable, versioned, fork-aware **Spine** establishing
    its scope, direction, narrative contract, and central knowledge.
12. Every work has a protected **Todos** root as well as canonical, content-bearing
    Todo records. A Todo title opens its durable document; its checkbox alone changes
    state. AI may propose a Todo through an Input but does not own the Todo.
13. One work may be viewed through multiple panes and forks. The focused pane selects
    the Navigator and Inputs/review projection; it does not create another source of
    truth.
14. The Navigator has remembered **Traditional** and **Context** projections.
    Traditional view is structurally stable; Context view responds to the focused
    pane and selection without mutating canonical Nodes or relationships.
15. The right-side **Inputs panel** owns review initiation and presentation. Svelte
    owns craft activity, run, and Input state; the facade executes and persists but
    does not decide activity status. Source participation in future requests is
    separate from source/category/density filters over existing Inputs.
16. AI interaction crosses the boundary as a Svelte-created request with a captured
    target and inspectable context manifest. Providers return untrusted proposals;
    only an explicit Svelte workspace transaction may adopt one.
17. Native project export captures the live Svelte aggregate through the facade;
    persistence may supply history and asset bytes but may not replace current records
    with an older durable copy. Import first builds and validates a candidate, then
    adopts it as one new-project workspace operation.

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
Yjs types stay inside their implementations. A future external document host such as
Word would require a separate document-system adapter and an explicit authority
decision; it must not be slipped into the persistence facade as an implementation
detail.

After initial hydration, pages and editor plugins must not independently mutate a
second copy of manuscript, format, or input state. UI-only state such as hover,
selection handles, open panels, and filters may live separately.

## Minimal workspace aggregate

The domain needs a small set of primitives:

1. **Collection definition** — a project-configurable category and its Node capabilities.
2. **Content node** — a stable, potentially content-bearing project item.
3. **Workspace edge** — typed containment, scope, reference, or lineage relationship.
4. **Fork** — one active lineage/projection of the work graph.
5. **Content target** — a text selection, node, node range, or union of those.
6. **Format** — presentation attached to content targets.
7. **Todo** — canonical, prioritised project work attached or applicable to content.
8. **Input** — human, AI, local-check, or system review material and proposals.
9. **Behaviour** — stored rules for transforming an attachment when content changes.
10. **Transaction** — one reversible semantic change.

Conceptually:

```ts
interface WorkspaceState {
  work: WorkIdentity;
  revision: number;
  spineNodeId: NodeId;
  collectionDefinitions: Record<CollectionId, CollectionDefinition>;
  nodes: Record<NodeId, ContentNode>;
  edges: Record<EdgeId, WorkspaceEdge>;
  forks: Record<ForkId, WorkFork>;
  activeForkId: ForkId;
  formats: Record<FormatId, FormatAttachment>;
  todos: Record<TodoId, TodoRecord>;
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

## Adaptable work structure and graph

Each content Node has a stable ID, a project-defined Collection, optional content,
revision counters, and JSON-compatible extension data. Having content and containing
children are independent capabilities:

```ts
interface ContentNode {
  id: NodeId;
  collectionId: CollectionId;
  title: string;
  content?: NodeContent;
  contentRevision: number;
  formatRevision: number;
  extensions: Record<string, JsonValue>;
}

interface WorkspaceEdge {
  id: EdgeId;
  type: string;
  fromNodeId: NodeId;
  toNodeId: NodeId;
  order?: number;
  scope?: TargetSet;
  extensions: Record<string, JsonValue>;
}
```

`chapter`, `scene`, `section`, `paragraph`, `character`, `research`, and
`narrative_rules` are optional Collection definitions or roles, not a compulsory
hierarchy. Renaming, moving, or reordering a node does not change its identity. The
core preserves extension data it does not understand.

Each ordinary Node has at most one primary structural parent. This containment is
acyclic and ordered. Typed cross-links, scopes, aliases, and derivation relations may
be many-to-many and circular. Removing an alias never deletes its target. Deleting a
parent with children requires an explicit delete-descendants, rehome, or cancel
decision. Readable inverse labels and ordering belong to project-owned relationship
definitions, while lifecycle, deletion, and graph integrity belong to the domain
reducer—not individual components. Cardinality and endpoint constraints remain
deliberately deferred until the initial writing vocabularies have been exercised. A
domain graph does not imply a graph database.

A Material type is itself a stable, content-bearing Node as well as an ordered
container. Selecting it opens its own content; expanding it reveals its children. The
current facade payload retains the internal `CollectionDefinition` name for backward
compatibility. Material type and child identities do not include their displayed
ordinal numbers. Optional numbering
is derived from sibling order and a configured start value, while an optional title is
stored independently. Nodes from one Collection may still appear beneath a Node from
another Collection through primary containment.

The Navigator renders the fixed, content-bearing Spine and Todos elements, one structural projection,
and optional relationship facets.
An alias under a scene points to the same character or location node that appears in
its primary collection. Additional smart views are queries and indexes, not copied
content. Detailed interaction and the unresolved Collection-creation rules are
recorded in [NAVIGATION.md](./NAVIGATION.md).

The Spine remains adaptable: freely named records and Collections can be added
without changing the core content model. Its protected root identity exists in every
work, while its data remains editable, versioned, and fork-aware. A specialised
add-on is justified only after a real workflow needs behaviour beyond a node,
relation, Collection field, Todo, or ordinary scoped Input.

## Navigator, panes, and forks

Navigator mode, per-view expansion, scroll, selection, recent-context memory, focused
pane, Input-card collapse, and panel width are Svelte-owned UI state or persisted user
preference. They never replace the canonical Spine, Todos, Nodes, edges, forks,
Inputs, or formats they project.

The content workspace is a terminal-style tree of horizontal and vertical splits.
Each pane carries a view context containing a work, fork, Node, view kind, Navigator
memory, selection, and location history. The focused pane determines which fork and
Node the Navigator and Inputs/review panel show. Focusing another pane restores that
pane's remembered Traditional/Context mode and the independent expansion, scroll,
selection, and recent-context state for each view. Multiple ProseMirror instances
may render different Nodes or forks, but all accepted changes enter the same workspace
command and transaction path. Exact pointer, touch, keyboard, and split gestures are
deferred until the basic pane manager can be tested.

Traditional view derives the stable hierarchy from primary containment. Opening a
structural Node establishes a remembered Navigator focus and enters Context
automatically. Context view derives an explainable one-hop neighbourhood from that
focus: direct parent, siblings, children, configured bidirectional relationships,
applicable Spine material, and confirmed Todos. Opening a Todo or supporting document
does not discard the structural focus. Context relevance never creates or reorders canonical graph records, and
unconfirmed AI relationships remain Inputs. Context changes respond to meaningful
targets rather than every caret movement, preserve editor focus and Navigator scroll,
and key remembered state by stable identities rather than current display positions.

Back/Forward traverses structural focus history. A per-Node neighbourhood disclosure
can expose another Node's one-hop vicinity without changing focus. Dragging changes
order or containment only and preserves Node ID, content, Collection membership,
optional title, relations, Inputs, and formats. Cross-Collection conversion is an
explicit future command, never an incidental result of drop position.

Selecting a collapsed content-bearing container expands it and opens that container's
own content in the focused pane. More elaborate combined-descendant views are deferred.

A content fork may vary one node; a work fork may vary Spine decisions and their
downstream graph. The active fork filters applicable nodes, relations, Spine state,
impacts, and Todos. Superseded material remains in lineage/history rather
than appearing throughout the active Navigator. Fork representation, comparison, and
cross-fork adoption remain design work in [NAVIGATION.md](./NAVIGATION.md).

A logical Node retains its identity across forks. Unchanged Node and relationship
state may be inherited; editing creates fork-specific state. Spine content, Todos,
Collections, relationships, and manuscript content are fork-aware, and every pane
carries the `forkId` used to resolve its projection.

## Content targets

Formats, Todos, and Inputs share this addressing vocabulary:

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

## Todos

**Todo** is the canonical representation of accepted work to perform. Every project
has a fixed Todos Navigator element even when it contains no records. A Todo may be
created directly by the writer, derived from an accepted impact, imported, or adopted
from an Input proposal:

```ts
interface TodoRecord {
  id: TodoId;
  title: string;
  detail?: JsonValue;
  targets: TargetSet;
  state: string;
  priority: number;
  forkId: ForkId;
  parentTodoId?: TodoId;
  origin: TodoOrigin;
  originInputId?: InputId;
  events: TodoEvent[];
  createdAtRevision: number;
  updatedAtRevision: number;
}
```

This is illustrative rather than a frozen contract. Todos may relate to the Spine,
multiple containers or Nodes, manuscript selections, decisions, impacts, and forks.
The same stable Todo ID addresses its editable Todo document; long-form planning is
not packed into `detail` metadata or reduced to a card. The title is a Navigator
projection, and the checkbox is the only direct done/open control.
Prioritised and target-filtered Todo lists are derived views over the canonical
records. `parentTodoId` preserves a path to nested subtasks, although nested Todo UI is
not part of day one.

An AI or local check can propose a Todo only as an Input. The Todo enters authoritative
project state through an explicit adoption transaction and retains provenance to the
originating Input. Resolving, deferring, reprioritising, moving, or deleting a Todo is
a normal reversible domain transaction. AI-created tasks are not part of the initial
Navigator scope, but origin/provenance is general enough to introduce them deliberately
later without changing Todo identity.

## Inputs

**Input** is the user-facing term for material brought to bear on the work. It includes
human comments, AI or local-check findings, rewrite suggestions, questions,
conversations, and proposed changes to prose, the Spine, Todos, Collections, or
relationships. Canonical Todos, accepted decisions, and authoritative Spine/Collection
records are not Inputs.

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
margin in the right-side Inputs/review system. Derived views should support filtering
and grouping by target, scope, kind,
state, source, author/model, priority, tag, assignee, creation revision, and whether
the target remains attached. These indexes are projections of `inputs`, never the
canonical records.

A document review is one user activity that may fan out into several facade requests.
Each persisted `CraftRun` therefore carries a shared `batchId` and an explicit
`document` or `selection` scope. Svelte derives one aggregate activity status from
those records, including request, proposal, running, and unrecovered-error counts.
Individual paragraph calls remain diagnostic detail rather than becoming separate
user-facing jobs.

Existing-work assimilation follows the same rule at a larger scope. A manuscript,
supplied reviews, and the current project graph may produce a coordinated activity
whose runs propose Spine, Material, relationship, and Todo changes. Manuscript
evidence, adopted project knowledge, editorial opinion, and writer instruction retain
distinct context roles. Every proposed graph operation remains an Input until a
Svelte-owned adoption transaction accepts it; neither the provider nor the facade may
construct an authoritative shadow project. The workflow contract is specified in
[AI_BOUNDARY.md](./AI_BOUNDARY.md#existing-work-assimilation).

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
and change kind (`text`, `format`, `structure`, `collection`, `relationship`, `todo`,
`input`, `context`, or `fork`). It is the unit used to trigger review and cascading work. Permanent IDs or
hashes for every word are not required.

Reviews and generated inputs record their source revision and dependencies. A text
change can stale prose and continuity reviews without invalidating unrelated layout
work; a format-only change can invalidate layout checks without rerunning character
analysis; a character-state change can invalidate checks for the scenes in its scope.

An asynchronous provider request captures a Svelte-owned `ContentTarget`, source
revision, and exact source text before dispatch. The same workspace reducer transforms
that run target through every intervening edit. Edits before the range may move it;
any change within the requested passage discards the run. Provider output contains
passage-relative offsets plus exact `source_text`. Svelte verifies both against the
original request, adopts valid proposals as new authoritative inputs at the current
transformed target, and verifies the current excerpt again before replacement. The
provider and editor therefore never recover an anchor by guessing at similar text.
Non-insertion spans must also begin and end at stable text boundaries; a technically
exact but mid-word range is rejected because it cannot produce a trustworthy visible
attachment.

Provider transport first repairs common JSON syntax damage, then applies the complete
schema and attachment validation above. A run makes at most three provider attempts.
Output-only failures receive corrective retries containing the precise validation
failure. Explicit truncation raises the output allowance from 6,000 to 12,000 and then
at most 24,000 tokens. Rate limits and selected transient transport failures receive
bounded retries; authentication and configuration failures stop for reconfiguration
and are never disguised as malformed output. A successful proposal records the number
of provider attempts. If recovery is exhausted, the craft run retains its typed
diagnostics without a transient user notification. Every malformed reply—including
one successfully repaired locally or superseded by a valid retry—is retained on the
craft run and logged to the browser console with its attempt number, recovery outcome,
and a bounded copy of the raw provider output. A manual retry creates a new run for
only the failed, currently configured sources and first verifies that the live target
is unchanged; it neither overwrites history nor repeats successful providers.

Exact fingerprints prevent literal repetitions. A conservative second pass may
coalesce paraphrased AI annotations only when they come from the same source, have the
same category, substantially overlap the same target, share substantive vocabulary,
and do not have opposing critical/praising stances. Different locations, categories,
sources, replacement alternatives, and materially different observations remain
separate inputs.

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

Changing a durable Input-card state, moving a Navigator node, editing a relationship,
editing the Spine, changing a Todo, or creating a fork is also a domain mutation.
Dismissal, resolution, archival, and deletion must use explicit states and
transactions where they affect durable work. The final Input-card dismissal policy
remains open in
[NAVIGATION.md](./NAVIGATION.md).

## Persistence and implementation status

The first vertical slice is implemented. The Svelte workspace now owns canonical
document content and snapshots, transactions, craft runs, inputs, formats, behaviour
profiles, revisions, and the active undo/redo stacks.
A separate Svelte 5 Rune settings state owns live provider configuration state and
masked provider identity; the façade transports changes, while the server-side secret
adapter owns durable credential storage.

Svelte 5 Runes are the sole application-reactivity model. Components use `$props`,
`$state`, `$derived`, and `$effect`; shared reactive state lives in `.svelte.ts` Rune
modules. Legacy `$:` declarations, `export let` props, writable-store application
state, legacy slots, and `on:event` directives are not permitted. Plain variables are
reserved for deliberately non-reactive lifecycle handles and local calculations. The
enforced rules are recorded in [SVELTE_POLICY.md](./SVELTE_POLICY.md).
Existing suggestions are normalised as one input kind. Text edits, accepted revisions,
input state changes, and strikethrough formatting enter the same history path; text and
attachments are restored together by undo/redo.

Inputs and formats use the shared `ContentTarget` transformer. Complete target
deletion retains a craft input in `target_removed` state with a lifecycle event;
format ranges shrink, split, or disappear according to their behaviour profile. The
input manager exposes pending and historical states rather than leaving them only in
the margin.

The document's `extensions.margin_note` payload stores a neutral structured document,
current runs, inputs, formats, behaviours, and workspace revision in durable document
versions. Legacy string documents migrate to paragraph blocks without a destructive
database migration. The `content` string remains a derived plain-text representation
for search, word counts, AI and export compatibility; it is not the rich-document
authority. Editing marks the active document dirty in Svelte immediately. A
document-scoped facade queue captures that canonical snapshot, lets navigation switch
to another in-memory document without awaiting persistence, and performs the durable
write in order after yielding a browser frame. History retrieval is lazy and cannot
delay the document identity/content switch.
`EditorShell` owns a transient ProseMirror view only. It reports every
document transaction—including formatting-only changes—to Svelte before rendering,
then receives Svelte's transformed input and format projection in that same editor
transaction. It does not save, fork, export, or dispatch AI from editor-held text.

Clipboard HTML is parsed through the explicit editor schema and converted to the
neutral Svelte document. The first supported rich-paste set includes headings,
paragraphs, block quotes, bullet and numbered lists, bold, italic, underline,
strikethrough, links, tables, and images. Pasted image bytes are stored in the
workspace asset repository through the facade; Svelte owns the image node, durable
asset identity, metadata and lifecycle, while ProseMirror receives only a renderable
projection. A rich paste never assumes that an unrelated clipboard image file is the
source of an HTML image. This avoids treating the PNG/TIFF whole-selection preview
that macOS Word may place on the clipboard as an embedded document image. Exact
base64 HTML images are imported; inaccessible `file:` references remain unresolved
instead of being guessed. Advanced Word layout, merged-cell tools, image cropping and
full `.docx` import remain outside this slice.

The initial formatting controls use ProseMirror commands only to calculate editor
transactions for paragraph and heading styles, bold, italic, underline,
strikethrough, bullet and numbered lists, block quotes, links, and clearing
formatting. `EditorShell` immediately submits each transaction to the Svelte workspace
reducer; ProseMirror does not retain a separate authoritative formatting history.
Formatting changes therefore persist and undo through the same canonical document
path as typing and paste.

Clipboard list normalisation runs on the parsed ProseMirror slice before it becomes a
Svelte transaction. Existing semantic lists lose one redundant visible marker from
each matching item; runs of at least two recognised bullet or sequential-number
paragraphs become semantic list nodes. Hyphen-led paragraphs are deliberately not
inferred as lists. The same neutral normaliser powers the explicit **Fix list** command
for selected legacy material, so paste and repair do not maintain separate list models.

`WorkspaceFacade.commit` durably saves the Svelte snapshot and then passes the
acknowledged snapshot to a private Yjs/IndexedDB document driver. Yjs is a write-behind
mirror and possible future collaboration implementation; it neither binds to
ProseMirror nor supplies live application state. Mirror work has a bounded wait and
cannot prevent workspace startup or make a successful durable save appear unfinished.
Versioned mirror databases omit AI run history, activities, and shared context
snapshots; those remain in durable storage and can be rebuilt downstream. Provider transports likewise return
untrusted `InputProposal` data. Svelte owns run lifecycle, validates proposal anchors,
creates input IDs and targets, and decides whether a delayed result remains applicable.

The original durable payload repeated growing AI run and Input arrays in manuscript
revisions and in the opaque Yjs mirror value. New operational-only saves no longer
create manuscript revisions, and compact project export/import transfers current
state without the repeated revision tables. Historical import and general garbage
collection remain deferred while current manuscript state, meaningful versions, AI
evidence, session recovery, and rebuildable projections are separated. See
[RETENTION_AND_COMPACTION.md](./RETENTION_AND_COMPACTION.md).

The Navigator POC intentionally starts fresh. A new visible workspace contains the
protected empty Spine, protected empty Todos document and view, and state needed to create Collections
and Nodes—no static/generated manuscript, Collections, Nodes, Inputs, cards, or other
demonstration content. Existing reducer and editor tests must construct explicit
fixtures; the current demo content is not migrated into the Navigator workspace.

On every project open, Svelte verifies the fixed Spine and Todos identities and
materialises durable documents for legacy Collection definitions. This repair is
idempotent and non-destructive. A separate, project-name-confirmed Start over command
is the only operation that deliberately clears the project's working material and
recreates its empty fixed roots.

This remains a proof of concept rather than the completed model above. The Navigator,
protected content-bearing Spine and Todos, user-defined content-bearing Material,
stable Nodes, project-owned relationship definitions, and confirmed graph
relationships now have a first vertical slice. Relationship definitions can be
installed from editable writing sets or created directly; installing vocabulary does
not create links or content. New links consist of two Material endpoints, a selected
relationship type, and an optional explanatory note. Legacy applicability scope is
preserved on read but is not exposed by the initial relationship workflow.
Fork-aware graph variance and the terminal-style split-pane projection are not
implemented; history stores complete snapshots instead of compact forward and inverse
patches; current session undo is not restored after reload; and collaborative
transaction reconciliation is not implemented. Regression evidence and the exact next cases are
recorded in [CRAFT_REVISION_QA.md](./CRAFT_REVISION_QA.md). The next vertical slice is
defined in [NAVIGATION.md](./NAVIGATION.md).

Workbench geometry, editor zoom, and pane visibility are deliberately outside the
persistence facade's document model. Svelte Rune state owns the live Navigator width,
view-only editor zoom, and left/right pane visibility, with local browser persistence
as a UI preference. The application shell is fixed to the visual viewport so it
cannot inherit a smaller or rounded parent boundary. The current single-editor layout
gives the document column its own vertical scroll surface and treats the Navigator and
Inputs/review panel as independently scrolling, reclaimable side panes. A future split-pane manager must remain a projection over the same Svelte
workspace aggregate; it must not make CSS layout, ProseMirror, or a persistence driver
an alternative source of truth.

## Intentionally deferred

- choosing Yjs, another CRDT, or operational transformation as the collaboration
  implementation;
- a runtime third-party plugin system;
- choosing a permanent extension/plugin contract before real add-ons prove its shape;
- a graph database or formal literary ontology—the domain may still store typed
  node/edge relationships using ordinary persistence;
- OKF, Obsidian, TEI, JSON-LD, or another canonical interchange standard;
- formal temporal reasoning;
- automatic schema migration for arbitrary add-on data;
- multi-work or portfolio management.

Various editors and `local-first-ai-editor` have now been examined as UX evidence. The
lessons retained are a quiet hierarchical navigator, content-bearing containers,
optional panes, adaptable context, configurable actions, and human-controlled edits.
Margin Note will not copy any of the reviewed editors' product scope nor `local-first-ai-editor`'s
document authority and annotation architecture. See
[NAVIGATION.md](./NAVIGATION.md).

Markdown, DOCX, EPUB, and other exports are projections. They are not the canonical
workspace state.
