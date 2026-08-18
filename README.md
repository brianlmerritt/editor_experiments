# Margin Note

Margin Note is a meta-first creative writing support POC. The live draft uses local
Yjs persistence and is also saved as immutable SQLite document versions. Suggestions
are ProseMirror decorations that never mutate it, and every meaningful interaction is
appended to a SQLite ledger.

The deliberately small façade and adaptable Codex direction are described in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Run it

Requirements: Node 22+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. No API keys are required: the local craft checks
and deterministic replay sentinel are enabled by default.

For a quick tour:

1. Click **Run craft pass** while in Drafting mode.
2. Open **Revising** to see the decorations and review margin.
3. Preview a replacement, accept/reject it, or use `Tab`, `1`–`3`, `Enter`, `E`, and
   `X` for keyboard review.
4. Open **Ledger** to verify the instrumentation.
5. Visit **Compare** to evaluate current unresolved alternatives against the original wording. This records blind research judgments; it does not edit the draft.
6. Open **Context** to edit the carried-forward narrative rules or add freely named
   project- and document-scoped knowledge buckets.

## Optional providers

Copy `.env.example` to `.env` and configure either OpenRouter or Ollama. Provider
sources start **off** even when configured; click their source buttons to return them
to visible before dispatching.

OpenRouter uses `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. Ollama uses
`OLLAMA_MODEL` and, optionally, `OLLAMA_BASE_URL` (default
`http://127.0.0.1:11434/v1`). Both are called only from SvelteKit server routes.

## Persistence

- Live draft branches: browser IndexedDB keys named `margin-note:<document-id>`.
- Projects, durable documents, immutable document/context versions, and the event
  ledger: `data/writing-ledger.sqlite` by default.
- Existing browser-only drafts are adopted into the durable document on first load.
- Pending and resolved suggestions are reconstructed from the ledger after reload.
- Change the ledger location with `LEDGER_PATH`.
- Markdown export is available from the document toolbar.

## Checks

```bash
npm run check
npm run build
```

The explicitly deferred items in §9 of [PLAN.md](./PLAN.md)—live multi-user sync,
branch comparison, DAG charts, Elo computation, whole-draft audits, and the in-context
variant carousel—remain architectural seams rather than POC features.
