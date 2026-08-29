<script lang="ts">
  import type { LedgerEvent } from '$lib/domain';
  let { events = [], costUsd = 0, codexTokens = 0 }: { events?: Required<LedgerEvent>[]; costUsd?: number; codexTokens?: number } = $props();
</script>

<section class="ledger">
  <header><span>Ledger tail</span><span>{events.length} shown · ${costUsd.toFixed(4)} · {(codexTokens / 1_000_000).toFixed(3)}M Codex tokens</span></header>
  <div class="rows">
    {#if !events.length}<p>No events yet.</p>{/if}
    {#each events as event}
      <article>
        <time>{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
        <strong>{event.type}</strong>
        <code>{event.suggestionId || event.branchId}</code>
      </article>
    {/each}
  </div>
</section>

<style>
  .ledger { border: 1px solid #29342f; border-radius: 4px; overflow: hidden; background: #17201d; color: #dbe5df; font: 11px/1.4 var(--font-mono); }
  header { display: flex; justify-content: space-between; padding: 9px 11px; border-bottom: 1px solid #34413c; color: #aab9b2; text-transform: uppercase; letter-spacing: .08em; }
  .rows { max-height: 260px; overflow: auto; }
  article { display: grid; grid-template-columns: 64px 1fr 92px; gap: 8px; padding: 6px 11px; border-bottom: 1px solid #25302c; }
  time, code { color: #84968e; }
  strong { color: #dce7e1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
  code { overflow: hidden; text-overflow: ellipsis; }
  p { padding: 12px; margin: 0; color: #84968e; }
</style>
