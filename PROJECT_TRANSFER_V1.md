# Native project transfer v1

Margin Note's native project file is a complete, portable project archive with the
extension `.mnote`. It is a ZIP container with a versioned JSON manifest, neutral
rich-document records, immutable history, project context, and binary assets.
Markdown remains a publishing/interchange export; it is not a project backup.

## Authority boundary

Svelte 5 Rune workspace state creates the point-in-time export snapshot. The snapshot
therefore includes the current prose, formatting, Inputs, targets, runs, and project
structure even when the background durable save has not finished. It crosses the
workspace facade as domain data. The server adds immutable document/context revision
history and asset bytes, but must not replace the posted current records with an older
database copy.

Export is read-only. It does not pause editing, change the active project, or make the
archive another source of truth.

## Archive layout

```text
project-name.mnote
├── manifest.json
├── project.json
├── structure.json
├── documents/
│   ├── index.json
│   └── <document-id>.json
├── revisions/documents/
│   └── <document-id>.json
├── context/
│   ├── index.json
│   └── <context-id>.json
└── assets/
    ├── index.json
    └── files/<asset-id>
```

`manifest.json` declares `margin-note-project`, format version `1`, producer version,
project identity, counts, active-run count, safety flags, and every archive path.
`project.json` preserves project-owned extensions other than Navigator structure.
`structure.json` is the single transfer location for that Navigator structure.
Document records retain plain text, neutral rich-document data, formats, Inputs,
behaviours, AI activities and runs, captured actions and Writing Context, provenance,
usage, and unknown extension data. Revision files preserve complete immutable history
for the active project records. Context files contain the current record and its
versions. Asset metadata and bytes remain separate.

The current model represents forks as stable documents with parent lineage. Export
preserves those IDs and links exactly. Import v1 will remap IDs as one coherent graph
before anything is persisted.

## Included

- project identity and project-owned extension data;
- Spine, canonical Todos, Material definitions and nodes, containment, relationships,
  archive state, and ordering;
- every current project document and its immutable revisions;
- forks/variants and their present lineage links;
- neutral rich content, formatting attachments, Inputs, target evidence, run history,
  diagnostics, captured action versions, context manifests, provenance, and recorded
  provider usage/cost;
- project and document context buckets plus their immutable revisions;
- project-owned AI context preferences and future project-owned action definitions;
- binary assets referenced by project content.

Captured action snapshots already travel with their runs. Global action/provider
configuration is not copied merely because a run used it.

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

## Planned inverse import

Import is intentionally a separate implementation slice. Version 1 will:

1. open and inspect the ZIP without mutating the workspace;
2. validate the manifest, supported version, required files, path safety, record
   counts, IDs, references, and asset metadata/bytes;
3. show a preview with title, document/revision/context/asset counts, active-run
   warning, and any recoverable omissions;
4. always create a new project rather than overwrite or merge an existing one;
5. remap project, document, revision, context, relationship, Todo, Input, run, and
   asset IDs consistently;
6. leave paid providers disabled and turn captured active runs into interrupted runs;
7. adopt the validated candidate through one Svelte workspace operation, then persist
   it through the facade.

Import failure before adoption leaves the current project untouched. Merge, overwrite,
selective import, and legacy-folder inference are out of scope for v1.

## Current use

Open the project menu (`•••`) beside the project selector and choose **Export
project**. The browser downloads `<project-name>.mnote`. **Export Markdown** remains
in the current document menu and exports only that writing document.
