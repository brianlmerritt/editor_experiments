import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvents } from '$lib/server/ledger';
import { generateSuggestions } from '$lib/server/suggesters';
import type { GenerationRequest, LedgerEvent } from '$lib/domain';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as GenerationRequest;
  if (typeof body.text !== 'string' || !body.sessionId || !body.branchId) return json({ error: 'Invalid generation request' }, { status: 400 });
  const result = await generateSuggestions(body);
  const events: LedgerEvent[] = result.suggestions.map((suggestion) => ({
    type: suggestion.state === 'hidden' ? 'generated_hidden' : 'suggestion_generated',
    sessionId: body.sessionId,
    branchId: body.branchId,
    suggestionId: suggestion.id,
    payload: { suggestion }
  }));
  appendEvents(events);
  return json(result);
};
