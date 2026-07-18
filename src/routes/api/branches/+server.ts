import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvent, getBranches } from '$lib/server/ledger';

export const GET: RequestHandler = () => json({ branches: getBranches() });

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as { id: string; name: string; parentId: string; wordCount: number; sessionId: string };
  appendEvent({ type: 'branch_forked', sessionId: body.sessionId, branchId: body.id, payload: { name: body.name, parentId: body.parentId, wordCount: body.wordCount } });
  return json({ branches: getBranches() }, { status: 201 });
};
