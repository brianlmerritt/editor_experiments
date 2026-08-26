# Native project transfer v1

Margin Note's native project file is a portable project archive with the extension
`.mnote.zip`. It is a ZIP container with a versioned JSON manifest, neutral rich-document
records, project context, and binary assets.
Markdown remains a publishing/interchange export; it is not a project backup.

The first lossless exporter exposed a serious retention defect: document revisions
repeat growing AI run and Input arrays, producing archives hundreds of megabytes in
size and more than a gigabyte when expanded. Compact current-state import is now
implemented; importing the exhaustive forensic history remains deliberately
unsupported until that history is normalised and compacted. The measurements,
required roots, and migration order are in
[RETENTION_AND_COMPACTION.md](./RETENTION_AND_COMPACTION.md).

The normal **compact** export is read-only and includes each current record once. It
does not stream the repeated autosave revision tables. The manifest reports the exact
number of omitted document and context revisions. An explicit **forensic** export
retains the original exhaustive behaviour and is expected to be very large until
durable history is normalised.

## Authority boundary

Svelte 5 Rune workspace state creates the point-in-time export snapshot. The snapshot
therefore includes the current prose, formatting, Inputs, targets, runs, and project
structure even when the background durable save has not finished. It crosses the
workspace facade as domain data. The server adds asset bytes and, only in forensic
mode, immutable document/context revision history. It must not replace the posted
current records with an older database copy.

Export is read-only. It does not pause editing, change the active project, or make the
archive another source of truth.

## Archive layout

```text
project-name.mnote.zip
├── manifest.json
├── project.json
├── structure.json
├── documents/
│   ├── index.json
│   └── <document-id>.json
├── revisions/documents/             # forensic mode only
│   └── <document-id>.jsonl
├── context/
│   ├── index.json
│   └── <context-id>.json
├── revisions/context/               # forensic mode only
│   └── <context-id>.jsonl
└── assets/
    ├── index.json
    └── files/<asset-id>
```

`manifest.json` declares `margin-note-project`, format version `1`, export mode,
project identity, included and omitted revision counts, active-run count, safety
flags, and every archive path.
`project.json` preserves project-owned extensions other than Navigator structure.
`structure.json` is the single transfer location for that Navigator structure.
Document records retain plain text, neutral rich-document data, formats, Inputs,
behaviours, AI activities and runs, captured actions and Writing Context, provenance,
usage, and unknown extension data. Forensic revision files preserve complete immutable
history for the active project records. They use newline-delimited JSON so very long
histories can be compressed one revision at a time. Compact context files contain the
current records without their repeated histories.
Asset metadata and bytes remain separate.

The current model represents forks as stable documents with parent lineage. Export
preserves those IDs and links exactly. Import v1 remaps database-global project,
document, context, and asset IDs as one coherent graph before anything is persisted.
Project-scoped evidence IDs remain stable while references to remapped records are
updated.

## Included

- project identity and project-owned extension data;
- Spine, canonical Todos, Material definitions and nodes, containment, relationships,
  archive state, and ordering;
- every current project document; forensic mode additionally includes every immutable
  revision;
- forks/variants and their present lineage links;
- neutral rich content, formatting attachments, Inputs, target evidence, run history,
  diagnostics, captured action versions, context manifests, provenance, and recorded
  provider usage/cost;
- project and document context buckets; forensic mode additionally includes their
  immutable revisions;
- project-owned AI context preferences and editable, versioned AI action definitions;
- binary assets referenced by project content.

Captured action snapshots already travel with their runs. Project-owned action
definitions travel in `structure.json`; global provider configuration is not copied
merely because a run used it.

## Deliberately excluded

- API keys, provider profiles, credential references, and masked credentials;
- application-wide settings and device-local UI state;
- Navigator scroll/expansion memory, panel widths, zoom, and current browser selection;
- global provider/action defaults that the project does not own;
- derived indexes and caches that can be rebuilt.

All non-local provider participation is written as `off` in exported document state.
Historical provider/model/provenance and usage remain intact. This means a future
import cannot initiate paid work merely because it was enabled when exported.

An export may capture a queued or running AI request. The manifest reports how many.
Import will retain its evidence but convert it to interrupted work requiring an
explicit retry; it will never resume a network request automatically.

## Safe inverse import

Version 1 compact import:

1. open and inspect the ZIP without mutating the workspace;
2. validate the manifest, supported version, required files, path safety, record
   counts, IDs, references, and asset metadata/bytes;
3. show a preview with title, document/revision/context/asset counts, active-run
   warning, and any recoverable omissions;
4. always create a new project rather than overwrite or merge an existing one;
5. remap project, document, context, and asset IDs consistently throughout structured
   project state;
6. leave paid providers disabled and turn captured active runs into interrupted runs;
7. adopt the validated candidate through one Svelte workspace operation, then persist
   it through the facade.

Import failure before adoption leaves the current project untouched. Merge, overwrite,
selective import, and legacy-folder inference are out of scope for v1.

## Current use

Open the project menu (`•••`) beside the project selector and choose **Export
project** for the compact archive. The browser downloads `<project-name>.mnote.zip`.
Choose **Export forensic archive** only when every autosave/audit revision is required;
the browser warns before attempting `<project-name>-forensic.mnote.zip`. **Export
Markdown** remains in the current document menu and exports only that writing
document. Choose **Import project…** and select a compact `.mnote.zip` file to inspect
its contents and warnings before creating it as a new project. Forensic archives are
not accepted by import.

**Delete project** permanently removes the selected project’s current records,
revision and context history, assets, project-scoped ledger rows, and recovery mirrors
known to the current browser. At least one project must remain. Deleted SQLite pages
become reusable database space but the file is not physically shrunk by an implicit,
blocking `VACUUM`.
