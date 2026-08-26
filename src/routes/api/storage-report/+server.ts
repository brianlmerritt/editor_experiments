import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workspaceRepository } from '$lib/server/workspace-store';

export const GET: RequestHandler = ({ url }) => {
  try {
    return json(workspaceRepository.storageAnalysis(url.searchParams.get('project') ?? undefined));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storage analysis failed';
    return json({ error: message }, { status: /not found/i.test(message) ? 404 : 400 });
  }
};
