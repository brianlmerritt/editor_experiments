<script lang="ts">
  import { categoryMeta, type Suggestion } from '$lib/domain';

  export let suggestion: Suggestion;
  export let active = false;
  export let tray = false;
  export let selectedVariant = 0;
  export let onActivate: () => void = () => {};
  export let onSelectVariant: (index: number) => void = () => {};
  export let onAccept: (index: number, edit: boolean) => void = () => {};
  export let onReject: (viaDrag: boolean) => void = () => {};
  export let onPreview: (text: string | null) => void = () => {};
  export let onSourceHover: () => void = () => {};
  export let onMove: (direction: -1 | 1) => void = () => {};

  let dragX = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let axis: 'x' | 'y' | null = null;

  $: variants = suggestion.variants.length ? suggestion.variants : suggestion.payload.text !== undefined ? [{ id: `${suggestion.id}_primary`, text: suggestion.payload.text }] : [];
  $: meta = categoryMeta[suggestion.category];

  function pointerDown(event: PointerEvent): void {
    if ((event.target as HTMLElement).closest('button')) return;
    startX = event.clientX;
    startY = event.clientY;
    axis = null;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!axis && Math.hypot(dx, dy) >= 8) axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (axis === 'x') dragX = dx < 0 ? dx * 0.55 : dx;
  }
  function pointerUp(): void {
    if (!dragging) return;
    dragging = false;
    if (axis === 'x' && Math.abs(dragX) >= 40) onReject(true);
    else if (!axis) onActivate();
    dragX = 0;
    axis = null;
  }
</script>

<article
  class="card cat-{suggestion.category}"
  class:active
  class:tray
  class:dragging
  style:transform={`translateX(${dragX}px)`}
  on:pointerdown={pointerDown}
  on:pointermove={pointerMove}
  on:pointerup={pointerUp}
  on:pointercancel={pointerUp}
>
  <header>
    <span class="category"><span class="icon">{meta.icon}</span>{meta.label}</span>
    <span class="confidence">{Math.round(suggestion.confidence * 100)}%</span>
  </header>
  <p class="observation">{suggestion.payload.comment}</p>
  {#if variants.length}
    <div class="variants" aria-label="Replacement variants">
      {#each variants as variant, index}
        <button
          type="button"
          class:selected={selectedVariant === index}
          on:click|stopPropagation={() => { onSelectVariant(index); onActivate(); }}
          on:mouseenter={() => onPreview(variant.text)}
          on:mouseleave={() => onPreview(null)}
        >
          <span>{index + 1}</span>
          <q>{variant.text || 'Delete this text'}</q>
        </button>
      {/each}
    </div>
  {/if}
  <footer>
    {#if tray}
      <span class="order-buttons">
        <button type="button" aria-label="Move earlier" on:click|stopPropagation={() => onMove(-1)}>↑</button>
        <button type="button" aria-label="Move later" on:click|stopPropagation={() => onMove(1)}>↓</button>
      </span>
    {/if}
    <span class="decisions">
      <button class="reject" type="button" title="Reject (X)" on:click|stopPropagation={() => onReject(false)}>×</button>
      {#if variants.length}
        <button class="edit" type="button" title="Accept and edit (E)" on:click|stopPropagation={() => onAccept(selectedVariant, true)}>e</button>
        <button
          class="accept"
          type="button"
          title="Accept (Enter)"
          on:click|stopPropagation={() => onAccept(selectedVariant, false)}
          on:mouseenter={() => onPreview(variants[selectedVariant]?.text ?? '')}
          on:mouseleave={() => onPreview(null)}
        >✓</button>
      {/if}
    </span>
    <button type="button" class="source" title={`${suggestion.sourceKind === 'local' ? 'Local' : 'AI'} source ${suggestion.sourceNumber}: ${suggestion.source}`} on:mouseenter={onSourceHover} on:click|stopPropagation={onActivate}>
      <b>{suggestion.sourceKind === 'local' ? 'L' : 'A'}</b>{suggestion.sourceNumber}
    </button>
  </footer>
</article>

<style>
  .card { --category: var(--cat-diction); position: relative; width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-left: 4px solid var(--category); border-radius: 3px; background: color-mix(in srgb, var(--paper) 96%, var(--category)); padding: 13px 13px 10px; box-shadow: 0 7px 25px rgb(32 27 20 / .06); cursor: pointer; touch-action: pan-y; transition: transform .18s ease, opacity .18s ease, box-shadow .18s ease; user-select: none; }
  .card.active { box-shadow: 0 12px 32px rgb(32 27 20 / .14); border-color: color-mix(in srgb, var(--category) 48%, var(--line)); }
  .card.dragging { transition: none; cursor: grabbing; }
  .cat-pov { --category: var(--cat-pov); } .cat-tense { --category: var(--cat-tense); } .cat-canon { --category: var(--cat-canon); } .cat-cadence { --category: var(--cat-cadence); } .cat-diction { --category: var(--cat-diction); } .cat-distance { --category: var(--cat-distance); }
  header, footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .category { display: flex; align-items: center; gap: 7px; color: var(--ink); font: 700 11px/1.2 var(--font-ui); letter-spacing: .035em; text-transform: uppercase; }
  .icon { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: color-mix(in srgb, var(--category) 16%, transparent); color: color-mix(in srgb, var(--category) 82%, var(--ink)); font-size: 10px; }
  .confidence { color: var(--muted); font: 600 10px/1 var(--font-ui); }
  .observation { color: var(--ink-soft); font: 400 13px/1.45 var(--font-ui); margin: 10px 0; user-select: text; }
  .variants { display: grid; gap: 5px; margin: 9px 0 10px; }
  .variants button { display: grid; grid-template-columns: 19px 1fr; gap: 7px; align-items: start; width: 100%; border: 1px solid transparent; border-radius: 3px; background: var(--paper-deep); color: var(--ink-soft); text-align: left; padding: 7px; font: 12px/1.35 var(--font-ui); cursor: pointer; }
  .variants button.selected { border-color: color-mix(in srgb, var(--category) 55%, var(--line)); background: color-mix(in srgb, var(--category) 8%, var(--paper)); }
  .variants button > span { display: grid; place-items: center; width: 18px; height: 18px; border: 1px solid var(--line-strong); border-radius: 50%; color: var(--muted); font: 700 9px/1 var(--font-ui); }
  q { quotes: none; }
  footer { min-height: 25px; padding-top: 3px; }
  .decisions, .order-buttons { display: flex; gap: 4px; }
  footer button { display: grid; place-items: center; width: 25px; height: 25px; border: 1px solid var(--line); border-radius: 50%; background: transparent; color: var(--muted); font: 700 13px/1 var(--font-ui); cursor: pointer; }
  footer button:hover { background: var(--paper-deep); color: var(--ink); }
  footer .accept { background: var(--accept); border-color: var(--accept); color: white; }
  footer .reject:hover { border-color: var(--reject); color: var(--reject); }
  footer .edit { font-style: italic; }
  footer .source { width: auto; height: auto; margin-left: auto; display: flex; align-items: baseline; gap: 2px; border: 0; color: var(--ink); font: 800 13px/1 var(--font-ui); padding: 3px 2px; }
  .source b { color: var(--muted); font-size: 9px; }
  .tray { max-width: 520px; }
</style>
