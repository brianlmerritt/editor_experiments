import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendEvent, getBrief, getPrompts } from '$lib/server/ledger';
import type { TaskPrompt, WritingBrief } from '$lib/domain';

export const GET: RequestHandler = () => json({ brief: getBrief(), prompts: getPrompts() });

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json()) as { kind: 'brief' | 'prompt'; value: WritingBrief | TaskPrompt; sessionId: string; branchId: string };
  const type = body.kind === 'brief' ? 'brief_updated' : 'prompt_updated';
  const event = appendEvent({ type, sessionId: body.sessionId, branchId: body.branchId, payload: body.value });
  return json({ event, brief: getBrief(), prompts: getPrompts() }, { status: 201 });
};
