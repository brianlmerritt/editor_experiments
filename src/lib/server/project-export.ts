import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { JsonValue, DocumentRevision, WorkspaceDocument } from '$lib/workspace/model';
import {
  projectTransferFormat,
  projectTransferVersion,
  type ProjectExportMode,
  type ProjectExportSnapshot,
  type ProjectTransferManifest
} from '$lib/workspace/project-transfer';
import type { WorkspaceRepository } from './workspace-store';

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function jsonLine(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value)}\n`);
}

function safeId(value: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`Unsafe project archive identifier: ${value}`);
  return value;
}

export function projectArchiveFilename(title: string, mode: ProjectExportMode = 'compact'): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'project'}${mode === 'forensic' ? '-forensic' : ''}.mnote.zip`;
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

function addJson(zip: Zip, path: string, value: unknown): void {
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  file.push(jsonBytes(value), true);
}

function addDocumentHistory(zip: Zip, path: string, documentId: string, repository: WorkspaceRepository): void {
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  repository.forEachDocumentRevision(documentId, (revision) => file.push(jsonLine(safeRevision(revision))));
  file.push(new Uint8Array(), true);
}

function addContextHistory(zip: Zip, path: string, bucketId: string, repository: WorkspaceRepository): void {
  const file = new ZipDeflate(path, { level: 6 });
  zip.add(file);
  repository.forEachBucketRevision(bucketId, (revision) => file.push(jsonLine(revision)));
  file.push(new Uint8Array(), true);
}

export function createProjectArchive(snapshot: ProjectExportSnapshot, repository: WorkspaceRepository, mode: ProjectExportMode = 'compact'): {
  stream: ReadableStream<Uint8Array>;
  filename: string;
  manifest: ProjectTransferManifest;
} {
  validateSnapshot(snapshot, repository);
  const documents = snapshot.documents.map(safeDocument).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const assets = repository.projectAssets(snapshot.project.id);
  const documentRevisionCount = documents.reduce((total, document) => total + repository.documentRevisionCount(document.id), 0);
  const contextRevisionCount = snapshot.contextBuckets.reduce((total, bucket) => total + repository.bucketRevisionCount(bucket.id), 0);
  const includeHistory = mode === 'forensic';
  const revisionPaths = includeHistory ? documents.map((document) => `revisions/documents/${safeId(document.id)}.jsonl`) : [];
  const contextRevisionPaths = includeHistory ? snapshot.contextBuckets.map((bucket) => `revisions/context/${safeId(bucket.id)}.jsonl`) : [];
  const files = [
    'manifest.json', 'project.json', 'structure.json', 'documents/index.json', 'context/index.json', 'assets/index.json',
    ...documents.map((document) => `documents/${safeId(document.id)}.json`),
    ...revisionPaths,
    ...snapshot.contextBuckets.map((bucket) => `context/${safeId(bucket.id)}.json`),
    ...contextRevisionPaths,
    ...assets.map((asset) => `assets/files/${safeId(asset.id)}`)
  ].sort();
  const manifest: ProjectTransferManifest = {
    format: projectTransferFormat,
    version: projectTransferVersion,
    exportedAt: snapshot.capturedAt,
    producer: { name: 'Margin Note', version: '0.1.0' },
    project: { id: snapshot.project.id, title: snapshot.project.title, revision: snapshot.project.revision },
    exportMode: mode,
    counts: {
      documents: documents.length,
      documentRevisions: includeHistory ? documentRevisionCount : 0,
      contextBuckets: snapshot.contextBuckets.length,
      contextRevisions: includeHistory ? contextRevisionCount : 0,
      assets: assets.length,
      activeRuns: activeRunCount(documents)
    },
    omitted: {
      documentRevisions: includeHistory ? 0 : documentRevisionCount,
      contextRevisions: includeHistory ? 0 : contextRevisionCount
    },
    safety: { providerCredentialsIncluded: false, paidProvidersEnabledOnImport: false },
    files
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      setTimeout(() => {
        try {
          const zip = new Zip((error, data, final) => {
            if (error) {
              controller.error(error);
              return;
            }
            if (data.length) controller.enqueue(data);
            if (final) controller.close();
          });
          const projectExtensions = { ...snapshot.project.extensions };
          const navigator = projectExtensions.navigator ?? null;
          delete projectExtensions.navigator;
          addJson(zip, 'manifest.json', manifest);
          addJson(zip, 'project.json', { ...snapshot.project, extensions: projectExtensions });
          addJson(zip, 'structure.json', { navigator });
          addJson(zip, 'documents/index.json', documents.map(({ content: _content, extensions: _extensions, ...document }) => document));
          addJson(zip, 'context/index.json', snapshot.contextBuckets);
          addJson(zip, 'assets/index.json', assets);
          for (const document of documents) {
            const id = safeId(document.id);
            addJson(zip, `documents/${id}.json`, document);
            if (includeHistory) addDocumentHistory(zip, `revisions/documents/${id}.jsonl`, document.id, repository);
          }
          for (const bucket of snapshot.contextBuckets) {
            const id = safeId(bucket.id);
            addJson(zip, `context/${id}.json`, bucket);
            if (includeHistory) addContextHistory(zip, `revisions/context/${id}.jsonl`, bucket.id, repository);
          }
          for (const asset of assets) {
            const file = new ZipPassThrough(`assets/files/${safeId(asset.id)}`);
            zip.add(file);
            file.push(new Uint8Array(repository.asset(asset.id).content), true);
          }
          zip.end();
        } catch (error) {
          controller.error(error);
        }
      }, 0);
    }
  });
  return { stream, filename: projectArchiveFilename(snapshot.project.title, mode), manifest };
}
