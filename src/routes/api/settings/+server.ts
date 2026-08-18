import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvent, getBrief, getPrompts } from '$lib/server/ledger';
import { configureSuggestionProvider, suggestionSourceAvailability } from '$lib/server/suggesters';
import type { TaskPrompt, WritingBrief } from '$lib/domain';

export const GET: RequestHandler = () => json(
  {
    brief: getBrief(),
    prompts: getPrompts(),
    sourceAvailability: suggestionSourceAvailability()
  },
  { headers: { 'cache-control': 'no-store' } }
);

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as
    | { kind: 'brief' | 'prompt'; value: WritingBrief | TaskPrompt; sessionId: string; branchId: string }
    | { kind: 'provider'; source: 'openrouter'; key?: string; model: string };
  if (body.kind === 'provider') {
    try {
      configureSuggestionProvider(body);
      return json({ sourceAvailability: suggestionSourceAvailability() }, { status: 201 });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Provider configuration failed' }, { status: 400 });
    }
  }
  const type = body.kind === 'brief' ? 'brief_updated' : 'prompt_updated';
  const event = appendEvent({ type, sessionId: body.sessionId, branchId: body.branchId, payload: body.value });
  return json({ event, brief: getBrief(), prompts: getPrompts() }, { status: 201 });
};
