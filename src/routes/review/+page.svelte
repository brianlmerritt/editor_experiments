<script lang="ts">
  import { onMount } from 'svelte';
  import { categoryMeta, categories, makeId, type Category, type JudgmentPair } from '$lib/domain';

  let pairs: JudgmentPair[] = [];
  let index = 0;
  let reason = '';
  let loading = true;
  let completed = 0;
  let sessionId = 'judge_pending';
  let presentation: { left: JudgmentPair['left']; right: JudgmentPair['right']; swapped: boolean } | null = null;

  $: pair = pairs[index];
  $: if (pair) presentation = randomize(pair);

  onMount(async () => {
    sessionId = localStorage.getItem('margin-note:session') ?? makeId('judge');
    const response = await fetch('/api/review');
    const data = await response.json();
    pairs = data.pairs;
    loading = false;
  });

  function randomize(item: JudgmentPair) {
    const swapped = Math.random() > 0.5;
    return { left: swapped ? item.right : item.left, right: swapped ? item.left : item.right, swapped };
  }

  async function choose(side: 'left' | 'right'): Promise<void> {
    if (!pair || !presentation) return;
    const winner = presentation[side].id;
    await fetch('/api/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pairId: pair.id,
        suggestionId: pair.suggestionId,
        winner,
        reason,
        category: pair.category,
        sessionId,
        branchId: 'main',
        presentationOrder: [presentation.left.id, presentation.right.id]
      })
    });
    reason = '';
    completed += 1;
    index += 1;
  }

  function skip(): void { reason = ''; index += 1; }
</script>

<svelte:head><title>Blind review — Margin Note</title></svelte:head>

<header class="topbar">
  <a href="/"><span>¶</span><strong>Margin Note</strong></a>
  <div><small>Blind pairwise judge</small><b>{completed} recorded</b></div>
  <a class="back" href="/">Back to draft</a>
</header>

<main>
  {#if loading}
    <section class="empty"><span class="spinner"></span><p>Building blind pairs from the ledger…</p></section>
  {:else if !pair}
    <section class="empty done">
      <span>✓</span>
      <h1>{completed ? 'Review pass complete' : 'No pairs yet'}</h1>
      <p>{completed ? `${completed} raw judgments were written to the ledger.` : 'Generate suggestions in the writing workbench first. Before/after pairs will appear here automatically.'}</p>
      <a href="/">Return to the draft</a>
    </section>
  {:else if presentation}
    <section class="review-head">
      <div>
        <small>Pair {index + 1} of {pairs.length}</small>
        <h1>Which passage better serves the brief?</h1>
      </div>
      <span class="category cat-{pair.category}"><i>{categoryMeta[pair.category].icon}</i>{categoryMeta[pair.category].label}</span>
    </section>

    <section class="brief">
      <header><span>Brief context</span><small>Source identities withheld · order randomized</small></header>
      <dl>
        <div><dt>POV</dt><dd>{pair.brief?.pov}</dd></div>
        <div><dt>Tense</dt><dd>{pair.brief?.tense}</dd></div>
        <div><dt>Distance</dt><dd>{pair.brief?.distance}</dd></div>
      </dl>
    </section>

    <section class="comparison">
      <button on:click={() => choose('left')}>
        <header><span>A</span><small>Choose passage A</small></header>
        <p>{presentation.left.text || '— deletion —'}</p>
        <footer>Prefer A <kbd>←</kbd></footer>
      </button>
      <div class="or">or</div>
      <button on:click={() => choose('right')}>
        <header><span>B</span><small>Choose passage B</small></header>
        <p>{presentation.right.text || '— deletion —'}</p>
        <footer>Prefer B <kbd>→</kbd></footer>
      </button>
    </section>

    <section class="reason">
      <label for="reason">Optional one-line reason <span>qualitative gold</span></label>
      <input id="reason" bind:value={reason} placeholder="A keeps the viewpoint closer without over-explaining…" on:keydown={(event) => { if (event.key === 'ArrowLeft' && event.metaKey) void choose('left'); if (event.key === 'ArrowRight' && event.metaKey) void choose('right'); }} />
      <button on:click={skip}>Skip this pair</button>
    </section>

    <section class="rubric">
      <span>Rubric axes</span>
      {#each categories as category}<i class:focus={category === pair.category}>{categoryMeta[category].label}</i>{/each}
    </section>
  {/if}
</main>

<style>
  :global(body) { background: #eeeae1; }
  .topbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; min-height: 58px; padding: 0 26px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--paper) 92%, transparent); }
  .topbar a:first-child { display: flex; gap: 8px; align-items: baseline; text-decoration: none; }
  .topbar a span { color: var(--accent); font: 700 24px/1 var(--font-reading); }
  .topbar a strong { font-size: 13px; }
  .topbar > div { display: flex; align-items: center; gap: 10px; }
  .topbar small { color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .09em; }
  .topbar b { color: var(--ink-soft); font-size: 10px; }
  .back { justify-self: end; color: var(--ink-soft); font-size: 10px; }
  main { width: min(1080px, calc(100% - 40px)); margin: 0 auto; padding: 48px 0 80px; }
  .review-head { display: flex; justify-content: space-between; align-items: end; }
  .review-head small { color: var(--muted); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .1em; }
  h1 { margin: 8px 0 0; font: 500 27px/1.2 var(--font-reading); }
  .category { --category: var(--cat-diction); display: flex; align-items: center; gap: 7px; border: 1px solid color-mix(in srgb, var(--category) 35%, var(--line)); border-radius: 999px; background: color-mix(in srgb, var(--category) 8%, var(--paper)); padding: 7px 10px; color: var(--ink-soft); font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .category i { color: var(--category); font-style: normal; }
  .cat-pov { --category: var(--cat-pov); } .cat-tense { --category: var(--cat-tense); } .cat-canon { --category: var(--cat-canon); } .cat-cadence { --category: var(--cat-cadence); } .cat-diction { --category: var(--cat-diction); } .cat-distance { --category: var(--cat-distance); }
  .brief { margin-top: 24px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--paper) 60%, transparent); }
  .brief header { display: flex; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .brief header span { font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .09em; }
  .brief header small { color: var(--muted); font-size: 8px; }
  dl { display: grid; grid-template-columns: 1fr 1fr 2fr; margin: 0; }
  dl div { padding: 12px 14px; border-right: 1px solid var(--line); }
  dl div:last-child { border: 0; }
  dt { color: var(--muted); font: 700 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .08em; }
  dd { margin: 5px 0 0; color: var(--ink-soft); font: 11px/1.4 var(--font-ui); }
  .comparison { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin-top: 22px; }
  .comparison > button { display: flex; flex-direction: column; min-height: 300px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); color: var(--ink); padding: 0; text-align: left; box-shadow: 0 13px 40px rgb(39 32 24 / .06); cursor: pointer; overflow: hidden; transition: transform .15s, border-color .15s, box-shadow .15s; }
  .comparison > button:hover { transform: translateY(-2px); border-color: var(--accent); box-shadow: 0 18px 45px rgb(39 32 24 / .11); }
  .comparison header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  .comparison header span { display: grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--line-strong); border-radius: 50%; font: 700 10px/1 var(--font-ui); }
  .comparison header small { color: var(--muted); font-size: 9px; }
  .comparison p { flex: 1; margin: 0; padding: 36px clamp(28px, 4vw, 54px); font: 18px/1.8 var(--font-reading); white-space: pre-wrap; }
  .comparison footer { display: flex; justify-content: flex-end; align-items: center; gap: 8px; padding: 11px 14px; border-top: 1px solid var(--line); color: var(--accent); font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .07em; }
  kbd { border: 1px solid var(--line-strong); border-radius: 3px; padding: 3px 5px; background: var(--paper-deep); color: var(--muted); font: 9px/1 var(--font-mono); }
  .or { position: absolute; z-index: 2; left: 50%; top: 50%; transform: translate(-50%, -50%); display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 50%; background: #eeeae1; color: var(--muted); font: italic 10px/1 var(--font-reading); }
  .reason { display: grid; grid-template-columns: 1fr auto; gap: 7px; margin-top: 20px; }
  .reason label { grid-column: 1 / -1; color: var(--ink-soft); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .07em; }
  .reason label span { color: var(--muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
  .reason input { border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink); padding: 11px 12px; outline: none; font-size: 11px; }
  .reason input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .reason button { border: 1px solid var(--line); border-radius: 3px; background: transparent; color: var(--muted); padding: 0 13px; font-size: 9px; cursor: pointer; }
  .rubric { display: flex; align-items: center; gap: 9px; margin-top: 24px; color: var(--muted); font: 8px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .06em; }
  .rubric i { border-radius: 999px; background: var(--paper-deep); padding: 5px 7px; font-style: normal; opacity: .6; }
  .rubric i.focus { background: var(--accent-soft); color: var(--accent); opacity: 1; font-weight: 700; }
  .empty { display: grid; place-items: center; min-height: 60vh; text-align: center; color: var(--muted); }
  .empty > span { display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid var(--line); border-radius: 50%; color: var(--accept); font-size: 19px; }
  .empty h1 { color: var(--ink); }
  .empty p { max-width: 440px; margin: -60px 0 0; font: 12px/1.6 var(--font-ui); }
  .empty a { border: 1px solid var(--line-strong); border-radius: 3px; background: var(--paper); padding: 9px 13px; color: var(--ink-soft); font-size: 10px; }
  .spinner { border-top-color: var(--accent) !important; animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (max-width: 700px) { .comparison { grid-template-columns: 1fr; } .or { top: 50%; } dl { grid-template-columns: 1fr; } dl div { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
