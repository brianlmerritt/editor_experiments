import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { inspectProjectArchive } from '$lib/server/project-import';
import { workspaceRepository } from '$lib/server/workspace-store';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const form = await request.formData();
    const action = form.get('action');
    const file = form.get('file');
    if (action !== 'inspect' && action !== 'import') throw new Error('Project import action must be inspect or import');
    if (!(file instanceof File)) throw new Error('Choose a .mnote.zip project archive');
    if (!file.name.toLowerCase().endsWith('.mnote.zip')) throw new Error('Project imports must use a .mnote.zip archive');
    const candidate = inspectProjectArchive(new Uint8Array(await file.arrayBuffer()));
    if (action === 'inspect') return json({ preview: candidate.preview });
    const imported = workspaceRepository.importProject(candidate.input);
    return json({
      workspace: workspaceRepository.workspace(),
      projectId: imported.project.id,
      documentIds: imported.documents.map((document) => document.id),
      preview: candidate.preview
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Project import failed';
    return json({ error: message }, { status: 400 });
  }
};
