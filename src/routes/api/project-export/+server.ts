import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createProjectArchive } from '$lib/server/project-export';
import { workspaceRepository } from '$lib/server/workspace-store';
import { projectTransferMimeType, type ProjectExportMode, type ProjectExportSnapshot } from '$lib/workspace/project-transfer';

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const requestedMode = url.searchParams.get('mode') ?? 'compact';
    if (requestedMode !== 'compact' && requestedMode !== 'forensic') throw new Error('Unknown project export mode');
    const mode: ProjectExportMode = requestedMode;
    const snapshot = await request.json() as ProjectExportSnapshot;
    if (!snapshot?.project?.id || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.contextBuckets)) {
      throw new Error('A complete project snapshot is required');
    }
    const archive = createProjectArchive(snapshot, workspaceRepository, mode);
    return new Response(archive.stream, {
      headers: {
        'content-type': projectTransferMimeType,
        'content-disposition': `attachment; filename="${archive.filename}"`
      }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Project export failed' }, { status: 400 });
  }
};
