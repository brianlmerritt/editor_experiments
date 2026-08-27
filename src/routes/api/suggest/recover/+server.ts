import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { GenerationRequest, InputError } from '$lib/domain';
import { recoverSuggestions } from '$lib/server/suggesters';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as { request?: GenerationRequest; errors?: InputError[] };
  if (!body.request || typeof body.request.text !== 'string' || !body.request.sessionId || !body.request.branchId || !Array.isArray(body.errors)) {
    return json({ error: 'Invalid retained-response recovery request' }, { status: 400 });
  }
  return json(recoverSuggestions(body.request, body.errors));
};
