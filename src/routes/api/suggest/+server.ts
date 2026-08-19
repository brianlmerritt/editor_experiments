import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateSuggestions } from '$lib/server/suggesters';
import type { GenerationRequest } from '$lib/domain';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as GenerationRequest;
  if (typeof body.text !== 'string' || !body.sessionId || !body.branchId) return json({ error: 'Invalid generation request' }, { status: 400 });
  return json(await generateSuggestions(body));
};
