import { describe, expect, it, vi } from 'vitest';
import type { Branch, LedgerEvent, TaskPrompt, WritingBrief } from '$lib/domain';
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
const branches: Branch[] = [{ id: 'main', name: 'Main', createdAt: '2026-08-17T00:00:00Z', wordCount: 10, lastEdited: '2026-08-17T00:00:00Z' }];
const events: Required<LedgerEvent>[] = [{ id: 1, timestamp: '2026-08-17T00:00:00Z', type: 'session_started', sessionId: 'session', branchId: 'main', suggestionId: '', payload: {} }];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('WorkspaceFacade', () => {
  it('assembles workspace state without exposing endpoint response shapes', async () => {
    const fetcher = vi.fn<FetchLike>(async (input) => {
      const path = String(input);
      if (path === '/api/settings') return json({ brief, prompts });
      if (path === '/api/branches') return json({ branches });
      if (path === '/api/events?limit=45') return json({ events, stats: { events: 1, costUsd: 0.25 } });
      return json({ error: 'unexpected path' }, 404);
    });

    const result = await new WorkspaceFacade(fetcher).load();

    expect(result).toEqual({ brief, prompts, branches, events, stats: { events: 1, costUsd: 0.25 } });
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
