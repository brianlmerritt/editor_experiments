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

`src/lib/svelte-policy.test.ts` enforces the mechanically detectable parts of this
policy. Any intentional exception must be documented here before it is introduced.
