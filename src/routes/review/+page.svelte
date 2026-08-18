<script lang="ts">
  import { onMount } from 'svelte';
  import { categoryMeta, categories, makeId, type Category, type JudgmentPair } from '$lib/domain';
  import { workspaceFacade } from '$lib/workspace/facade';

  let pairs = $state<JudgmentPair[]>([]);
  let index = $state(0);
  let reason = $state('');
  let loading = $state(true);
  let completed = $state(0);
  let sessionId = $state('judge_pending');
  let branchId = $state('main');
  let refreshing = $state(false);
  let loadError = $state('');
  let lastRefreshed = $state('');
  let presentedPairId = $state('');
  let presentation = $state<{ left: JudgmentPair['left']; right: JudgmentPair['right']; swapped: boolean } | null>(null);

  let pair = $derived(pairs[index]);
  $effect(() => {
    if (pair && pair.id !== presentedPairId) {
      presentation = randomize(pair);
      presentedPairId = pair.id;
    } else if (!pair) {
      presentation = null;
      presentedPairId = '';
    }
  });

  onMount(() => {
    sessionId = localStorage.getItem('margin-note:session') ?? makeId('judge');
    branchId = localStorage.getItem('margin-note:branch') ?? 'main';
    const refresh = () => void refreshPairs();
    void refreshPairs(true);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 5000);
    return () => {
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  });

  function randomize(item: JudgmentPair) {
    const swapped = Math.random() > 0.5;
    return { left: swapped ? item.right : item.left, right: swapped ? item.left : item.right, swapped };
  }

  async function refreshPairs(initial = false): Promise<void> {
    if (refreshing) return;
    refreshing = true;
    if (initial) loading = true;
    const currentId = pair?.id;
    try {
      const next = await workspaceFacade.reviewPairs({ sessionId, branchId });
      pairs = next;
      const preserved = currentId ? next.findIndex((item) => item.id === currentId) : -1;
      index = preserved >= 0 ? preserved : Math.min(index, Math.max(0, next.length - 1));
      if (!currentId || preserved < 0) presentedPairId = '';
      lastRefreshed = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      loadError = '';
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Could not refresh comparisons';
    } finally {
      refreshing = false;
      loading = false;
    }
  }

  async function choose(side: 'left' | 'right'): Promise<void> {
    if (!pair || !presentation) return;
    const winner = presentation[side].id;
    await workspaceFacade.recordJudgment({
      pairId: pair.id,
      suggestionId: pair.suggestionId,
      winner,
      reason,
      category: pair.category,
      sessionId,
      branchId,
      presentationOrder: [presentation.left.id, presentation.right.id]
    });
    reason = '';
    completed += 1;
    pairs = pairs.filter((item) => item.id !== pair.id);
    index = Math.min(index, Math.max(0, pairs.length - 1));
    presentedPairId = '';
  }

  function navigate(direction: -1 | 1): void {
    index = Math.max(0, Math.min(index + direction, pairs.length - 1));
    reason = '';
    presentedPairId = '';
  }
</script>

<svelte:head><title>Suggestion comparison — Margin Note</title></svelte:head>

<header class="topbar">
  <a href="/"><span>¶</span><strong>Margin Note</strong></a>
  <div><small>Suggestion evaluation</small><b>{pairs.length} pending · {completed} recorded this visit</b></div>
  <a class="back" href="/">Back to draft</a>
</header>

<main>
  <section class="purpose">
    <div><b>What this does</b><p>Compare an unresolved suggestion with the original wording, without source labels, to measure suggestion quality. Choosing A or B records a research judgment; it does not alter the draft.</p></div>
    <div class="refresh"><small>{lastRefreshed ? `Current session and branch · refreshed ${lastRefreshed}` : 'Current session and branch'}</small><button disabled={refreshing} onclick={() => refreshPairs()}>{refreshing ? 'Refreshing…' : 'Refresh queue'}</button></div>
  </section>
  {#if loadError}<p class="load-error">{loadError}</p>{/if}
  {#if loading}
    <section class="empty"><span class="spinner"></span><p>Building the current comparison queue…</p></section>
  {:else if !pair}
    <section class="empty done">
      <span>✓</span>
      <h1>No unresolved comparisons</h1>
      <p>{completed ? `${completed} ${completed === 1 ? 'judgment was' : 'judgments were'} recorded this visit.` : 'Generate replacement suggestions in the writing workbench. This queue refreshes automatically while open.'}</p>
      <a href="/">Return to the draft</a>
    </section>
  {:else if presentation}
    <section class="review-head">
      <div>
        <small>Comparison {index + 1} of {pairs.length}</small>
        <h1>Which passage better serves the brief?</h1>
      </div>
      <div class="review-tools">
        <span class="category cat-{pair.category}"><i>{categoryMeta[pair.category].icon}</i>{categoryMeta[pair.category].label}</span>
        <nav aria-label="Comparison navigation">
          <button disabled={index === 0} onclick={() => navigate(-1)}>← Previous</button>
          <button disabled={index === pairs.length - 1} onclick={() => navigate(1)}>Next →</button>
        </nav>
      </div>
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
      <button onclick={() => choose('left')}>
        <header><span>A</span><small>Choose passage A</small></header>
        <p>{presentation.left.text || '— deletion —'}</p>
        <footer>Prefer A <kbd>←</kbd></footer>
      </button>
      <div class="or">or</div>
      <button onclick={() => choose('right')}>
        <header><span>B</span><small>Choose passage B</small></header>
        <p>{presentation.right.text || '— deletion —'}</p>
        <footer>Prefer B <kbd>→</kbd></footer>
      </button>
    </section>

    <section class="reason">
      <label for="reason">Optional one-line reason <span>qualitative gold</span></label>
      <input id="reason" bind:value={reason} placeholder="A keeps the viewpoint closer without over-explaining…" onkeydown={(event) => { if (event.key === 'ArrowLeft' && event.metaKey) void choose('left'); if (event.key === 'ArrowRight' && event.metaKey) void choose('right'); }} />
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
  .purpose { display: flex; justify-content: space-between; gap: 30px; margin-bottom: 30px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 4px; background: color-mix(in srgb, var(--paper) 60%, transparent); }
  .purpose > div:first-child { max-width: 700px; }
  .purpose b { font: 700 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .09em; }
  .purpose p { margin: 6px 0 0; color: var(--ink-soft); font: 11px/1.5 var(--font-ui); }
  .refresh { display: grid; justify-items: end; align-content: center; gap: 7px; min-width: 230px; }
  .refresh small { color: var(--muted); font: 9px/1.3 var(--font-ui); }
  .refresh button, .review-tools nav button { border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink-soft); padding: 7px 9px; font: 600 9px/1 var(--font-ui); cursor: pointer; }
  .refresh button:disabled, .review-tools nav button:disabled { opacity: .4; cursor: default; }
  .load-error { border-left: 3px solid var(--reject); padding: 8px 10px; color: var(--reject); font: 11px/1.4 var(--font-ui); }
  .review-head { display: flex; justify-content: space-between; align-items: end; }
  .review-tools { display: grid; justify-items: end; gap: 10px; }
  .review-tools nav { display: flex; gap: 6px; }
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
  .reason { display: grid; gap: 7px; margin-top: 20px; }
  .reason label { grid-column: 1 / -1; color: var(--ink-soft); font: 600 9px/1 var(--font-ui); text-transform: uppercase; letter-spacing: .07em; }
  .reason label span { color: var(--muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
  .reason input { border: 1px solid var(--line); border-radius: 3px; background: var(--paper); color: var(--ink); padding: 11px 12px; outline: none; font-size: 11px; }
  .reason input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
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
  @media (max-width: 700px) { .purpose, .review-head { align-items: stretch; flex-direction: column; } .refresh, .review-tools { justify-items: start; } .comparison { grid-template-columns: 1fr; } .or { top: 50%; } dl { grid-template-columns: 1fr; } dl div { border-right: 0; border-bottom: 1px solid var(--line); } }
</style>
