# Workspace façade v1

This document specifies the intended v1 boundary between the authoritative Svelte
workspace state and persistence, collaboration, service, import, and export
implementations. The domain model and transaction semantics are defined in
[ARCHITECTURE.md](./ARCHITECTURE.md).
The forthcoming graph-backed Navigator and fork-view requirements are recorded in
[NAVIGATION.md](./NAVIGATION.md); they extend the snapshot content without changing
this authority boundary.

## Purpose

The façade exists so Svelte pages and domain state do not depend on:

- HTTP routes or response envelopes;
- IndexedDB object stores;
- Yjs documents or relative-position types;
- SQLite tables;
- filesystem or cloud APIs;
- provider-specific generation requests;
- export-library details.

The façade is not a repository-shaped source of domain truth. It hydrates the Svelte
state and durably records transactions and snapshots produced by that state.

## Authority rule

During an active session:

```text
WorkspaceState is authoritative.
The editor DOM is a projection.
The façade carries state across process and device boundaries.
Persistence is the durable record from which a new WorkspaceState is hydrated.
```

After hydration, a driver must not mutate an independent manuscript and later replace
the Svelte state without expressing the change as a normalised snapshot or
transaction.

Yjs may merge concurrent operations and IndexedDB may journal them, but those types
and storage decisions remain behind the boundary. A different driver must be possible
without changing Svelte components or the public content-target model.

## Minimum public responsibilities

The eventual façade should cover five operations:

```ts
interface WorkspaceFacade {
  load(preferred?: LoadPreference): Promise<WorkspaceSnapshot>;
  commit(transaction: Transaction): Promise<CommitReceipt>;
  checkpoint(snapshot: WorkspaceSnapshot): Promise<CheckpointReceipt>;
  subscribe(listener: (change: RemoteWorkspaceChange) => void): Unsubscribe;
  export(request: ExportRequest): Promise<ExportArtifact>;
}
```

The exact TypeScript names may change during implementation. The responsibility split
must not.

### `load`

Returns one active work as a domain snapshot: protected Spine identity and content,
canonical Todos, Collection definitions, Nodes, typed edges, forks, formats, Inputs,
behaviour profiles, revision metadata, and durable history required to resume safely.

Loading may combine browser recovery, a server checkpoint, and later transactions.
That reconciliation occurs behind the façade. The result contains domain types, not
Yjs, database, or HTTP types.

### `commit`

Durably records a transaction already accepted by `WorkspaceState`. The Svelte state
may update optimistically, while its outbox retains unacknowledged transactions and
exposes dirty/error state.

The transaction ID makes commit idempotent. Retrying must not apply the same semantic
change twice. A receipt acknowledges durable revision information; it does not return
a replacement document model.

Structural moves, relationship changes, Collection-definition changes, Spine edits, Todo
lifecycle changes, fork creation, and durable Input-card lifecycle changes use the
same commit boundary as prose and formatting. A Navigator component must not persist
these through its own storage path.

### `checkpoint`

Stores a compact snapshot so load need not replay an unlimited transaction stream.
Checkpointing does not create a second authority and does not replace immediate
undo/redo history accidentally.

### `subscribe`

Delivers remote, restored, or externally imported changes in a normalised form that
can enter the same workspace reducer as local actions. Presence, cursors, and transient
awareness are separate UI data and do not mutate the durable work.

The first implementation may return a no-op unsubscribe function while collaboration
is absent.

### `export`

Projects current workspace state into Markdown, DOCX, EPUB, or another requested
format. Unsupported inputs and formatting must be reported or intentionally omitted;
an export must never silently become the source of truth.

## Services that produce inputs

AI and local analysis produce `InputRecord` proposals. Provider-specific transport may
remain reachable through a façade or an adjacent `InputService`, but provider responses
must be normalised before entering `WorkspaceState`:

```ts
interface InputService {
  request(request: InputRequest, signal?: AbortSignal): Promise<InputProposal[]>;
}
```

An AI provider never writes to the manuscript, Spine, Todos, Collections, or relationships
directly. Accepting a proposed revision or adopting a proposed Todo/change creates an
ordinary workspace transaction with provenance linking it to the Input.

Keeping this service logically separate prevents generation concerns from expanding
the persistence contract. The existing `WorkspaceFacade` class may continue to host
both responsibilities during the POC while callers depend only on the narrow methods
they need.

## Persistence timing and failure

Svelte updates are immediate. Persistence may be batched, but a local durable journal
should be written promptly enough that a closed tab does not routinely lose work.

The state exposes at least:

- clean or dirty;
- queued transaction count;
- last durable revision;
- retrying or failed;
- conflict requiring attention.

On failure, the façade must not roll the workspace back silently. It retains the
outbox, reports the failure, and retries or asks the writer to resolve a genuine
conflict.

## Transactions, undo, and the façade

The domain reducer creates forward and inverse patches and owns the active undo/redo
stacks. The façade persists accepted transactions and, where configured, enough recent
history to resume after a crash.

Calling undo creates or applies a domain reversal and then commits the resulting state
change through the same boundary. A text-only Yjs undo that leaves input state behind
does not satisfy this contract.

For collaboration, the driver may use a CRDT-specific undo implementation internally,
but the observable result must still be a complete domain transaction affecting text,
formats, inputs, targets, and selection consistently.

## Target ownership

`WorkspaceState` owns `ContentTarget` values and their behaviour profiles. A façade
driver may maintain private relative positions or database indexes to help persist and
merge them. Those private representations must not become the only recoverable form of
an anchor.

When external or concurrent changes arrive, the façade supplies enough normalised
information for the workspace reducer to transform targets deterministically. Original
quotation and revision evidence are preserved for recovery and explanation.

## Derived indexes

Indexes such as inputs by node, state, kind, source, or assignee may be stored for
performance. They are disposable. On disagreement, the canonical Svelte snapshot's
input and target records win, and indexes are rebuilt.

Traditional Navigator trees, selection-aware Context projections, relationship
facets, Todo views, other smart views, backlinks, applicable-context lists, and fork
summaries are also derived projections. A facade
implementation may persist indexes or user presentation preferences, but it must be
possible to rebuild the projections from canonical Spine, Todo, Collection, Node,
edge, fork, Input, and transaction data.

Split panes do not load independent works. Each horizontal or vertical pane carries a
Svelte-owned view context over the one loaded work and a selected fork/Node, plus the
Navigator and location memory needed to restore that working context. The focused
pane controls the current Navigator and Inputs/review projection; the facade persists
domain changes and selected preferences—including Traditional/Context mode and
independent expansion, scroll, selection, and recent-context memory—not a second
pane-specific manuscript authority.

## Implemented POC boundary

The current `src/lib/workspace/facade.ts` is an HTTP-oriented first slice. It keeps
routes and response handling out of Svelte components and persists the POC domain
payload—runs, inputs, formats, behaviour profiles, and workspace revision—in the
active document's `extensions.margin_note` data and immutable document versions.

The Svelte workspace owns canonical manuscript content, active undo/redo, run
lifecycle, proposal adoption, and target transformations. ProseMirror submits
transactions and renders the returned projection; it is not queried for content by
save, fork, export, formatting, or generation commands.

`commit` saves the Svelte snapshot to the durable document service, then mirrors the
acknowledged snapshot into a private `DocumentDriver`. The current browser driver uses
Yjs and IndexedDB without binding Yjs to the editor. `load` hydrates that mirror from
the durable snapshot. The driver can be replaced without changing Svelte state or
editor components.

`requestInputs` transports a Svelte-created request and returns untrusted
`InputProposal` values. It does not return domain inputs. `WorkspaceState` owns the
run target and state, exact-text validation, IDs, attachment behaviour, visibility,
deduplication, persistence, and ledger adoption events.

Provider settings use a parallel boundary: a Svelte 5 Rune settings state owns the
live form, validation, availability, model, and masked credential identity. The façade
transports settings requests and responses, while raw credentials remain behind the
server boundary and outside workspace and document state.

The remaining differences from this complete contract are:

- it loads several collections rather than one normalised aggregate snapshot;
- active history uses full in-memory snapshots and is not durable across reloads;
- generation and persistence methods share one class;
- idempotent transaction commits, an outbox, subscriptions, conflicts, and remote
  transaction reconciliation are not implemented.

These are migration facts, not reasons to expose the current implementation as the
long-term interface.

## Explicit non-goals for v1

- abstracting every third-party library behind its own interface;
- supporting multiple simultaneously open works;
- selecting a permanent collaboration engine;
- promising lossless representation in every export format;
- adding a runtime plugin system;
- retaining an unlimited keystroke-level event stream.
