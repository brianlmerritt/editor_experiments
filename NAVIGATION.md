# Navigator and workspace direction

This document defines the next major Margin Note proof of concept: a quiet,
graph-backed **Navigator** and workspace around the existing Svelte-owned editor.
It records the UX and architectural discussion that followed the change-aware editor
work. It is a design target, not a claim that the Navigator has been implemented.

Where this document discusses navigation, Collections, relationships, forks, split
views, or the Inputs/review panel, it supplements
[ARCHITECTURE.md](./ARCHITECTURE.md). The architecture remains authoritative for
Svelte ownership, transactions, content targets, formats, inputs, undo/redo, and the
facade boundary.

## Product boundary

Margin Note is currently:

- one work open at a time, with forked views of that work permitted;
- a human writing and editing environment, not an autonomous content generator;
- one continuous writing, reviewing, and revising workflow;
- change-aware, fork-capable, and able to explain the effects of central decisions;
- adaptable to a short story, novel, non-fiction work, or another user-defined
  structure;
- based on Svelte 5 Rune state as the authoritative live source of truth;
- insulated from ProseMirror, Yjs, IndexedDB, SQLite, and future document technology
  by the workspace facade and editor boundary.

AI may identify problems, discuss them, propose language, or help organise work. The
human owns the manuscript. A proposed replacement does not alter prose unless the
writer explicitly applies it; direct human editing must remain the natural path.

## Why the current screen is not the target

The current POC accumulated controls while proving individual behaviours:

- Pause, Context, Inputs, Brief, Compare, and Ledger links;
- category and source filters plus density in the Inputs panel;
- project, document, rename, fork, export, word count, undo/redo, and formatting
  controls in one document strip;
- fixed Heighten, Vary cadence, More distant, Synonyms, Strikethrough, and custom
  selection actions;
- local craft, replay, OpenRouter, and Ollama participation controls in the Inputs panel;
- provider settings, document-review execution and status, spend, history, and keyboard legends.

Those controls are implementation evidence, not a layout to preserve. The next proof
of concept should begin with the writer's workflow and progressively reveal tools.
It should not rearrange every existing control into a different crowded toolbar.

## Writer workflow

The intended high-level workflow is:

1. Create or open one work.
2. Establish the mandatory **Spine**: the work's central scope and direction.
3. Create or choose Collections appropriate to this work.
4. Organise and navigate content and supporting material through the Navigator.
5. Capture and prioritise work through the permanent **Todos** view.
6. Write and format in the central workspace while consulting the Spine, Collections,
   relationships, and Todos.
7. Record decisions, discover their impacts, and manage outstanding work.
8. Fork when exploring a materially different direction.
9. Save continuously, undo or redo coherent actions, compare when useful, and export
   deliberately.

Drafting and revision are not separate application modes. The current selection,
visible panels, filters, and requested activity determine what the writer sees.

## Workspace regions

The target has three primary regions, each independently collapsible:

1. **Navigator — left.** The fixed Spine and Todos elements, durable Collection
   material, structural hierarchy, smart views, and optional relationship projections.
2. **Content workspace — centre.** The fully opened document, collection, asset,
   Todo view, comparison, fork, or other appropriate view. It may be split into two
   or more panes so the manuscript can remain visible beside the Spine, a Collection
   Node, Todos, or another fork.
3. **Inputs and review — right.** Human, AI, local-check, and system Inputs attached
   to the focused Navigator item, document, or selection. This is the future home of
   reviewing and AI interaction, not part of the Navigator.

The central workspace uses a terminal-style pane manager: panes may be split
horizontally or vertically and split again as needed. Each pane remembers its own
Node, fork, view kind, selection, and navigation history. The focused pane drives the
Navigator and Inputs/review context. Exact mouse, touch, and keyboard gestures are
deferred until the basic pane manager can be tested.

The minimum persistent chrome should communicate location, active fork, save state,
undo/redo, and access to commands/settings. Provider diagnostics, research ledgers,
source simulators, keyboard legends, and infrequent tools belong behind deliberate
commands or advanced views.

### Writing and formatting

The centre remains a serious text editor. Conventional formatting should be available
through familiar contextual or compact editor controls rather than mixed into AI
actions. Formatting a word, passage, node subtree, or whole work continues to use the
Svelte-owned format and target system described in
[ARCHITECTURE.md](./ARCHITECTURE.md).

Selection-specific formatting and writing assistance may appear contextually. A small
set of user-pinned actions may eventually remain visible, but the architecture must
not assume that every writer wants the current six fixed AI/style buttons. Formatting,
AI proposals, comments/inputs, and document commands are different activities even
when they operate on the same `ContentTarget`.

## The Navigator

The Navigator will have an indented project hierarchy.

It answers two different questions through two projections:

- **Structure:** what durable material exists, and what contains what?
- **Relationships:** what important things is this item connected to?

Structural Nodes such as chapters, scenes, sections, research Collections, or
user-defined equivalents are collapsible. A node may contain both content and child
nodes. There is no folder-versus-document binary: `has content` and `has children` are
independent capabilities.

The Navigator is fluid without making the project structure unstable. Most visible
elements retain fixed identity and ordering; expansion and contraction are the normal
changes. **Traditional** and **Context** remain available views, but opening a
structural Node establishes its focus and enters Context automatically. Back and
Forward traverse stable focus history without requiring a permanently visible
breadcrumb.

### Traditional view

Traditional view presents the stable project hierarchy:

- Spine and Todos remain fixed;
- Collection order and primary Node containment remain stable;
- the writer expands and collapses Collections, containers, and relationship facets;
- optional confirmed relationship groups can be shown without changing ownership;
- the Navigator remembers expansion, scroll, selection, and relationship visibility.

This is the predictable full-project view and must not rearrange itself merely because
the writer moves the caret.

### Context view

Context view is a persistent contextual projection, analogous to the awareness offered
by a right-click menu but kept visible and navigable. It is influenced by the focused
structural Node rather than every document temporarily opened from that context. It
surfaces:

- the focused Node, its direct parent, direct siblings, and direct children;
- directly related Nodes grouped by Collection;
- applicable Spine material;
- confirmed Todos related to the Spine, selected Node, one or more containers,
  selections, decisions, impacts, or the active fork;
- backlinks, aliases, and other configured relationship facets.

Context view does not create, move, copy, or reorder canonical Nodes or relationships.
It changes only the projection. Derived relevance must be explainable—for example,
`shown because Mara is selected` or `Todo applies to Chapter 1`—and AI-inferred but
unconfirmed relationships remain Inputs rather than Navigator structure.

Opening a structural Node changes the Navigator focus. Opening a Todo or another
supporting document from that neighbourhood does not discard the structural focus.
It must not steal editor focus, jump the Navigator scroll position, or rebuild itself
on every caret movement. Remembered items are keyed by stable identities rather than
display positions, so a renamed or reordered Node remains the same remembered item.

A writer can return to Traditional view at any time without losing its expansion or
scroll state. Context view shows applicable Todos rather than the entire global Todo
list and keeps its own expansion, focus history, scroll, and recent-context memory.
Back and Forward restore earlier structural focuses; they do not mutate containment.
The applicable-Todo section can create a Todo already targeted to the focused Node;
opening that Todo leaves the structural Context visible while its long-form content is
edited centrally.

Example Traditional view:

```text
Spine
Todos
Manuscript
  Chapter 1
    Scene 1
    Scene 2                     3 inputs · 1 todo
    Scene 3
Characters
  Mara
  Edna
Locations
  Hospital
```

Example Context view while Scene 2 is focused:

```text
‹  ›
Focused
  Scene 2
Parent
  Chapter 1
Siblings
  Scene 1
  Scene 3
Related
  Mara
  Edna
  Hospital café
Applicable Todos
  Resolve the transition into the café
```

The neighbourhood control on a visible item reveals that item's direct parent,
siblings, confirmed relationships, and applicable Todos without changing focus.
Structural disclosure independently reveals children. Indirect exploration therefore
grows one explainable hop at a time rather than displaying the whole graph. Every
appearance of Mara remains a projection of the same stable Node.

### Fixed elements and smart views

Every work has a protected central content system called the **Spine**. Its identity
is mandatory and cannot be accidentally deleted. Its data is editable, versioned,
fork-aware, and carried into relevant context assembly. It establishes the work's
scope, direction, narrative contract, and other central knowledge without requiring
every project to use the same internal Collections.

Every work also has a fixed **Todos** element. It remains visible and stable even when
empty because writing continuously creates work to consider, perform, defer, or
resolve. Todos are canonical project records, not AI cards. They can be created by the
writer or adopted from a proposed Input, impact assessment, local check, or import.
They may target the Spine, one or more Nodes or containers, manuscript content, a
decision, or a fork. Every Todo has a durable, editable document for long-form plans,
evidence, alternatives, and notes. Selecting its title opens that content; only its
checkbox changes done/open state. Complex planning is therefore not forced into a
stack of cards or one-line labels.

Spine and Todos are the only fixed Navigator elements. In Traditional view the Spine
is followed by the writer's Collections and the **Add Collection** action, then Todos.
An **Archived/Unowned** recovery area remains at the bottom. Archived material and
material without a primary owner retain distinct domain states even though the UI
groups them in one recovery area.

The Todo model reserves a parent-Todo relationship so nested subtasks can be added
without migration, but nested Todo UI is not required on day one. AI-created tasks are
also outside the first Navigator scope. Provenance and actor/source fields must not
prevent that capability from being introduced deliberately later.

### Structural, Collection, and Todo projections

Traditional view has now proved the intended primary-containment behaviour: a Scene
whose parent is Chapter 1 appears beneath Chapter 1, rather than being duplicated as a
flat child beneath the Scenes Collection. A Collection count is a query over all of
its members regardless of their structural parents. Consequently, a Scenes Collection
with fifteen Scenes beneath Chapter 1 has fifteen members and must never claim that no
Scenes exist merely because it has no directly contained root members.

Todos intentionally differ from structural children. Every Todo remains a canonical
member of the global Todos set, where an initial creation-order projection is
acceptable. The same Todo may also appear in the Context of each Node it directly
targets. Context filtering is exact by default:

- a Todo targeting the Spine does not appear in Chapter 1 Context;
- a Todo targeting Chapter 1 does not appear in Spine Context;
- sibling, ancestor, descendant, or indirectly related Todos are not silently mixed
  into the focused Node's applicable list;
- if broader Todo scope is later useful, it must be an explicit, explainable expansion
  such as **Sibling Todos** or **Inherited Todos**, not an unlabelled relevance guess.

Applicable Todos use the same complete interaction in Context and Traditional
projections: checkbox state, content-opening title, and creation. Opening a Todo edits
its durable content without discarding the current structural focus. The writer must
not have to switch projections merely to complete, reopen, select, or edit a Todo.

Creation and navigation remain separate commands. Creating a Chapter or Collection
should keep the current projection available for repeated creation; it should not
change focus or add a Back/Forward history entry. An explicit **Create and open** action
may be added later. When **Add inside** requires a Collection that does not yet exist,
its chooser should eventually allow that Collection to be created without leaving the
current structural Context.

The Navigator can also expose key derived views, such as:

- recently changed material;
- unresolved impacts;
- detached inputs;
- items changed since review;
- material related to the focused character or location.

These are queries over authoritative state, not additional copies of it.

### Icons and status

Optional icons describe structural presentation only, with neutral choices such as
folder, file, link, Todo, or no icon. They never define or constrain what a Collection
means. A disclosure control independently indicates that a node has children, a move
handle owns reordering gestures, and row selection opens content. The Spine does not
use a diamond merely to indicate that it is selectable; selection is conveyed by the
same row state used everywhere else.

Navigator leaves use one quiet visual grammar rather than separate card treatments:
move handle, disclosure or status control, structural icon, title, and optional count
or scope. The controls do double duty, so every non-obvious icon and action requires a
plain-language tooltip and accessible label.

Transient state belongs in small badges or secondary marks: open work, unresolved
inputs, changed-since-review, active activity, alias, or fork. Dozens of subtly
different icons would replace textual clutter with iconographic clutter and are not
the target.

## Material and Nodes

A **Material type** is a first-class, content-bearing, connectable Navigator Node that
also owns an ordered set of children. `Characters` is a Material type; `Mara` can be
one of its child Nodes. Selecting `Characters` opens its own content while its
independent disclosure control expands or contracts the children. A Material type may
remain useful with no children—for example, one `Location` Material type may hold the
complete location material directly.

Internally, the current compatibility model still calls this a `CollectionDefinition`.
That storage name is behind the facade and is not user-facing: the ordinary UI says
**Material**, **Manage Material**, **Material type**, and **Add Character**. Renaming
the stored interface is unnecessary until a data migration provides real value.
Example Material types include:

- chapter;
- scene;
- character;
- location;
- research source;
- theme;
- timeline event;
- narrative rule;
- arbitrary user-defined material.

Material type definitions need enough information to create and present Nodes without
making the core application understand every literary concept:

```ts
interface CollectionDefinition {
  id: CollectionId;
  name: string;             // explicit plural, e.g. Scenes
  singularName: string;     // explicit editable suggestion, e.g. Scene
  icon?: IconReference;
  numbering?: {
    enabled: boolean;
    start: number;
  };
  capabilities: {
    contentBearing: boolean;
    mayContainChildren: boolean;
  };
  allowedChildCollections: CollectionId[];
  fields: FieldDefinition[];
  relationships: RelationshipDefinition[];
  navigator: NavigatorPresentation;
}
```

This is illustrative, not a frozen TypeScript contract.

Material creation asks for an explicit plural type name and an explicit singular item
name.
Typing the plural may populate a suggested singular value, but the suggestion remains
an ordinary editable field and must not overwrite a manual change. Content-specific
icon presets such as character, scene, or location are prohibited because they would
quietly recreate a fixed ontology.

Collections and child Nodes have stable identities. Optional numbering is derived
from sibling order and the configured start number. It never becomes part of the
identity: moving `Scene 3 — The Visit` before Scene 1 may display it as
`Scene 1 — The Visit` without breaking relationships, Inputs, Todos, history, or
forks. The suffix is an optional user title stored separately from the generated
singular name and number.

The UX needs mechanisms to edit, reorder, move, archive, and eventually clone
Collections and Nodes. A move handle owns drag/reorder behaviour; disclosure and row
selection remain separate controls. Project templates may supply useful initial
Collections without making chapter, scene, or any other literary concept compulsory.

A drag transaction changes ordering or primary containment only. It must preserve the
Node ID, durable content, Collection membership, optional title, relationships, and
Inputs. Dropping near another Collection must never silently convert the Node.
Changing Collection membership requires a future explicit **Move to Collection** or
**Convert** command with its own consequences and confirmation.

Collection management can update its plural and singular names, structural icon, and
numbering. Deleting a Collection deletes the Collection document but moves its child
Nodes to Archived/Unowned rather than erasing their content. The item field uses the
action-oriented prompt **Create new {singular name}**; when numbering is enabled its
name may be left blank because the generated number is sufficient.

Material types are created and edited in one Material Manager modal from
either Navigator view. Traditional and Context are presentation lenses, not separate
capability sets: changing view must never determine whether the writer can create a
Collection. When creation begins within a focused Node, the manager returns the new
Collection to that child-item flow without changing Navigator focus or history.

The manager offers optional **Material sets** as well as custom creation. Each set
has an independent disclosure control and a set checkbox. Selecting the set expands
it and selects all available suggestions; individual suggestions can then be edited
or removed and the parent checkbox shows a partial state. Applying a set creates
ordinary project-owned Material type definitions. It creates no sample content, retains
no live dependency on the set, skips existing names, and remains fully editable.
Initial sets cover Core story, Story planning, Story world, and Research. Scene Beats
are an optional numbered Collection in Story planning: a Beat describes intended
story action, while a Todo describes work the writer intends to perform. Containment
may place Beat Nodes under Scenes, but the set does not impose that relationship.

A project with no Material types proactively opens the manager once for that empty
state, offering sets or custom creation. Dismissing the invitation is valid; the same
manager remains available later from either Navigator view.

Selecting the Todos heading opens source-maintained instructions while selecting an
individual Todo opens its durable content in the editor. A future consolidated view
over Todo records may still use the editor, a modal, or a split pane; the data and
command model does not assume that later presentation.

### Writing relationship vocabulary and manager

Relationship management uses a dedicated modal following the Material Manager
pattern. It is available from Traditional view and from **Add… → Relationship** in
Context. Definitions and confirmed links are project-owned Svelte state persisted
through the workspace facade. Containment remains separate, endpoints are stable
Nodes, a confirmed edge is stored once and projected from either end, and unconfirmed
AI proposals remain Inputs.

The first editable writing relationship sets are:

- **Narrative essentials** — participation, viewpoint, setting, causality,
  revelation, setup, and payoff;
- **Character knowledge and change** — knowledge, belief, desire, fear, memory,
  and scoped states;
- **Story world** — ownership, membership, location, use, opposition, alliance,
  and family;
- **Argument and evidence** — claims, support, challenge, refutation,
  qualification, examples, definitions, and dependency;
- **Research** — citation, quotation, provenance, corroboration, dispute,
  verification, investigation, and synthesis;
- **Non-fiction** — introduction, explanation, context, comparison, contrast,
  case studies, summaries, and development.

Installing a set creates ordinary editable relationship definitions. It creates no
links, Nodes, sample content, or lasting template dependency. Writers can edit the
forward label, inverse label, symmetry, and guidance before installation, create a
custom definition, or later edit and delete installed vocabulary. Deleting a
definition preserves existing links and their labels rather than silently deleting
writing knowledge.

The Laravel Eloquent analogy is useful for defining comprehensible relationships:

- one-to-one;
- one-to-many;
- many-to-one / belongs-to;
- many-to-many;
- ordered containment;
- alias/reference;
- applies-to a target set;
- derived-from or supersedes;
- generated-by or resolves.

Each ordinary Node has at most one primary structural parent. Primary containment is
acyclic and determines the normal hierarchy. A Node may also have unlimited typed
relationships and aliases elsewhere, and those cross-links may be circular.

Moving a primary Node changes containment. Moving or removing an alias changes only
that relationship or its view ordering; it never deletes the target Node. Deleting a
parent with children requires an explicit choice to delete descendants, rehome them,
or cancel. These rules belong to the domain reducer, not a Svelte component.

A relationship definition currently records its forward label, inverse label,
symmetry, writer/AI guidance, and project ordering. It is a reusable project-level
function, not intrinsically a Character-to-Chapter rule. Source/target restrictions,
cardinality, favourites, and usage-based ranking remain possible later additions; the
current implementation does not invent or enforce them. The Navigator shows only
direct, confirmed relationships. AI-inferred relationships remain Inputs until
explicitly accepted.

Relationship creation does not ask the writer to invent two directional phrases in
free-text fields. Once two Nodes have been chosen, a single **Relationship** dropdown
offers both readable orientations of the installed project vocabulary. It does not
hide a relationship because the selected Nodes belong to an unexpected pair of
Collections. Each option is presented as a readable sentence in the current
orientation, for example:

```text
Claire appears in Chapter 1
```

Selecting it derives and previews both stored directions:

```text
Claire appears in Chapter 1
Chapter 1 features Claire
```

Reversing the order in which the Nodes were selected reverses the presentation, not
the meaning of the relationship. The forward and inverse labels belong to the
relationship definition and are never accidental prefilled values. If no suitable
definition exists, **Create relationship type…** opens a separate definition flow;
ordinary linking does not fall back to arbitrary typed words. Symmetric definitions
such as `is allied with` use the same label in both directions. Structural
containment remains a separate command and is not offered as an ordinary relationship
shortcut.

The same pair of Nodes may have several distinct functional relationships. These are
not reducible to one generic Character appearance:

```text
Claire is present at Location 1
Claire appears in Chapter 1
Claire is referenced obliquely in Chapter 1
Claire dies in Scene 1
```

Likewise, `appears in`, `is referenced in`, `occurs in`, `supports`, `applies to`, and
`contradicts` can be useful across many different Material and container kinds. A
relationship may carry a writer-readable note when its selected type is not enough.
The first UI does not expose a second **Applies during** scope: the writer links the
relevant Material directly, or promotes a complex temporal fact into its own
content-bearing Material item. The persistence reader retains legacy scope data so an
older project is not damaged, but new relationship creation does not require or
encourage it.

An edge is appropriate while the fact only needs two endpoints and small qualifiers.
When a fact needs its own prose, chronology, participants, evidence, consequences, or
relationships, it becomes a content-bearing Node. `Claire dies in Scene 1` may begin
as a direct relationship; a detailed **Death of Claire** Event Node could later relate
to Claire, Scene 1, its cause, witnesses, and resulting Todos. This promotion must
preserve provenance rather than creating an unrelated duplicate fact.

### Graph underneath, focused views above

The domain graph can be circular; a complete visible mind map should not be the normal
interface. Everything in a novel may eventually relate to everything else, making an
unfiltered graph technically accurate and practically useless.

The writer instead sees purpose-specific graph projections:

- containment and selected aliases in the Navigator;
- immediate relationships in the Navigator or central detail view;
- changing character or Spine states in a timeline;
- backlinks and appearances;
- smart collections and prioritised Todo views;
- an editorial history or local relationship neighbourhood.

Typed edges such as `contains`, `features`, `occurs_at`, `applies_to`, `contradicts`,
`foreshadows`, `derived_from`, `proposes_change_to`, `resolves`, and `supersedes` are
more useful than an unconstrained `related_to` edge. A domain graph does not require a
graph database; ordinary records and indexes may remain behind the facade.

## Selecting and opening related material

The initial interaction direction is:

- selecting a structural document opens it in the focused central pane;
- selecting a projected relationship child such as Mara selects that stable node;
- opening the projected child displays it fully in the focused central pane or a new
  split;
- selecting a collapsed content-bearing container such as Chapter 1 expands it and
  shows that container's own content in the focused central pane;
- selecting a structural Node enters its Context projection automatically;
- back/forward focus history returns to the previous structural location;
- opening a Todo from that Context changes the editor document but retains the
  structural focus;
- opening related content does not repurpose the right-side Inputs/review panel.

The central split workspace is the preferred way to keep the manuscript and detailed
reference visible together. The broad selection behaviour above is provisional; exact
single-click, double-click, modifier, touch, and keyboard gestures are deferred until
the basic Navigator and pane manager can be tested.

## Inputs and review panel

The current margin notes are an early form of Input card, not the final review model.
The right panel is reserved for human, AI, local-check, and system Inputs associated
with the focused content or selection. It should eventually support:

- collapsible cards;
- drag-and-drop card ordering;
- filters appropriate to the current node, selection, source, kind, and state;
- persistent user ordering where ordering is meaningful;
- clear distinction between an Input proposal and an adopted project change.

AI may reference the Spine, Todos, Collection Nodes, relationships, manuscript, and
active fork. AI definitions, recipes, chats, runs, and generated cards do not belong
in the Navigator. An Input may propose a Todo or a change to the Spine, a Node, a
relationship, or the manuscript; only an explicit adoption transaction changes that
authoritative project state.

Input data remains in Svelte-owned domain records; card order and collapse state are
view state, not a second copy of the content.

The POC now uses one Inputs panel rather than separate Margin and Tray modes. Every
replacement card has an explicit accept tick and one drag grip. Pointer dragging
reorders cards using visible insertion marks; focusing the grip and pressing Arrow Up
or Arrow Down provides the same operation without a pointer. Reordering is an
undoable, facade-persisted Svelte domain transaction.

The Inputs panel also owns the current review workflow. **Review document** creates
one Svelte-owned craft activity even though the facade may receive one request per
passage. The panel reports aggregate progress, returned Input count, and unrecovered
errors. Source **Use** state controls participation in future requests; source
**Show**, category, and density controls are independent projections over Inputs that
already exist. Provider configuration, masked provider identity, session spend, and
historical Input management are reachable from the same panel. The removed
full-width filter strip and manuscript Sources footer must not return.

The first slice deliberately reviews only the current document with the existing
sentinel instruction. Recipe selection, arbitrary graph scope, automatic context
assembly, and coordinated multi-pass review remain later AI-system decisions.

Dismissal remains unresolved. The preferred direction is that dismissing a durable
card changes an explicit state through the transaction and undo system, and that a
dismissed/archived view can recover it. Dismissing a transient error notice need not
create durable project history. `dismiss`, `resolve`, `archive`, and `delete` must not
become interchangeable verbs.

## Resolved context without repeated data

Selecting a scene should not reveal copied character and location descriptions from
every preceding chapter. The system resolves applicable context through scope and
relationships:

```text
Scene 2
  → features Mara
  → features Edna
  → occurs at Hospital café
  → inherits Chapter 1 narrative rules
  → has two direct inputs
  → is affected by one project-level change
```

The central detail view should make origin visible:

- directly attached to this node;
- inherited from an ancestor scope;
- applicable project-wide;
- derived from a confirmed relationship;
- suggested by AI but not confirmed;
- inherited from the active fork.

Information should be attached at the highest correct scope, with explicit local
overrides. A `TargetSet` may cover one passage, one node, a range, a list such as
scenes 1–3 plus 5 and 8, a subtree, or the whole work.

## Change-aware work management

A writing project can be understood as:

- artifacts: premise, characters, plans, scenes, manuscript, and research;
- decisions: central choices about what the work is becoming;
- dependencies: material relying on those decisions;
- outstanding work: the gap between current material and current intent.

The Snowflake Method is useful evidence for progressive elaboration—idea, premise,
summary, characters, expanded plan, scenes, manuscript—but must remain an optional
template, not a mandated workflow.

When a central fact changes, the system records three distinct things:

1. **Change event:** what the writer changed or decided.
2. **Impact:** material that may now be inconsistent or incomplete.
3. **Work item:** an impact the writer accepts as requiring attention.

For example, changing Geoffrey into a woman named Edna retains the stable character
identity unless the writer is deliberately creating an alternative entity. It can
produce a grouped impact assessment over canon, plans, prose, relationships, and
supporting material. AI may discover semantic consequences that text search misses,
but it must not automatically rewrite the manuscript or flood the work list with
every speculative impact.

Impact decisions may include `add to work`, `already consistent`, `not relevant`,
`defer`, or `needs discussion`. Consequences of one change should remain grouped
rather than appearing as dozens of unrelated todos.

Undoing a canonical change must coherently withdraw or archive its generated impacts
and unfinished work in the same domain transaction. Loose checklist text with no
originating change cannot satisfy this requirement.

## Forks and lineage

Margin Note must support both:

- **content forks**, such as an alternative version of Scene 2;
- **work forks**, such as reconceiving Geoffrey as Edna and changing the downstream
  Spine, relationships, work, and manuscript material.

The active fork defines which nodes, relations, Spine state, impacts, and Todos
are active. Superseded Geoffrey material remains available through history or the
alternate fork; it must not pollute Edna's active relationships and task list. A
concise fork/change summary may be more useful than exposing every obsolete artifact.

Fork storage may share unchanged records internally, but the UX must make lineage and
the active view unambiguous. Comparison and restoration are explicit activities; old
branches do not sit throughout the normal Navigator.

A logical Node retains its identity across forks. Unchanged Node and relationship
state is inherited; editing on a fork creates fork-specific state without changing the
logical identity. The Spine, Todos, Collections, relationships, and manuscript are all
fork-aware. Each central pane carries its own `forkId`, and the focused pane selects
the active Navigator projection.

## Split content views

The central workspace uses a terminal-style split tree. It may divide panes
horizontally or vertically, recursively, and may show different Nodes or forks from
the same work. Each pane owns a view context, not an independent source of truth:

```ts
interface PaneViewContext {
  paneId: PaneId;
  workId: WorkId;
  forkId: ForkId;
  nodeId: NodeId;
  viewKind: string;
  navigator: PaneNavigatorMemory;
  history: PaneLocationHistory;
}

type NavigatorMode = 'traditional' | 'context';

interface NavigatorViewMemory {
  expandedKeys: string[];
  selectedKey?: string;
  scrollAnchorKey?: string;
}

interface PaneNavigatorMemory {
  mode: NavigatorMode;
  traditional: NavigatorViewMemory;
  context: NavigatorViewMemory & {
    recentContextKeys: string[];
  };
}
```

The focused pane determines:

- which fork the Navigator projects;
- which item is selected;
- which relationships are expanded or relevant;
- what the Inputs and review panel displays;
- where commands apply.

Focusing a pane showing another fork therefore changes the Navigator to that fork.
The pane header, Navigator, and panel must show the active fork clearly enough to
prevent editing the wrong lineage. Each pane remembers the Navigator expansion,
Traditional/Context mode and its independent view memory, selected Node, and location
history needed to restore its working context when focus returns. A possible Navigator
pin/lock and cross-fork drag behaviour remain open questions. Exact pane and Navigator
gestures are deferred.

Multiple panes are projections over one Svelte workspace aggregate. They must not
create competing document stores or permit ProseMirror instances to become separate
authorities.

## Durable material versus attached activity

Not every stored object belongs in the Navigator.

- **Navigator:** the Spine, Todos, and durable Collection material the writer
  recognises as part of the work.
- **Relationship projection:** useful aliases and summary groups.
- **Central workspace:** manuscript, detailed Navigator records, Todo management,
  forks, versions, and reference views.
- **Inputs and review panel:** attached human, AI, local-check, and system editorial
  activity.
- **Todos:** canonical unresolved work across the active fork.
- **History:** transactions, superseded material, and branch lineage.

No AI run, chat message, lint, or suggestion becomes a Navigator child merely because
it exists. Important material can be explicitly adopted as a Todo, Spine change,
Collection Node, relationship, manuscript transaction, or durable note. Badges and
smart views summarise attached activity without overwhelming the structure.

## Settings implied by this direction

The settings model eventually needs coherent sections rather than controls scattered
around the writing surface:

- Spine and project template;
- Collection definitions, fields, relationships, icons, and Navigator presentation;
- Navigator Traditional/Context mode and per-view memory preferences;
- Input-card ordering, filtering, and visibility;
- split-pane and focused-fork behaviour;
- formatting and editor preferences;
- AI provider and model configuration;
- AI action definitions and automatic checks;
- shortcuts, export, and advanced diagnostics.

Provider configuration and craft execution are different actions and should not be
placed together merely because both involve AI.

## Parked but required design work

The following are deliberately recorded without being prematurely solved. Integrated
AI review design is postponed until the Spine, Todos, Collection store, graph, and
Navigator structure have been proved.

### Recipes and AI actions

- where recipes and AI actions live outside the Navigator;
- how writers create, share, reorder, enable, and scope recipes;
- whether current fixed buttons become pinned configurable actions;
- how an action declares both what it may change and what it must preserve;
- how all AI requests inherit the active narrative contract, Spine,
  relevant relationships, existing concerns, and writer instruction;
- how conflicting actions such as cadence and distance avoid undoing each other's
  constraints;
- how custom requests, recent requests, named actions, and open-ended chat coexist;
- how local checks, replay/test sources, and paid providers appear without exposing
  developer machinery in the normal writer interface.

### Inputs, lints, suggestions, and chat

- whether these are different Input kinds, states/components of one editorial thread,
  or a mixture of both;
- how one observation can become discussion, alternatives, accepted work, a human
  edit, and resolution without losing provenance;
- which objects appear as Input cards or badges and which can be explicitly adopted
  into authoritative Navigator material;
- how duplicate or semantically overlapping findings are consolidated;
- how work is prioritised globally and filtered to the selected node;
- how an edit suggests that work may be complete without AI resolving it silently;
- card dismissal, archival, recovery, and undo semantics;
- conversation scope, lifetime, context selection, and promotion to durable notes.

### Input categories, filters, and provider sources

- review whether categories such as point of view, tense, canon, cadence, diction, and
  distance should remain fixed application categories, become project-defined
  categories, or form an immutable core extended by project-owned categories;
- define category identity, ordering, colour/icon presentation, migration, prompt
  association, and behaviour when a project category is renamed or removed;
- redesign the Filters summary only after that category model is settled. Do not count
  every hidden category or source as though each were an independently meaningful
  filter; the summary must communicate the filters actually in use;
- replace the fixed provider catalogue with settings-backed, named AI sources while
  retaining local checks and deterministic replay as development/test sources;
- add direct OpenAI and direct Anthropic sources;
- add configurable OpenAI-compatible and Anthropic-compatible sources, including
  endpoint URL, model ID, credential reference, and a writer-defined display name;
- allow more than one configured source using either compatible protocol without
  hard-coding another Inputs-panel button for every provider;
- expose configured sources consistently to review participation, selection actions,
  provenance, status, spend, and historical-Input filtering while preserving the
  existing separation between **Use** for future calls and **Show** for returned
  Inputs;
- retain credentials behind the server/settings facade and add adapter contract,
  malformed-output recovery, retry, and compatibility tests before calling any new
  source implementation complete.

### Collection and graph rules

- future user-authored, imported, or project-specific Collection sets beyond the
  built-in editable suggestions;
- safe evolution of Collection fields and relationship definitions;
- aliases, symbolic-link equivalents, and additional smart Collections;
- which graph details are user-authored, inferred, or AI-proposed;
- how relationship confirmation and contradiction are represented;
- whether and how a local graph visualisation is useful;
- what selecting a Collection heading opens: its editable content, an all-member
  Collection projection, or a combined view;
- if an all-member Collection projection is adopted, whether members are grouped by
  structural parent, manually ordered, structurally ordered, alphabetised, or offered
  several remembered orderings;
- what selecting the fixed Todos heading opens and how an all-Todo view orders work:
  creation order, manual order, priority, status, structural target, or configurable
  saved views;
- whether sibling or inherited Todos are useful as explicit optional Context groups.
- the relationship model itself: which behaviours require fixed programmable
  semantics, which meaning belongs in writer/AI-readable text, whether cardinality is
  useful to writers, and how the interface avoids both a rigid ontology and arbitrary
  statements that only AI can interpret.

### Navigator contextual header

- determine whether the project name should disappear from the Navigator in
  Traditional view and become a genuinely useful contextual label, path, or scope
  indicator in Context view; do not keep duplicate project chrome merely for symmetry.

### Fork and split-view rules

- whether Navigator view state follows focus immediately or can be pinned;
- how two forks are identified visually without dominating the interface;
- whether content can be dragged or copied across fork views;
- exact click, double-click, modifier, touch, keyboard, and pane-split gestures;
- how comparisons, promotion, and selective adoption work;
- what belongs in a concise fork summary;
- how fork-aware undo, redo, history, and background AI activity behave.

## Fresh-start POC

The Navigator proof of concept starts with no static or generated manuscript,
Collections, Nodes, Inputs, cards, or demonstration content. It does not migrate the
current POC sample into the new workspace.

A new project initially contains only:

- the protected, editable Spine;
- the protected, editable Todos document and its empty Todo-record view;
- the project and workspace state required to create Collections and Nodes.

Existing projects are repaired on open rather than seeded with guessed material:
missing Spine, Todos, or content-bearing Collection documents are materialised from
their canonical roles and Collection definitions. The fixed Spine and Todos names are
restored if older code allowed either identity to be renamed. The user may explicitly
choose **Start over** by typing the project name; this clears that project's documents,
Collections, Todo records, Inputs, formats, and context, then recreates only empty
Spine and Todos documents. Migration never performs this destructive reset silently.

Existing tests and implementation evidence remain valuable for the editor reducer,
targets, formats, Inputs, persistence, and undo/redo, but the visible demo content is
removed. Tests must create explicit fixtures rather than relying on application seed
data.

## Next proof-of-concept boundary

### Implemented vertical slice

The first Navigator POC now proves:

- a fresh project starts with an empty, protected Spine and empty Todos rather than
  generated manuscript or context content;
- Spine and Todos have protected names but editable, durable content, and legacy
  projects repair missing or misnamed fixed documents when opened;
- project-defined Collections are themselves content-bearing, selectable Nodes and
  are persisted with their children through the workspace facade;
- a Node may contain child Nodes while retaining its own editable content;
- plural/singular naming, structural icons, optional numbering, optional titles, move
  handles, stable-identity reordering, and derived renumbering are implemented;
- confirmed typed relationships are stored once and projected with inverse labels;
- canonical Todos can target one or more Nodes, with `parentTodoId` reserved for later
  nested-task UI, and every Todo title opens its own durable content document while
  its checkbox alone controls state;
- Traditional and Context views keep independent expansion and selection memory;
- opening a structural Node enters Context automatically and records Back/Forward
  focus history, while opening a Todo retains the current structural focus;
- Context view keeps compact ancestor and previous/next-sibling navigation, then
  presents the Selected Node followed by its indented Material, Todos, and direct
  relationships without mutating the graph;
- applicable Todos can be created and opened from Context without replacing its
  structural focus;
- Context and Traditional Todo projections use the same open/complete controls and
  exact target filtering;
- creating Collections or top-level items does not change focus or enter location
  history, supporting repeated creation;
- Context can create a missing Collection in place and immediately select it as the
  new child type;
- a Collection whose members are structurally nested elsewhere reports that member
  count instead of claiming it is empty;
- the Selected-row disclosure expands a bounded cascade beneath each direct Material
  child; each child can independently reveal up to three of its own Material items,
  Todos, and relationships without repeating already-visible entries or changing
  selection;
- Navigator drag transactions preserve Node identity, Collection membership, optional
  title, and content; a horizontal insertion marker means **before**, a highlighted
  indented row means **inside**, and cross-Collection ordering drops are refused
  rather than converted;
- Context uses one bottom **Add…** gate for Material, Todos, or relationships;
  its removal mode selects any mixture of those entries, confirms once, and archives
  Material subtrees, deletes selected Todos, or unlinks selected relationships;
- Navigator-owned structural changes, including creation, editing, deletion,
  reordering, reparenting, Todo state, relationship changes, and mixed removals, enter
  a separate named Svelte transaction stack. Navigator Undo/Redo restores both the
  canonical Svelte graph and facade-persisted documents; view changes and disclosures
  are deliberately not work history;
- selecting any structural or related Node opens its one durable document in the
  existing editor and Input workflow.
- Material, Todos, and Archived/Unowned headings open concise instructions kept as
  editable HTML source under `src/lib/content/navigator/` rather than inline UI text;
- Material types can be edited or deleted; deleted items are recovered
  under Archived/Unowned, while an explicit project-name-confirmed Start over action
  provides a genuinely clean project when that is what the writer chooses.
- Material creation and editing use one modal available from both Navigator views;
  fresh projects proactively offer editable Material sets, set selection supports
  all/partial states, and applying a set creates only ordinary Material type definitions
  without generated content or lasting template linkage;
- Relationship management uses its own modal from either Navigator view; relationship
  creation appears first, six editable writing sets install project-owned definitions
  without creating links, and actual links support both readable directions,
  explanatory notes, safe unlinking, and Navigator Undo/Redo;

The current persistence adapter stores Collection definitions, relationships, and
Todos in the project's Navigator extension while content-bearing Nodes use durable
workspace documents. This is deliberately behind the facade and is not a commitment
to that storage representation.

Still deferred from this first slice are Collection cloning, explicit restoration UI,
multi-target Todo editing UI, relationship cardinality and endpoint hints, impact
cascades, fork-aware graph variance, and the terminal-style multi-pane manager.
Existing AI review and Input behaviour remains available but has not yet been
redesigned around Navigator context.

### Current workbench layout proof

The single-pane workbench now establishes the layout contract that the future pane
manager must preserve:

- the workbench is fixed to every edge of the visual viewport, cannot inherit a
  smaller or rounded parent container, and has no manuscript maximum width;
- the Navigator is an independently hideable pane, resizable from 250 pixels up to
  half the viewport, with its width and visibility remembered locally;
- the central document column owns vertical scrolling. Its sticky pane header names
  the active document, reports words/version/save state, exposes writing Undo/Redo
  and view-only zoom, and keeps secondary document actions in one overflow menu;
- project switching, creation, renaming, and Start over belong to the Navigator header
  rather than being repeated as manuscript controls;
- editor zoom changes only the local projection of prose, is remembered locally, and
  never creates document formatting or a work transaction;
- the right-side Inputs/review pane is independently hideable and always occupies the
  hard-right edge when visible; hiding it returns that width to the central workspace;
- the Navigator, central document column, and Inputs/review pane each own an independent
  overflow surface and remain pinned to the full available browser height;
- Inputs begin at the top of their own pane and do not inherit or mirror the
  manuscript's scroll position;
- pane visibility controls live at the far right of the application header, separate
  from project content and the Navigator transaction history.

These presentation preferences are Svelte-owned local UI state, not project graph
data and not facade-owned document content. Future horizontal and vertical editor
splits must divide the reclaimed central workspace rather than reintroduce a fixed
document width.

The next implementation boundary should build on this proven slice without attempting
recipes, collaboration, or a complete literary ontology:

1. Exercise and amend the initial writing relationship sets with real projects before
   adding cardinality, endpoint hints, favourites, or automated AI proposals.
2. Add explicit Archived/Unowned restoration and intentional Collection conversion
   commands without weakening stable Node identity.
3. Add the basic terminal-style pane manager with horizontal and vertical splits,
   focused-pane context, and per-pane Navigator/location memory; defer final gestures.
4. Keep the right panel reserved for existing Input behaviour.
5. Keep the existing manuscript transaction, target, format, Input, and undo paths
   authoritative while removing no proven behaviour.
6. Define the first smart work view only after Collection, Todo, and relationship
   selection behaviour is settled.

Full split-fork interaction, recipe redesign, AI orchestration, and a complete Input
card system should remain documented seams until this slice proves that the
structural and graph projections are usable.

## Success criteria

The next slice succeeds when:

- the writer can understand where they are without decoding the current POC toolbar;
- a node can have content and children;
- the project can define a new Material type without application code changes;
- a related character appears beneath a scene as an alias, not duplicated data;
- Traditional view remains stable while Context view responds to the focused pane and
  selection without mutating the graph;
- switching views or panes restores the relevant Navigator expansion, scroll,
  selection, and recent-context memory;
- the protected Spine is always present but editable;
- the fixed Todos view exposes canonical, targetable work independently of Inputs;
- opening an alias displays the one stable related node in the central workspace;
- horizontal and vertical panes retain their Node, fork, Navigator, and location
  context when focus changes;
- a fresh project contains no static/generated demonstration content;
- all authoritative mutations remain in Svelte Rune state and pass through the
  domain transaction path;
- ProseMirror, Yjs, IndexedDB, SQLite, and UI cards remain projections or adapters,
  not competing sources of truth.
