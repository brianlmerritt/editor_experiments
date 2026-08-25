# AI interaction boundary

This document defines the design boundary for AI interaction in Margin Note. It
refines the source-of-truth rules in [ARCHITECTURE.md](./ARCHITECTURE.md), the service
boundary in [FACADE_V1.md](./FACADE_V1.md), and the Navigator/Inputs separation in
[NAVIGATION.md](./NAVIGATION.md).

This is a **Phase 1 design contract**, not a claim that the complete AI system is
implemented. The existing craft pass is evidence for parts of the flow. New AI work
must follow this boundary rather than expanding the current POC shortcuts.

## Purpose

Margin Note should let a writer ask AI to review, discuss, draft, or propose changes
without giving a provider authority over the work. The boundary must support:

- writer-adjustable Writing Context assembled from the Spine, Material, confirmed
  relationships, Todos, manuscript, active fork, and current selection;
- configurable AI actions and free-form instructions without filling the editor with
  permanent one-purpose buttons;
- coordinated requests that preserve all applicable writing constraints rather than
  making cadence, distance, point of view, and other concerns fight independently;
- existing-work assimilation that can use a manuscript, editorial reviews, and the
  current project vocabulary to propose project structure without claiming authority;
- local checks, one or more AI providers, and later compatible-provider adapters;
- delayed, malformed, duplicated, partial, cancelled, and failed responses;
- explicit human adoption of every proposed change;
- complete provenance, cost, request, response, and context evidence.

It must not introduce a separate drafting mode. Writing, reviewing, revising, and
asking questions remain one continuous editor workflow. An AI **interaction intent**
belongs to one request; it is not a global application mode.

## Non-negotiable authority rule

Svelte 5 Rune workspace state owns:

- the current manuscript and rich document;
- the Spine, Material Nodes, relationships, Todos, forks, and versions;
- ContentTargets, formats, Inputs, and attachment behaviour;
- the writer's current selection and chosen Writing Context;
- AI action definitions made active for a request;
- request intent, run lifecycle, cancellation, and aggregate activity state;
- returned Input records and their provenance;
- acceptance, rejection, adoption, undo, redo, and invalidation.

The editor, prompt assembler, AI provider, HTTP route, facade, Yjs, IndexedDB, and
SQLite do not own any of those things. They render, transport, execute, mirror, or
persist Svelte-owned state.

An AI provider can return only **untrusted proposals**. It can never directly:

- replace or insert manuscript text;
- change formatting;
- edit the Spine or Material;
- create, complete, or reprioritise a canonical Todo;
- create or remove a confirmed relationship;
- change the active fork or version;
- resolve or dismiss an Input;
- alter Writing Context for later requests.

Every accepted effect is a normal Svelte workspace transaction with ordinary
validation, persistence, provenance, and undo/redo.

## Responsibility split

```text
Writer / UI
  chooses target, intent, action, instruction, sources and visible Writing Context
        |
        v
WorkspaceState                                               LIVE AUTHORITY
  validates the command
  captures targets, revisions and exact source content
  resolves eligible project context
  creates the activity and run records
        |
        v
AI interaction service boundary                              NO DOMAIN AUTHORITY
  applies the action template and output contract
  budgets and serialises the supplied context
  calls configured provider adapters
  repairs, validates and normalises provider output
        |
        v
WorkspaceState                                               LIVE AUTHORITY
  records the exact sent-context manifest and diagnostics
  rejects stale or unsafe proposals
  consolidates eligible duplicates
  creates durable Inputs
        |
        v
Writer accepts, rejects, discusses or adopts
        |
        v
Workspace transaction -> facade persistence -> editor projection
```

The browser does not call a provider directly. Raw credentials remain behind the
server/settings boundary. Provider adapters receive a fully bounded request; they do
not query the workspace, Navigator, database, or editor for additional context.

The existing `WorkspaceFacade.requestInputs` may transport requests during the POC,
but callers should depend conceptually on a narrow `AIInteractionService`. Generation
transport must not expand the persistence facade into a second workspace domain.

## Core terms

### AI action

A versioned, user-manageable definition of a repeatable operation. It describes:

- name and interaction intent;
- instruction template;
- accepted target and scope kinds;
- context requirements and optional context groups;
- constraints that must be preserved;
- permitted proposal kinds;
- output schema;
- preferred source or source capabilities;
- generation settings where the source supports them.

An action is not a provider, prompt response, Input, Todo, or Navigator Node. The
writer may pin useful actions in the interface, but the underlying action collection
must not be limited to a fixed toolbar.

### Interaction intent

The semantic purpose of one request. The initial vocabulary is deliberately small:

| Intent | Expected result | Permitted authoritative effect |
|---|---|---|
| `review` | Findings, questions, or assessments | None until an Input is adopted |
| `revise` | One or more bounded replacement/insertion alternatives | Accepted alternative becomes a text transaction |
| `discuss` | Explanatory or exploratory response attached to the chosen scope | None unless explicitly promoted later |
| `generate` | New prose proposed at an insertion target or as a new candidate | Accepted proposal becomes a text/document transaction |
| `propose_project_change` | Proposed Spine, Material, relationship, or Todo operations | Each adopted operation becomes its own typed transaction |

These intents can share transport and presentation components, but they have
different output contracts. A provider must not infer an intent from prompt wording.

### Request

One immutable invocation prepared from live Svelte state. A request captures the
writer's instruction, action version, target evidence, context candidates, source
selection, generation settings, and output contract.

### Activity and run

An **activity** is the writer-visible operation, such as reviewing a document. It may
fan out into several **runs** across passages, actions, or providers. Svelte owns both
lifecycles and derives aggregate progress from the runs. A provider response does not
decide that the activity is complete.

### Input proposal and Input

An `InputProposal` is untrusted normalised service output. An `InputRecord` is a
Svelte-owned durable record created only after target, schema, source, revision, and
deduplication checks pass. Provider-created IDs never become authoritative IDs.

### Adoption

The explicit conversion of an Input proposal into authoritative work. Adoption is a
typed workspace command, not generic JSON application. It records the originating
Input, provider/model, action version, context manifest, source revisions, and writer
decision.

## Writing Context

**Writing Context** is the inspectable set of information supplied to one AI request.
It is not the Navigator Context view, although that view helps the writer find and
select relevant Material.

Writing Context is assembled from stable IDs and captured revisions. It can include:

- the current target and surrounding manuscript passage;
- the protected Spine and narrative contract;
- the focused Node, its primary containment path, and selected Material;
- confirmed relationships and their human-readable notes;
- explicitly applicable Todos;
- active-fork and version information;
- relevant unresolved Inputs when an action requests them;
- a writer-added instruction or temporary reference.

The writer must be able to inspect the included items, add or remove optional items,
and understand why an automatically resolved item is present. Navigator selection is
one way to choose Material; it is not the only context source and does not itself send
an AI request.

### Context classes

Each context item declares its role rather than becoming undifferentiated prompt text:

- **protocol** — application output and safety requirements;
- **constraint** — facts or rules the result must preserve;
- **fact** — confirmed project knowledge;
- **guidance** — preferences that may be balanced;
- **reference** — supporting material, examples, or prior discussion;
- **target** — the exact content under review or proposed change.

A writer instruction may explicitly override guidance for one request. If it conflicts
with a canonical constraint or fact, the request must either treat the instruction as
a proposed project change or report the conflict. The model must not silently rewrite
the Spine to make its answer consistent.

### Context manifest

Every run records a manifest of what was actually sent, not merely what was eligible:

```ts
interface AIContextManifest {
  workspaceRevision: number;
  forkId: string;
  target: CapturedTarget;
  items: Array<{
    id: string;
    sourceType: 'action' | 'spine' | 'material' | 'relationship' | 'todo' | 'manuscript' | 'input' | 'writer';
    sourceId: string;
    sourceRevision: number;
    role: 'protocol' | 'constraint' | 'fact' | 'guidance' | 'reference' | 'target';
    reason: string;
    inclusion: 'required' | 'resolved' | 'writer_added';
    sent: boolean;
    omissionReason?: 'writer_excluded' | 'not_applicable' | 'budget';
  }>;
}
```

The exact type may change, but these facts may not disappear. If token budgeting
trims or summarises supplied context, the service returns the final manifest and the
run records that transformation. A provider adapter cannot silently add hidden
database context or omit mandatory constraints.

Context resolution should initially be deterministic and shallow: explicit selection,
primary containment, directly confirmed relationships, active scope, and required
Spine rules. Retrieval, embeddings, or AI-ranked context may be added later only as an
explainable candidate source that the manifest exposes.

## Request envelope

A domain request crosses the AI boundary only after Svelte has captured the live
evidence needed to validate its eventual result:

```ts
interface AIInteractionRequest {
  activityId: string;
  runId: string;
  intent: 'review' | 'revise' | 'discuss' | 'generate' | 'propose_project_change';
  action: { id: string; version: number };
  writerInstruction?: string;
  target: CapturedTarget;
  context: AIContextManifest;
  permittedProposalKinds: string[];
  outputContract: { schemaId: string; version: number };
  sources: Array<{ sourceId: string; model?: string }>;
  generation: Record<string, unknown>;
}
```

`CapturedTarget` includes stable domain identity, revision, exact source text where
applicable, and the original ContentTarget. Provider-facing offsets are relative to
that captured target, never guessed against whatever text exists when the reply
arrives.

## Prompt and provider boundary

The AI interaction service may:

- transform a domain request into provider-specific messages;
- include only context present in the request envelope;
- enforce token budgets while reporting final inclusions and omissions;
- call one or more configured source adapters;
- apply provider capability differences;
- repair common malformed structured output;
- make bounded corrective retries for output-only validation failures;
- return normalised proposals, usage, cost, raw-output diagnostics, and the final
  context manifest.

It may not:

- read ProseMirror, Yjs, IndexedDB, SQLite, or browser state for fresher content;
- discover additional project context without recording it in the manifest;
- apply a response to the workspace;
- convert a proposal into a canonical Input ID;
- decide that a stale target is still close enough;
- retry authentication or configuration failures, or disguise transport failures as
  malformed output;
- hide provider errors or malformed responses.

Provider selection and Input filtering remain separate:

- **Use** determines which configured sources participate in a future activity.
- **Show** and category/state filters determine which existing Inputs are visible.
- Changing either does not rewrite past run provenance.

## Coordinated constraints

An AI action must not optimise one concern in isolation while ignoring the rest of the
active narrative contract. A cadence request, for example, can vary rhythm while also
preserving point of view, tense, distance, character knowledge, facts, and any other
required constraints included in Writing Context.

Action definitions therefore separate:

- **objective** — what this request is trying to improve;
- **preserve** — constraints that every alternative must retain;
- **avoid** — known failure patterns;
- **evaluate** — checks applied before proposals become Inputs.

Buttons such as Heighten or Vary cadence may eventually be pinned actions, but they
must invoke this coordinated contract rather than constructing isolated prompts.
Free-form writer instructions use the same request envelope and context inspection.

## Existing-work assimilation

Importing or opening an existing work is a first-class AI workflow. A writer may ask
the system to use an existing manuscript, one or more reviews, and the current project
structure to populate or extend the Spine, Material, relationships, and Todos. This is
not limited to projects that were originally planned or written in Margin Note.

The workflow must respect the different authority of its sources:

- the manuscript is evidence of what the work currently contains;
- the Spine and adopted Material and relationships are confirmed project knowledge;
- a supplied review is editorial Input: its observations and recommendations are not
  silently promoted to manuscript facts;
- writer instructions govern the activity, subject to any explicit project
  constraints;
- missing or contradictory information remains a question, conflict, or proposed
  Todo rather than being invented as canon.

Assimilation is one writer-visible activity that may contain several coordinated
runs. For a substantial work, the expected shape is:

1. inspect the whole work, supplied reviews, existing Material definitions, and
   relationship vocabulary;
2. propose a work-level structural map and any genuinely useful additional Material
   or relationship definitions;
3. inspect bounded chapters, scenes, sections, or other project-defined units for
   local Material, relationships, character states, promises, payoffs, and work;
4. reconcile duplicates, aliases, scope, ordering, and conflicts across those units;
5. present grouped proposals and unresolved questions for human decision.

The activity must work with the writer's existing project vocabulary before proposing
extensions. A proposed new Material type or relationship definition is itself an
Input proposal and requires explicit adoption. The provider cannot create a parallel
AI-owned project structure or silently reorganise the Navigator.

Results should be separated by purpose. Readable assessments, explanations, and
questions remain ordinary Input content. Proposed project changes are bounded typed
operations such as creating or updating Material, linking existing Nodes, proposing a
Todo, or amending the Spine. Each operation retains its evidence anchors and can be
accepted, amended, rejected, or deferred independently or as an explicitly selected
group. Adoption uses the same Svelte transaction, provenance, validation, and
undo/redo path as a writer-authored project change.

The activity is resumable. Successful bounded runs are retained, failed runs can be
recovered without repeating successful work, and reconciliation operates over the
recorded proposals rather than asking a later provider to reconstruct earlier output.
The exact segmentation strategy, model roles, automatic reconciliation policy, and
approval interface remain workflow-design decisions; they do not weaken the authority
boundary above.

## Response handling

Provider output is hostile to assumptions even when the provider call succeeded.
The service and workspace apply distinct checks:

1. **Transport** records HTTP/provider success or failure and usage.
2. **Repair** attempts bounded local repair of common structured-output damage.
3. **Schema validation** checks the declared output contract and exact ranges/enums.
4. **Corrective retry** may occur for an output-only failure, with the validation
   error stated precisely; explicit truncation may increase the output allowance, and
   selected transient transport failures may receive a bounded transport retry.
5. **Normalisation** removes provider envelope differences without inventing missing
   domain facts.
6. **Workspace validation** verifies target identity, revisions, exact source text,
   stable boundaries, allowed proposal kind, and current applicability.
7. **Consolidation** removes only literal or conservatively equivalent duplicates.
8. **Adoption** creates Svelte-owned Inputs and persists their run evidence.

Every malformed response is recorded in run diagnostics and logged to the browser
console with attempt and recovery outcome. A recovered run may create Inputs; an
exhausted run remains inspectable but creates no fabricated result.

The implemented craft path permits at most three attempts per provider. Authentication
and configuration failures stop for reconfiguration. Manual retry is a separate run,
targets only the failed providers that remain configured, and is allowed only while
the captured live target remains unchanged.

## Concurrency and delayed replies

The writer may continue editing while AI runs. Dispatch never locks the manuscript.
The run target is transformed through intervening Svelte transactions:

- edits before a text target may move it;
- edits inside a requested passage make the response inapplicable;
- deletion moves attached work to its defined removed/stale state;
- a response cannot recover by fuzzy-searching for similar prose;
- acceptance revalidates the current source content immediately before mutation.

Cancellation changes Svelte run state and aborts transport where possible. A provider
reply received after cancellation or supersession is diagnostic evidence, not a live
Input.

## Provenance and observability

Every run must retain enough evidence to explain:

- who initiated it and from which UI/action;
- activity, run, action, prompt, schema, and source versions;
- provider, model, compatible protocol, and supported generation settings;
- captured target and workspace/fork revisions;
- eligible, included, omitted, trimmed, or summarised context;
- writer instruction and constraints;
- attempts, repairs, retries, cancellation, errors, latency, tokens, and cost;
- returned proposal IDs and resulting Svelte Input IDs;
- later acceptance, rejection, promotion, supersession, or staleness.

Raw credentials and secrets are never provenance. Raw provider output may be retained
for diagnostics with bounded size and appropriate privacy controls.

## UI ownership

- **Navigator:** selects and exposes the Spine, Material, relationships, and Todos
  that may contribute to Writing Context. It contains no providers, runs, recipes, or
  generated AI cards.
- **Central editor:** owns writing, formatting, selection, pane/fork focus, and
  accepted transactions.
- **Inputs panel:** initiates review and other AI activities, displays run state and
  returned Inputs, and provides filtering, discussion, rejection, and adoption.
- **Settings:** owns named providers, model/capability configuration, credential
  references, default generation settings, and action management.

Writing Context needs a clear inspect/edit surface, but its final modal, panel, or
split-pane presentation remains a UX decision. The domain boundary does not depend on
that choice.

## Phase 1 implementation gate

Before expanding AI features, implementation must be able to prove:

1. Svelte creates a typed request envelope from a captured target and deterministic
   context manifest.
2. The AI service has no hidden workspace/editor/database reads.
3. The exact final context manifest returns with every run.
4. Review, revise, discuss, generate, and project-change intents cannot return proposal
   kinds outside their contracts.
5. Provider output cannot mutate authoritative state or choose authoritative IDs.
6. Delayed results are transformed or rejected through the existing target reducer.
7. Malformed output, retry, cancellation, partial multi-provider completion, cost, and
   provenance remain inspectable.
8. Acceptance/adoption is one undoable Svelte workspace transaction.
9. Provider **Use** state and existing-Input **Show** filters remain independent.
10. Tests use deterministic fake services before any paid provider is needed.

Only after this boundary is represented in types and deterministic tests should the
project add broader AI actions, automatic context retrieval, chat UX, or new provider
adapters.

### Implemented foundation slice

The first boundary slice is now represented in code:

- Svelte creates and persists explicit AI activity and run records;
- every craft run captures an immutable action, target, source revision, permitted
  proposal kinds, source participation, and Writing Context manifest before dispatch;
- the deterministic resolver currently includes the action, writing brief, exact
  target, protected Spine, selected Navigator Material, applicable legacy context,
  direct confirmed relationships, and open attached Todos;
- a narrow interaction service receives the complete request and translates it for
  the existing craft endpoint without reading WorkspaceState, the editor, or
  persistence;
- returned context is checked for hidden additions, rewritten evidence, duplicate
  identities, and omitted required items;
- invalid or unpermitted proposal kinds are rejected before they can become Inputs;
- resulting Inputs retain activity, run, action, and context-manifest provenance;
- deterministic tests exercise required/optional context, hostile context changes,
  proposal permissions, transport translation, delayed targets, and the rule that a
  proposal never edits manuscript text.
- named local provider profiles support OpenAI-compatible and Anthropic Messages
  protocols; settings expose presets for OpenRouter, OpenAI, Anthropic, and Ollama;
- provider recovery classifies malformed output, truncation, transient transport,
  rate limits, authentication, and configuration, with at most three attempts;
- the provider and run managers expose provider health state, participating sources,
  retained diagnostics and attempts, and a new-run retry of failed sources against an
  unchanged target.

This is the basement, not the complete AI system. The visible Writing Context editor,
general project-change proposals, model role routing, resumable workflow graphs,
existing-work assimilation, and their UX remain to be implemented deliberately on
this boundary.

## Deliberately unresolved UX and policy

This boundary does not yet decide:

- the final Writing Context inspector layout;
- how actions are created, shared, pinned, grouped, or invoked;
- whether discussions appear as threaded Input cards or a dedicated right-panel view;
- the default context inheritance rules for future split panes;
- category vocabulary and project-defined category extensions;
- automatic run scheduling, interruption thresholds, or background review policy;
- long-work segmentation, retrieval, summarisation, and reconciliation beyond the
  deterministic Phase 1 resolver, including the execution plan for existing-work
  assimilation;
- provider/model routing, fallback, and per-action cost policy;
- when an Input should be promoted to a Todo, Material note, Spine amendment, or
  relationship proposal in the UI.

Those decisions can evolve without weakening the authority, request, context,
proposal, adoption, and provenance rules above.
