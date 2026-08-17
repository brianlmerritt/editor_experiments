import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvent, reviewPairs } from '$lib/server/ledger';

export const GET: RequestHandler = ({ url }) => json({ pairs: reviewPairs(
  url.searchParams.get('session') ?? undefined,
  url.searchParams.get('branch') ?? undefined
) });

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as { pairId: string; suggestionId: string; winner: string; reason: string; category: string; sessionId: string; branchId: string; presentationOrder: string[] };
  const event = appendEvent({ type: 'judgment_recorded', sessionId: body.sessionId, branchId: body.branchId, suggestionId: body.suggestionId, payload: body });
  return json({ event }, { status: 201 });
};
