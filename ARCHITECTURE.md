# Architecture boundary

Margin Note is still an experiment. The architecture should make the next experiment
cheap, not predict the final product.

## Current decision

The application has three boundaries:

```text
Svelte pages
  -> WorkspaceState (reactive writing behaviour)
    -> WorkspaceFacade (persistence and service operations)
      -> current HTTP API, SQLite ledger, and provider adapters

Svelte pages
  -> EditorShell (neutral editor commands and callbacks)
    -> ProseMirror, Yjs, and IndexedDB
```

Pages must not call workspace API routes directly. `WorkspaceState` must not know API
response envelopes. The façade owns those details and accepts an injected transport so
it can be tested or replaced.

`EditorShell` is the technology adapter for the active text editor. Its public API uses
plain text, positions, suggestions, and callbacks. ProseMirror and Yjs types stay inside
the editor implementation and its plugins.

This is not a promise that every dependency can be swapped without work. It keeps the
work local: changing an API or storage system should affect the façade, while changing
the rich-text engine should affect the editor adapter.

## Adaptable project and Codex model

The minimum shared vocabulary lives in `src/lib/workspace/model.ts`:

- **Project** — stable identity and project-wide extension data.
- **Container** — an ordered, nestable bucket.
- **Document** — a titled text leaf with an optional descriptive role.
- **Revision** — a preserved document snapshot with authorship and reason.

The manuscript and Codex use the same container/document primitives. `scene`,
`chapter`, `character`, `research`, and `narrative_rules` are optional roles, not
required folder names or hard-coded node kinds.

Every project and node has a stable ID. Renaming, moving, or reordering does not change
identity. Extension data is JSON-compatible and namespaced by convention:

```yaml
extensions:
  narration:
    tense: past
    focalization: limited
  timeline:
    story_day: 3
```

The core must preserve extension data it does not understand.

## Add-ons

For now an add-on is application code that:

1. reads neutral projects, containers, and documents through the façade;
2. stores optional data under its own extension key;
3. contributes commands, context, or a view without changing the core node model.

There is deliberately no runtime plugin loader, schema registry, or public plugin API
yet. We will extract a stable add-on interface only after two real add-ons need the
same seam.

## Mutation

Mutation follows four rules:

1. IDs remain stable.
2. Each accepted save advances the document revision.
3. The previous content can be recovered from a revision snapshot or ledger event.
4. Derived indexes and views are disposable; source documents and revisions are not.

Structured story time, character belief, and reader disclosure remain ordinary Codex
content until an experiment demonstrates that machine-queryable temporal state improves
editing enough to justify a timeline add-on.

## Intentionally deferred

- OKF, Obsidian, TEI, JSON-LD, or another interchange contract
- alternate production storage adapters
- a graph database or ontology
- a runtime third-party plugin system
- formal temporal reasoning
- automatic schema migration for arbitrary add-on data

Markdown export remains an interchange convenience. It is not yet the canonical
workspace store.

## Next vertical slice

Add the first user-visible Codex container and document through the façade. It should
support create, rename, move, edit, and revision recovery before adding specialised
character, timeline, or narrative-rule behaviour.
