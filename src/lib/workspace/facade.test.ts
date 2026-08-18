import { describe, expect, it, vi } from 'vitest';
import type { Branch, LedgerEvent, TaskPrompt, WritingBrief } from '$lib/domain';
import type { PersistentWorkspace } from '$lib/workspace/model';
import { WorkspaceFacade, type FetchLike } from './facade';

const brief: WritingBrief = {
  version: 2,
  form: 'fiction',
  pov: 'third person',
  tense: 'past',
  distance: 'close',
  canon: 'The moon is dark.'
};
const prompts: TaskPrompt[] = [{ id: 'review', name: 'Review', version: 1, instruction: 'Review it.' }];
const sourceAvailability = {
  'local-craft': { available: true },
  'fake-sentinel': { available: true },
  openrouter: { available: false, reason: 'Configure OpenRouter.' },
  ollama: { available: false, reason: 'Configure Ollama.' }
};
const branches: Branch[] = [{ id: 'main', name: 'Main draft', createdAt: '2026-08-17T00:00:00Z', wordCount: 10, lastEdited: '2026-08-17T00:00:00Z' }];
const events: Required<LedgerEvent>[] = [{ id: 1, timestamp: '2026-08-17T00:00:00Z', type: 'session_started', sessionId: 'session', branchId: 'main', suggestionId: '', payload: {} }];
const persistent: PersistentWorkspace = {
  projects: [{ id: 'project', title: 'Moon Dark', revision: 1, extensions: {}, updatedAt: '2026-08-17T00:00:00Z' }],
  documents: [{ id: 'main', projectId: 'project', parentId: null, title: 'Main draft', order: 0, revision: 1, role: 'manuscript', extensions: {}, kind: 'document', content: 'Ten words live in this persistent draft today, all told.', updatedAt: '2026-08-17T00:00:00Z' }],
  contextBuckets: []
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('WorkspaceFacade', () => {
  it('assembles workspace state without exposing endpoint response shapes', async () => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const path = String(input);
      if (path === '/api/workspace') return json(persistent);
      if (path === '/api/settings') return json({ brief, prompts, sourceAvailability });
      if (path === '/api/events?history=suggestions&branch=main') return json({ events, stats: { events: 1, costUsd: 0.25 } });
      return json({ error: 'unexpected path' }, 404);
    });

    const result = await new WorkspaceFacade(fetcher).load();

    expect(result).toEqual({
      brief,
      prompts,
      branches,
      events,
      stats: { events: 1, costUsd: 0.25 },
      persistent,
      activeProjectId: 'project',
      activeDocumentId: 'main',
      sourceAvailability
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('passes abort signals through suggestion requests', async () => {
    const fetcher = vi.fn<FetchLike>(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return json({ suggestions: [], errors: [] });
    });
    const controller = new AbortController();
    const facade = new WorkspaceFacade(fetcher);

    const result = await facade.suggestions({
      text: 'Text',
      from: 1,
      to: 5,
      branchId: 'main',
      sessionId: 'session',
      brief,
      prompt: prompts[0],
      sourceStates: {},
      mode: 'drafting'
    }, controller.signal);

    expect(result).toEqual({ suggestions: [], errors: [] });
  });

  it('sends OpenRouter credentials only to the provider settings endpoint', async () => {
    const fetcher = vi.fn<FetchLike>(async (input, init) => {
      expect(String(input)).toBe('/api/settings');
      expect(JSON.parse(String(init?.body))).toEqual({
        kind: 'provider',
        source: 'openrouter',
        key: 'secret-key',
        model: 'provider/model'
      });
      return json({ sourceAvailability: { openrouter: { available: true, model: 'provider/model' } } });
    });

    const result = await new WorkspaceFacade(fetcher).configureOpenRouter('secret-key', 'provider/model');

    expect(result.openrouter).toEqual({ available: true, model: 'provider/model' });
  });

  it('surfaces a server error instead of leaking a JSON parsing failure', async () => {
    const fetcher: FetchLike = async () => json({ error: 'Invalid generation request' }, 400);
    await expect(new WorkspaceFacade(fetcher).reviewPairs()).rejects.toThrow('Invalid generation request');
  });

  it('scopes comparison pairs to the active session and branch', async () => {
    const fetcher = vi.fn<FetchLike>(async () => json({ pairs: [] }));
    await new WorkspaceFacade(fetcher).reviewPairs({ sessionId: 'session 1', branchId: 'branch/main' });
    expect(fetcher).toHaveBeenCalledWith('/api/review?session=session+1&branch=branch%2Fmain');
  });

  it('returns an exported blob with the server-selected filename', async () => {
    const fetcher: FetchLike = async () => new Response('Story', {
      headers: { 'content-disposition': 'attachment; filename="moon-dark.md"' }
    });
    const result = await new WorkspaceFacade(fetcher).exportMarkdown({
      markdown: 'Story',
      title: 'Moon Dark',
      sessionId: 'session',
      branchId: 'main'
    });

    expect(result.filename).toBe('moon-dark.md');
    expect(await result.blob.text()).toBe('Story');
  });
});
