import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { ExtensionData } from '$lib/workspace/model';
import { getBranches } from '$lib/server/ledger';
import {
  workspaceRepository,
  type CreateContextBucketInput,
  type CreateDocumentInput,
  type SaveContextBucketInput,
  type SaveDocumentInput
} from '$lib/server/workspace-store';

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Workspace request failed';
  const missing = /not found/i.test(message);
  return json({ error: message }, { status: missing ? 404 : 400 });
}

function inputObject(body: Record<string, unknown>): Record<string, unknown> {
  if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input)) throw new Error('Workspace input is required');
  return body.input as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string, label: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

export const GET: RequestHandler = ({ url }) => {
  try {
    const documentId = url.searchParams.get('document');
    const bucketId = url.searchParams.get('bucket');
    if (documentId) return json({ revisions: workspaceRepository.documentRevisions(documentId) });
    if (bucketId) return json({ revisions: workspaceRepository.bucketRevisions(bucketId) });
    return json(workspaceRepository.workspace(getBranches()));
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as { action?: string; sessionId?: string } & Record<string, unknown>;
    switch (body.action) {
      case 'create_project':
        if (typeof body.title !== 'string' || !body.title.trim()) throw new Error('Project title is required');
        return json({ project: workspaceRepository.createProject(body.title) }, { status: 201 });
      case 'save_project':
        if (typeof body.id !== 'string' || typeof body.title !== 'string' || !body.title.trim()) throw new Error('Project ID and title are required');
        if (body.extensions !== undefined && (typeof body.extensions !== 'object' || body.extensions === null || Array.isArray(body.extensions))) {
          throw new Error('Project extensions must be an object');
        }
        return json({ project: workspaceRepository.saveProject(body.id, body.title, body.extensions as ExtensionData | undefined) });
      case 'create_document':
      {
        const input = inputObject(body);
        requiredString(input, 'projectId', 'Document project');
        requiredString(input, 'title', 'Document title');
        return json({ document: workspaceRepository.createDocument(input as unknown as CreateDocumentInput) }, { status: 201 });
      }
      case 'save_document': {
        const input = inputObject(body);
        requiredString(input, 'id', 'Document ID');
        return json({ document: workspaceRepository.saveDocument(input as unknown as SaveDocumentInput) });
      }
      case 'restore_document':
        if (typeof body.documentId !== 'string' || typeof body.revisionId !== 'string') throw new Error('Document and revision IDs are required');
        return json({ document: workspaceRepository.restoreDocument(body.documentId, body.revisionId, body.sessionId) });
      case 'create_bucket':
      {
        const input = inputObject(body);
        requiredString(input, 'projectId', 'Context project');
        requiredString(input, 'title', 'Context title');
        if (input.scope !== 'project' && input.scope !== 'document') throw new Error('Context scope must be project or document');
        return json({ bucket: workspaceRepository.createBucket(input as unknown as CreateContextBucketInput) }, { status: 201 });
      }
      case 'save_bucket': {
        const input = inputObject(body);
        requiredString(input, 'id', 'Context bucket ID');
        return json({ bucket: workspaceRepository.saveBucket(input as unknown as SaveContextBucketInput) });
      }
      case 'delete_bucket':
        if (typeof body.id !== 'string') throw new Error('Context bucket ID is required');
        workspaceRepository.deleteBucket(body.id);
        return json({ ok: true });
      default:
        return json({ error: 'Unknown workspace action' }, { status: 400 });
    }
  } catch (error) {
    return errorResponse(error);
  }
};
