import { strToU8, zipSync } from 'fflate';
import type { JsonValue, DocumentRevision, ContextBucketRevision, WorkspaceDocument } from '$lib/workspace/model';
import {
  projectTransferFormat,
  projectTransferVersion,
  type ProjectExportSnapshot,
  type ProjectTransferManifest
} from '$lib/workspace/project-transfer';
import type { WorkspaceRepository } from './workspace-store';

type ArchiveFiles = Record<string, Uint8Array>;

function jsonFile(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Unsafe project archive identifier: ${value}`);
  return value;
}

export function projectArchiveFilename(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'project'}.mnote`;
}

function disableProviderSources(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(disableProviderSources);
  if (!value || typeof value !== 'object') return value;
  const record = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, disableProviderSources(child)])) as Record<string, JsonValue>;
  const marginNote = record.margin_note;
  if (marginNote && typeof marginNote === 'object' && !Array.isArray(marginNote)) {
    const sourceStates = marginNote.sourceStates;
    if (sourceStates && typeof sourceStates === 'object' && !Array.isArray(sourceStates)) {
      marginNote.sourceStates = Object.fromEntries(Object.keys(sourceStates).map((sourceId) => [
        sourceId,
        sourceId === 'local-craft' || sourceId === 'fake-sentinel' ? sourceStates[sourceId] : 'off'
      ]));
    }
  }
  return record;
}

function safeDocument(document: WorkspaceDocument): WorkspaceDocument {
  return { ...document, extensions: disableProviderSources(document.extensions) as WorkspaceDocument['extensions'] };
}

function safeRevision(revision: DocumentRevision): DocumentRevision {
  return { ...revision, extensions: disableProviderSources(revision.extensions) as DocumentRevision['extensions'] };
}

function activeRunCount(documents: WorkspaceDocument[]): number {
  return documents.reduce((total, document) => {
    const marginNote = document.extensions.margin_note;
    if (!marginNote || typeof marginNote !== 'object' || Array.isArray(marginNote) || !Array.isArray(marginNote.runs)) return total;
    return total + marginNote.runs.filter((run) => run && typeof run === 'object' && !Array.isArray(run)
      && (run.state === 'queued' || run.state === 'running')).length;
  }, 0);
}

function validateSnapshot(snapshot: ProjectExportSnapshot, repository: WorkspaceRepository): void {
  const durable = repository.workspace();
  if (!durable.projects.some((project) => project.id === snapshot.project.id)) throw new Error('Project not found');
  const durableDocumentIds = new Set(durable.documents.filter((document) => document.projectId === snapshot.project.id).map((document) => document.id));
  const durableBucketIds = new Set(durable.contextBuckets.filter((bucket) => bucket.projectId === snapshot.project.id).map((bucket) => bucket.id));
  if (snapshot.documents.some((document) => document.projectId !== snapshot.project.id || !durableDocumentIds.has(document.id))) {
    throw new Error('Project export contains an unknown document');
  }
  if (snapshot.contextBuckets.some((bucket) => bucket.projectId !== snapshot.project.id || !durableBucketIds.has(bucket.id))) {
    throw new Error('Project export contains an unknown context bucket');
  }
}

export function buildProjectArchive(snapshot: ProjectExportSnapshot, repository: WorkspaceRepository): {
  bytes: Uint8Array;
  filename: string;
  manifest: ProjectTransferManifest;
} {
  validateSnapshot(snapshot, repository);
  const documents = snapshot.documents.map(safeDocument).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const documentRevisions = new Map<string, DocumentRevision[]>();
  const contextRevisions = new Map<string, ContextBucketRevision[]>();
  for (const document of documents) documentRevisions.set(document.id, repository.documentRevisions(document.id).map(safeRevision));
  for (const bucket of snapshot.contextBuckets) contextRevisions.set(bucket.id, repository.bucketRevisions(bucket.id));
  const assets = repository.projectAssets(snapshot.project.id);

  const navigator = snapshot.project.extensions.navigator ?? null;
  const projectExtensions = { ...snapshot.project.extensions };
  delete projectExtensions.navigator;
  const files: ArchiveFiles = {
    'project.json': jsonFile({ ...snapshot.project, extensions: projectExtensions }),
    'structure.json': jsonFile({ navigator }),
    'documents/index.json': jsonFile(documents.map(({ content: _content, extensions: _extensions, ...document }) => document)),
    'context/index.json': jsonFile(snapshot.contextBuckets),
    'assets/index.json': jsonFile(assets)
  };
  for (const document of documents) {
    const id = safeId(document.id);
    files[`documents/${id}.json`] = jsonFile(document);
    files[`revisions/documents/${id}.json`] = jsonFile(documentRevisions.get(document.id));
  }
  for (const bucket of snapshot.contextBuckets) {
    const id = safeId(bucket.id);
    files[`context/${id}.json`] = jsonFile({ bucket, revisions: contextRevisions.get(bucket.id) });
  }
  for (const asset of assets) {
    const stored = repository.asset(asset.id);
    files[`assets/files/${safeId(asset.id)}`] = new Uint8Array(stored.content);
  }

  const allFiles = ['manifest.json', ...Object.keys(files)].sort();
  const manifest: ProjectTransferManifest = {
    format: projectTransferFormat,
    version: projectTransferVersion,
    exportedAt: snapshot.capturedAt,
    producer: { name: 'Margin Note', version: '0.1.0' },
    project: { id: snapshot.project.id, title: snapshot.project.title, revision: snapshot.project.revision },
    counts: {
      documents: documents.length,
      documentRevisions: [...documentRevisions.values()].reduce((total, revisions) => total + revisions.length, 0),
      contextBuckets: snapshot.contextBuckets.length,
      contextRevisions: [...contextRevisions.values()].reduce((total, revisions) => total + revisions.length, 0),
      assets: assets.length,
      activeRuns: activeRunCount(documents)
    },
    safety: { providerCredentialsIncluded: false, paidProvidersEnabledOnImport: false },
    files: allFiles
  };
  files['manifest.json'] = jsonFile(manifest);
  return {
    bytes: zipSync(files, { level: 6 }),
    filename: projectArchiveFilename(snapshot.project.title),
    manifest
  };
}
