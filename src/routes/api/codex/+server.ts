import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { codexAppServer } from '$lib/server/codex-app-server';

export const GET: RequestHandler = async () => json(
  { status: await codexAppServer().status() },
  { headers: { 'cache-control': 'no-store' } }
);

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as { kind?: unknown };
  if (body.kind !== 'login') return json({ error: 'Unsupported Codex app-server action.' }, { status: 400 });
  try {
    return json({ login: await codexAppServer().startChatGptLogin() }, { status: 201 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not start ChatGPT sign-in.' }, { status: 503 });
  }
};
