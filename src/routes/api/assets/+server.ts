import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { workspaceRepository } from '$lib/server/workspace-store';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const form = await request.formData();
    const projectId = form.get('projectId');
    const file = form.get('file');
    if (typeof projectId !== 'string' || !projectId) return json({ error: 'Asset project is required' }, { status: 400 });
    if (!(file instanceof File)) return json({ error: 'Image file is required' }, { status: 400 });
    if (!file.type.startsWith('image/')) return json({ error: 'Only image assets are supported' }, { status: 400 });
    const asset = workspaceRepository.createAsset(projectId, file.name, file.type, Buffer.from(await file.arrayBuffer()));
    return json({ asset }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Asset upload failed';
    return json({ error: message }, { status: /not found/i.test(message) ? 404 : 400 });
  }
};
