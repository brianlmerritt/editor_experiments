# Document-system adapters

This document records a future architecture option discussed during the Margin Note
proof of concept. It is not an implementation commitment. The immediate experiment
continues to use the current Svelte, ProseMirror, HTTP/SQLite and browser-mirror stack.

## The useful separation

Two replaceable boundaries must remain distinct:

1. **Workspace persistence** loads, commits, checkpoints, analyses, imports and
   exports project state. The current adapter uses browser-side `WorkspaceFacade`
   calls to SvelteKit HTTP routes and server SQLite, plus a browser Yjs/IndexedDB
   recovery mirror. A future SPA could use a browser-local persistence adapter without
   changing the workspace domain.
2. **Document system** presents and edits manuscript content. ProseMirror is the
   current document surface. A future adapter could connect the same project, Inputs
   and context system to another document host such as desktop Microsoft Word.

AI transport is a third concern. `InputService` may use a server proxy regardless of
which persistence or document adapter is active.

```text
Svelte WorkspaceState and domain commands
├── WorkspaceFacade / persistence port
│   ├── current: HTTP → server SQLite
│   └── possible: browser database / OPFS / SQLite-WASM
├── DocumentSystemAdapter / authoring port
│   ├── current: ProseMirror EditorShell
│   └── possible: Word task pane → Office.js → open desktop document
└── InputService / proposal port
    └── local checks and AI providers
```

Adapters do not decide project semantics. Spine, Material, Todos, relationships,
Inputs, evidence, behaviours and acceptance decisions stay in the Margin Note domain.
Provider output never writes directly to any document system; accepting a proposal
creates a normal workspace/document transaction through the active adapter.

## Candidate document-system contract

The exact TypeScript shape is deferred, but a document adapter would need the
following responsibilities:

```ts
interface DocumentSystemAdapter {
  capabilities(): Promise<DocumentCapabilities>;
  readSnapshot(): Promise<NeutralDocumentSnapshot>;
  readSelection(): Promise<ContentSelection>;
  apply(transaction: DocumentTransaction): Promise<DocumentReceipt>;
  reveal(target: ContentTarget): Promise<void>;
  subscribe(listener: (change: ExternalDocumentChange) => void): Unsubscribe;
}
```

Optional capabilities may include comments, tracked changes, persistent host anchors,
native document comparison, rich paste, tables, images, sections and pagination.
Unsupported operations must be explicit capability results, not silent degradation.
Host-specific objects—ProseMirror positions, Office.js `Range` objects, content-control
IDs or OOXML—must not leak into canonical project records. An adapter may retain them
as private evidence alongside the normal `ContentTarget` quotation and revision data.

## Desktop Word experiment

The possible Word scope is deliberately limited to current Microsoft 365 Word on
**Windows and macOS**. Word web, iPad, Marketplace-wide compatibility and older
perpetual Office editions are not initial targets.

The task pane can host the Svelte interface while `Office.js` provides access to the
open document. The existing workspace facade can continue to reach the project
service and SQLite; Word replaces the ProseMirror document surface, not project
persistence or AI services.

Useful Word-owned capabilities include:

- manuscript text, rich formatting, layout, pagination, spelling and printing;
- current selection and native document navigation;
- comments and replies;
- Track Changes and document comparison where supported;
- tagged rich-text content controls as durable host anchors;
- custom document properties or custom XML for stable Margin Note document/project
  identity;
- native Word undo for Word mutations.

Microsoft documents `WordApiDesktop` as a production requirement set for Word on
Windows and Mac. Capability checks are still required at runtime because installed
Office versions and update channels differ, and desktop-specific sets cannot simply
be used as manifest activation requirements:

- [Word add-ins](https://learn.microsoft.com/en-us/office/dev/add-ins/word/)
- [WordApiDesktop 1.4](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-desktop-1-4-requirement-set)
- [WordApiDesktop 1.5](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/word/word-api-desktop-1-5-requirement-set)
- [Word events](https://learn.microsoft.com/en-us/office/dev/add-ins/word/word-add-ins-events)
- [Content controls](https://learn.microsoft.com/en-us/javascript/api/word/word.contentcontrol)
- [Comments](https://learn.microsoft.com/en-us/javascript/api/word/word.comment)

## The authority issue

The current ProseMirror surface is a projection: Svelte receives fine-grained editor
transactions, updates canonical state and renders the result. Word is different. A
writer can edit it independently while the task pane is closed, another user can
coauthor the file, and Office.js reports asynchronous paragraph/content-control
events rather than ProseMirror-style steps.

Two authority models are possible:

1. **Word owns manuscript content; Svelte owns project/context/Inputs.** Word changes
   are imported as external document transactions and Margin Note maintains its
   project graph, targets and evidence around them. This is probably the more natural
   Word integration.
2. **Svelte remains authoritative for manuscript content.** Every Word change must be
   diffed, normalised and reduced into Svelte before any further document operation.
   This preserves one authority rule but creates a much harder synchronisation and
   undo problem.

This decision must be made before a production Word adapter. It must not be chosen
silently during implementation.

## Anchors, comments and change

An Office.js `Range` is useful during a session but is not by itself a durable project
anchor. A Word adapter would likely combine:

- normal Margin Note `ContentTarget` evidence;
- tagged content controls for durable important ranges;
- Word comment IDs when an Input is deliberately represented as a Word comment;
- paragraph/content-control change events for invalidation and re-resolution;
- custom XML or document properties for project/document identity.

Content controls are document objects visible to Word and have nesting and deletion
semantics. They should be reserved for anchors that justify altering the `.docx`, not
wrapped around every token. Word comments and Margin Note Inputs are related but not
identical: an Input may be hidden, rejected, superseded, generated by multiple models
or attached to non-document Material. Mapping one into a Word comment must therefore
be an explicit presentation choice, not the canonical storage model.

## Undo, external edits and lifecycle

Word mutations should participate in Word's native undo and Track Changes where
appropriate. Margin Note project mutations still use domain undo. A combined action
that changes Word and project state needs a transaction receipt and compensation path;
pretending two independent undo stacks are atomic would be unsafe.

The adapter must also handle:

- task-pane closure and event-handler re-registration;
- edits made while Margin Note is not running;
- document reopen and anchor rehydration;
- content-control or commented-text deletion;
- coauthoring and external changes;
- runtime feature differences between Windows and Mac;
- stale AI responses arriving after Word content changed;
- preserving unsupported Word content rather than flattening it accidentally.

## Bounded proof of concept

A future spike should answer architectural questions rather than attempt full editor
parity:

1. Host a small Svelte task pane in Word on Windows and Mac.
2. Read selection plus its containing paragraph into neutral domain values.
3. Create an Input without changing Word.
4. Apply an accepted replacement through Office.js and confirm native undo.
5. Add an optional Word comment for an Input.
6. Create one tagged content-control anchor, then test surrounding edits, deletion,
   undo, save, close and reopen.
7. Capture paragraph/content-control events and measure whether they contain enough
   information for deterministic target transformation.
8. Repeat the same fixtures on both platforms and record the actual supported
   requirement sets.

The spike should not move Spine, Material, Todos, relationships, AI evidence or
provider settings into Word. Its result is a capability report and an authority
decision, not a second product implementation.

Rough discussion estimates were one to two weeks for the spike, four to eight weeks
for a useful anchored single-document integration, and several months for robust
cross-platform project integration. These are planning ranges, not commitments.

## Deferred decisions

- Whether Word or Svelte owns manuscript authority in Word mode.
- Which `WordApiDesktop` requirement set is the supported baseline.
- Whether project identity uses custom properties, custom XML or both.
- Which Inputs may be projected as Word comments.
- How Word native undo and Margin Note domain undo coordinate.
- Whether a Word file represents one project Node, one fork or a compiled work.
- How external/coauthored edits transform targets and invalidate AI work.
- Whether the Word adapter remains an experiment or becomes a supported document
  system.
