import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvent, tailEvents, ledgerStats } from '$lib/server/ledger';
import type { LedgerEvent } from '$lib/domain';

export const GET: RequestHandler = ({ url }) => {
  const limit = Number(url.searchParams.get('limit') ?? 40);
  const branch = url.searchParams.get('branch') ?? undefined;
  return json({ events: tailEvents(limit, branch), stats: ledgerStats() });
};

export const POST: RequestHandler = async ({ request }) => {
  const event = (await request.json()) as LedgerEvent;
  if (!event.type || !event.sessionId || !event.branchId) return json({ error: 'Invalid ledger event' }, { status: 400 });
  return json({ event: appendEvent(event) }, { status: 201 });
};
