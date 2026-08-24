import type { RequestHandler } from './$types';
import { workspaceRepository } from '$lib/server/workspace-store';

export const GET: RequestHandler = ({ params }) => {
  try {
    const { asset, content } = workspaceRepository.asset(params.id);
    return new Response(Uint8Array.from(content).buffer, {
      headers: {
        'content-type': asset.mimeType,
        'content-length': String(asset.byteSize),
        'cache-control': 'private, max-age=31536000, immutable',
        'content-disposition': `inline; filename="${asset.fileName.replaceAll('"', '')}"`
      }
    });
  } catch {
    return new Response('Asset not found', { status: 404 });
  }
};
