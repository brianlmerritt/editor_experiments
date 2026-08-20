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
- category filters, density, Margin and Tray views;
- project, document, rename, fork, export, word count, undo/redo, and formatting
  controls in one document strip;
- fixed Heighten, Vary cadence, More distant, Synonyms, Strikethrough, and custom
  selection actions;
- local craft, replay, OpenRouter, and Ollama source cards;
- provider settings, craft-pass execution, and keyboard legends.

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
changes. A named view switch chooses between **Traditional** and **Context** views.

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
pane and what is selected there. It may surface:

- the selected Node and its structural ancestors and children;
- directly related Nodes grouped by Collection;
- applicable Spine material;
- confirmed Todos related to the Spine, selected Node, one or more containers,
  selections, decisions, impacts, or the active fork;
- backlinks, aliases, and other configured relationship facets.

Context view does not create, move, copy, or reorder canonical Nodes or relationships.
It changes only the projection. Derived relevance must be explainable—for example,
`shown because Mara is selected` or `Todo applies to Chapter 1`—and AI-inferred but
unconfirmed relationships remain Inputs rather than Navigator structure.

Context is driven by meaningful selection state: the focused Node, an explicitly
selected text target, Todo, Input target, or relationship. It must not steal editor
focus, jump the Navigator scroll position, or rebuild itself on every caret movement.
Remembered items are keyed by stable identities rather than display positions, so a
renamed or reordered Node remains the same remembered item.

Spine and Todos remain available in both views. A writer can return to Traditional
view at any time without losing its expansion or scroll state. Context view keeps its
own expansion, scroll, and recent-context memory so switching views or focused panes
does not reset the working arrangement.

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

Example Context view while Scene 2 is selected:

```text
Spine
Todos
Manuscript
  Chapter 1
    Scene 1
  ▾ Scene 2                     3 inputs · 1 todo
      Characters (2)
        ↗ Mara
        ↗ Edna
      Location
        ↗ Hospital café
      Work (1)
      Variants (1)
    Scene 3
Characters
  Mara
  Edna
```

`↗ Mara` is an alias/projection of the same Mara node, not copied character data.
Renaming or changing Mara updates one stable entity.

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
decision, or a fork.

Spine and Todos are the only fixed Navigator elements. Manuscript, Chapters, Scenes,
Research, Characters, References, and other structures are Collections supplied by a
template or created by the writer.

The Todo model reserves a parent-Todo relationship so nested subtasks can be added
without migration, but nested Todo UI is not required on day one. AI-created tasks are
also outside the first Navigator scope. Provenance and actor/source fields must not
prevent that capability from being introduced deliberately later.

The Navigator can also expose key derived views, such as:

- recently changed material;
- unresolved impacts;
- detached inputs;
- items changed since review;
- material related to the focused character or location.

These are queries over authoritative state, not additional copies of it.

### Icons and status

Icons should distinguish a restrained set of broad material types, such as text,
character, location, research, Spine, Todo, and smart collection. A disclosure
control independently indicates that a node has children.

Transient state belongs in small badges or secondary marks: open work, unresolved
inputs, changed-since-review, active activity, alias, or fork. Dozens of subtly
different icons would replace textual clutter with iconographic clutter and are not
the target.

## Collections and Nodes

A **Collection** is a project-defined category and generated Navigator heading. A
**Node** is an individual member of a Collection. `Characters` is a Collection;
`Mara` is a Node. The Collection heading is not itself content-bearing. An overview
that needs content is represented by a Node or by the Spine.

Internally, a `CollectionDefinition` stores the Collection's configuration. This
technical term is not required in the ordinary UI, which can say **New Collection**,
**Manage Collection**, and **Add Character**. Example Collections include:

- chapter;
- scene;
- character;
- location;
- research source;
- theme;
- timeline event;
- narrative rule;
- arbitrary user-defined material.

Collection definitions need enough information to create and present Nodes without
making the core application understand every literary concept:

```ts
interface CollectionDefinition {
  id: CollectionId;
  name: string;
  itemName: string;
  icon?: IconReference;
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

The UX needs a mechanism to create, edit, reorder, hide, and possibly clone
Collections. Project templates may supply useful initial Collections without making
`chapter` and `scene` mandatory architecture.

A Collection heading is a generated projection of its Nodes. A Node may be
content-bearing, may contain child Nodes, and may appear under a structural parent
without requiring its Collection heading to appear at that location. For example,
Scene Nodes can appear beneath Chapter 1 while still using the `Scenes` Collection
definition.

### Relationship vocabulary

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

A relationship definition records its name and inverse name, permitted source and
destination Collections, cardinality, Navigator visibility, group label, ordering,
optional scope data, and deletion behaviour. The initial Navigator shows only direct,
confirmed relationships. AI-inferred relationships remain Inputs until explicitly
accepted.

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
- back/forward location history returns to the previous manuscript location;
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

### Collection and graph rules

- the detailed Collection creation and editing flow;
- default Collection templates for different forms of work;
- safe evolution of Collection fields and relationship definitions;
- aliases, symbolic-link equivalents, and additional smart Collections;
- which graph details are user-authored, inferred, or AI-proposed;
- how relationship confirmation and contradiction are represented;
- whether and how a local graph visualisation is useful.

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
- the fixed, empty Todos view;
- the project and workspace state required to create Collections and Nodes.

Existing tests and implementation evidence remain valuable for the editor reducer,
targets, formats, Inputs, persistence, and undo/redo, but the visible demo content is
removed. Tests must create explicit fixtures rather than relying on application seed
data.

## Next proof-of-concept boundary

The next implementation should test the smallest vertical slice that proves the
Navigator direction without attempting recipes, collaboration, or a complete literary
ontology:

1. Add the protected, editable Spine, canonical Todo records, Svelte-owned Collection
   definitions, stable Nodes, and typed containment/relationship edges.
2. Render a collapsible structural Navigator with fixed Spine and Todos elements for
   one work and active fork.
3. Add the Traditional/Context switch with independent remembered expansion, scroll,
   and selection state. Context view surfaces explainable aliases and applicable Todos
   for a small number of configured relationship types.
4. Open structural and related items in the centre. Selecting a collapsed container
   expands it and shows its own content.
5. Add the basic terminal-style pane manager with horizontal and vertical splits,
   focused-pane context, and per-pane Navigator/location memory; defer final gestures.
6. Keep the right panel reserved for existing Input behaviour.
7. Keep the existing manuscript transaction, target, format, Input, and undo paths
   authoritative while removing no proven behaviour.
8. Demonstrate one content-bearing parent Node, one user-created Collection, one
   many-to-many relationship, and one smart work view.
9. Verify Navigator moves, relationship edits, Spine edits, Todo lifecycle changes,
   and protected-node rules enter the Svelte transaction system and survive facade
   persistence.
10. Start the visible workspace without seeded content; tests create their own
    fixtures.

Full split-fork interaction, recipe redesign, AI orchestration, and a complete Input
card system should remain documented seams until this slice proves that the
structural and graph projections are usable.

## Success criteria

The next slice succeeds when:

- the writer can understand where they are without decoding the current POC toolbar;
- a node can have content and children;
- the project can define a new Collection without application code changes;
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
