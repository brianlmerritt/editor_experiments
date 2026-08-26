import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { buildProjectArchive } from '$lib/server/project-export';
import { workspaceRepository } from '$lib/server/workspace-store';
import { projectTransferMimeType, type ProjectExportSnapshot } from '$lib/workspace/project-transfer';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const snapshot = await request.json() as ProjectExportSnapshot;
    if (!snapshot?.project?.id || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.contextBuckets)) {
      throw new Error('A complete project snapshot is required');
    }
    const archive = buildProjectArchive(snapshot, workspaceRepository);
    return new Response(Uint8Array.from(archive.bytes).buffer, {
      headers: {
        'content-type': projectTransferMimeType,
        'content-disposition': `attachment; filename="${archive.filename}"`
      }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Project export failed' }, { status: 400 });
  }
};
