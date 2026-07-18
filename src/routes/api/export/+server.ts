import type { RequestHandler } from './$types';
import { appendEvent } from '$lib/server/ledger';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json() as { markdown: string; title?: string; sessionId: string; branchId: string };
  appendEvent({ type: 'markdown_exported', sessionId: body.sessionId, branchId: body.branchId, payload: { title: body.title ?? 'draft', characters: body.markdown.length } });
  const filename = `${(body.title ?? 'draft').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'draft'}.md`;
  return new Response(body.markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`
    }
  });
};
