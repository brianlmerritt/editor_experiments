# Retention and compaction

This document records the storage defect found while native project transfer was
being implemented. Compact current-state export/import no longer carries the repeated
revision tables. Full historical round trips and general durable garbage collection
remain deferred until the durable model stops amplifying repeated document state.

## Measured baseline

Measurements were taken on 26 August 2026 without changing or collecting project
data.

| Layer | Observed |
|---|---:|
| SQLite database | 2.2 GiB on disk |
| `workspace_document_revisions` table | 2,300,325,888 bytes |
| Current records returned at workspace startup | about 20.8 MB of JSON |
| Controlled-browser IndexedDB | 5,143,402 bytes |
| Controlled-browser development heap after load | 171,330,795 bytes used; 265,721,727 bytes allocated |

The browser figures are a development-build snapshot in a separate controlled
browser, not a measurement of an existing Chrome or Edge profile. They establish the
shape and order of magnitude, not a production memory budget.

The revision table contains almost all database bytes. Project-level raw JSON totals
are:

| Project | Revisions | Prose/content | Extension snapshots | Total revision data |
|---|---:|---:|---:|---:|
| AGI:TheBookTest | 675 | 8,265,158 B | 1,718,722,550 B | 1,726,987,708 B |
| My writing project | 1,128 | 2,866,217 B | 560,071,814 B | 562,938,031 B |
| Harsh Mercy | 34 | 0 B | 3,140 B | 3,140 B |

For AGI:TheBookTest, repeated `margin_note.runs` account for about 1.65 GB of the
revision data. For My writing project, repeated `margin_note.inputs` account for about
477 MB. The largest single document has 238 revisions consuming about 1.12 GB, of
which only 1.87 MB is plain prose.

## Cause

`WorkspaceState.domainExtensions()` currently places rich content, Inputs, formats,
up to 200 detailed AI runs, activities, source state, and behaviours into one document
extension object. Every durable domain change calls `saveDocument()`, which stores a
complete new copy of the prose and that extension object in
`workspace_document_revisions`.

This means an Input arriving, a run changing state, or another non-prose operation can
create another apparent manuscript revision containing most of the previous audit
history. Revision history, AI audit history, and current document state are three
different concerns but are currently one repeated JSON snapshot.

The same large object is passed to the Yjs write-behind mirror. `y-indexeddb` combines
its update records after roughly 500 updates, but each update can currently replace a
large opaque extension value. Browser storage is modest in the measured session, but
the write pattern can grow sharply between library compactions.

Browser memory has three additional amplifiers:

- `/api/workspace` loads current documents for every project, not selected-project
  metadata followed by the active document;
- active state is represented in the loaded document record, Rune domain arrays,
  neutral rich document, ProseMirror projection, and the Yjs mirror;
- undo stores up to 100 full before/after document, Input, and format snapshots. It is
  count-bounded rather than byte-bounded.

Browser recovery databases created from this point use a readable, collision-safe
identity:

```text
margin-note:document:<project-title>-<project-id>:<document-title>-<document-id>
```

For example, `AGI: The Book Test` / `Chapter 1 — Entrance Fee` becomes
`margin-note:document:agi-the-book-test-4db8912cc781:chapter-1-entrance-fee-9f2c5a7b6652`.
These are per-document Yjs recovery mirrors, not SQLite project databases. Existing
opaque names such as `margin-note:document:document_9f2c5a7b6652` are not renamed or
deleted automatically: IndexedDB has no atomic database rename, and silent deletion
could discard the only recovery copy of an unacknowledged edit. A storage-management
slice must first map, verify, and explicitly clear legacy mirrors after their durable
SQLite documents have been acknowledged.

Svelte remains the source of truth. Owning canonical state does not require Svelte to
hold every immutable provider response or inactive document body in live reactive
memory. It may own stable references and load their evidence through the facade when
needed.

## Implemented safe foundation

The first non-destructive retention slice is now implemented:

- **Storage report** in the project menu reads current and immutable-history sizes by
  document without changing the database. It reports same-prose rows as normalization
  candidates, never as automatically reclaimable garbage; formatting and attachment
  state can change while prose remains identical.
- Current document rows still persist the complete Svelte domain snapshot.
- New immutable manuscript revisions omit operational `inputs`, `runs`, `activities`,
  source participation/visibility and workspace counters.
- A current-state update containing only those operational fields updates durable
  state but creates no manuscript revision.
- Prose, rich-document structure, formats, attachment behaviour, title, containment
  or ordering changes continue to create immutable writing revisions.
- Restoring a writing revision preserves the current operational AI/Input state while
  restoring the revision's writing-bearing extension fields.

On 26 August 2026 the read-only report for `AGI:TheBookTest` completed in 11.26 seconds
against the 2.2 GiB database and reported 675 revisions / 1,726,997,781 bytes. Of
those, 618 revisions / 1,671,580,869 bytes repeat the preceding prose and therefore
require normalization analysis. Safe reclaimable bytes remain zero until their AI
evidence has been extracted and verified.

## Required separation

The durable model should distinguish five lifetimes:

1. **Current project state** — manuscript, rich structure, formats, Spine, Todos,
   Material, relationships, live Inputs, forks, and asset references.
2. **Meaningful manuscript history** — explicit checkpoints, accepted revisions,
   forks, published milestones, and recoverable editing checkpoints.
3. **AI evidence** — run identity, action/context snapshot, provider/model,
   provenance, usage/cost, diagnostics, proposals, and retained raw request/response.
4. **Session recovery** — undo/redo, unsaved outbox, current selection, and crash
   recovery mirror.
5. **Rebuildable projections** — search indexes, rendered decorations, derived
   navigation, and caches.

AI run and Input evidence must be stored once in normalised records. Manuscript
versions reference evidence IDs or a high-water mark; they do not embed the complete
evidence arrays. Current document records carry only active summaries and references
needed to restore Svelte state.

Manuscript content and rich-domain snapshots should use content-addressed blobs. An
immutable version record holds metadata and blob IDs; identical prose, rich content,
formats, or domain values are physically stored once. Forward/inverse patches may be
added later for efficient semantic history, but exact blob deduplication is the safer
first step.

## Collection roots

Garbage collection must be mark-and-sweep from explicit roots. Roots include:

- every current document, Spine, Todo, Material node, relationship, and referenced
  asset;
- every fork and its lineage;
- user-pinned checkpoints and named versions;
- accepted AI changes and the evidence required to explain them;
- published/export milestones;
- live Inputs, queued/running work, and retry chains;
- unsaved transactions and the active recovery checkpoint.

An object reachable from a root is not collectible. Unknown extension data is retained
until an owning feature supplies a safe policy.

## Lossless background compaction

The first collector must reclaim only provably redundant storage:

1. move runs, Inputs, activities, and provider evidence into normalised records;
2. replace repeated embedded arrays with stable references;
3. hash and deduplicate byte-identical content and domain blobs;
4. remove no-op revisions that differ only because repeated audit arrays grew;
5. compact the Yjs browser mirror after a durable facade acknowledgement, retaining a
   current checkpoint and unsent outbox rather than opaque audit history;
6. discard rebuildable projections and expired staged-transfer files;
7. record counts, hashes, and bytes reclaimed in a small GC audit event.

This pass does not silently thin meaningful writing history. A later, user-visible
policy may coalesce transient autosaves while retaining recent checkpoints plus
daily/weekly recovery points. Named versions, forks, accepted revisions, and
publication milestones remain permanent unless the user explicitly deletes them.

Collection should run in small idle batches and stop when editing, saving, or provider
work is active. Each batch is transactional. A crash before commit leaves the prior
state valid.

SQLite page deletion alone does not reduce the database file because `auto_vacuum` is
currently disabled. After logical compaction is verified, physical compaction needs a
separate idle operation, preferably a verified `VACUUM INTO` copy followed by an
atomic replacement. It must never run as an unannounced side effect of editing.

## Browser changes

- Load the project list and document metadata first; load current document domains
  only for the selected project/document.
- Keep bulky raw run evidence outside deep Rune proxies and fetch it through the
  facade on demand. Svelte owns its identity, lifecycle, and current references.
- Replace the undo entry-count limit with a memory budget and semantic checkpoint
  squashing. Undo remains coordinated across content, formats, and Inputs.
- Give `DocumentDriver` an explicit checkpoint/compact operation and a lifecycle that
  closes inactive document handles.
- Mirror collaboration/recovery state, not the complete immutable AI audit ledger, in
  Yjs/IndexedDB.
- Add a read-only Storage diagnostics view using `navigator.storage.estimate()` and,
  where supported, browser heap figures. Diagnostics must label unsupported or
  approximate values honestly.

## Migration and safety order

1. Add a read-only analyzer and dry-run compaction report per project/document.
2. Normalise new writes so the database stops growing quadratically.
3. Switch startup to lazy selected-project/document loading.
4. Add content-addressed version blobs and separate AI evidence tables.
5. Migrate existing rows into the new model and verify every current document,
   checkpoint, fork, Input, run, cost, and relationship by count and hash.
6. Offer lossless logical compaction with a before/after report.
7. Physically compact SQLite only after a separate backup and verification step.
8. Extend `.mnote.zip` import to normalised historical evidence after migration.

The default `.mnote.zip` exporter now produces a read-only compact projection containing
current project state once and reports omitted autosave revision counts. The explicit
forensic mode retains the old repeated-history diagnostic backup. Compact export does
not compact SQLite; durable normalisation and garbage collection remain required.
Compact import validates the archive, creates a new project, and does not import the
omitted history. Explicit project deletion reclaims that project’s logical rows and
browser mirrors, but it is not a general collector and does not physically shrink the
SQLite file.

## Acceptance criteria for historical import and general collection

- Repeated AI run or Input updates do not duplicate manuscript or prior audit bytes.
- Ten no-prose run lifecycle updates create no manuscript versions.
- Opening one project does not load other projects' document bodies or AI evidence.
- Browser recovery storage can be explicitly checkpointed and compacted.
- A dry-run report accounts for retained and collectible bytes before mutation.
- Current state and all collection roots restore byte-for-byte after migration.
- A normalised `.mnote.zip` round trip preserves those roots and evidence without
  expanding repeated snapshots.
