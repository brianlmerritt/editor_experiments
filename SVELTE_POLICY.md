# Svelte 5 reactivity policy

This project uses Svelte 5 and Runes exclusively for application reactivity.

## Required

- Component inputs use `$props()`.
- Mutable UI and domain state uses `$state` in `.svelte` or `.svelte.ts` modules.
- Computed values use `$derived` or `$derived.by`.
- Reactive side effects use `$effect`.
- Layout content uses snippets and `{@render ...}` rather than legacy slots.
- DOM handlers use Svelte 5 event attributes such as `onclick` and `oninput`.
- Shared reactive application state uses Rune modules. Persistence and HTTP façades do
  not become competing sources of UI truth.
- The Spine, canonical Todos, Collection definitions, Nodes, relationships, active
  forks, pane view contexts and their independent Traditional/Context Navigator
  memory, durable Input-card state, and Navigator projections follow the
  same rule. Canonical records live in the workspace Rune state; expansion, filtering,
  focus, panel width, and other presentation state may live in dedicated UI Rune
  state. See [NAVIGATION.md](./NAVIGATION.md).

Plain `let` remains appropriate only for values that are deliberately non-reactive,
such as timeout handles, lifecycle-owned library instances, and local algorithm
variables.

## Prohibited

- legacy `$:` reactive declarations;
- component `export let` props;
- `on:event` directives;
- legacy `<slot>` rendering;
- `svelte/store` for application reactivity;
- mirroring Rune state into a second reactive system to make updates render.
- allowing a Navigator tree, Input-card collection, ProseMirror instance, or split
  pane to own an independently mutable copy of the Spine, a Todo, a domain node, or a
  relationship.

`src/lib/svelte-policy.test.ts` enforces the mechanically detectable parts of this
policy. Any intentional exception must be documented here before it is introduced.
