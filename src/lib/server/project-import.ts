import { strFromU8, unzipSync } from 'fflate';
import type { JsonValue, ContextBucket, ExtensionData, WorkspaceAsset, WorkspaceDocument, WorkspaceProject } from '$lib/workspace/model';
import {
  projectTransferFormat,
  projectTransferVersion,
  type ProjectImportPreview
} from '$lib/workspace/project-transfer';
import type { ImportProjectInput } from './workspace-store';

const maximumArchiveBytes = 128 * 1024 * 1024;
const maximumExpandedBytes = 512 * 1024 * 1024;
const maximumEntries = 10_000;

export interface ProjectImportCandidate {
  preview: ProjectImportPreview;
  input: ImportProjectInput;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`);
  return Number(value);
}

function safePath(path: string): boolean {
  return Boolean(path)
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every((part) => part && part !== '.' && part !== '..');
}

function safeId(value: string, label: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`${label} contains an unsafe identifier`);
  return value;
}

function readJson(files: Record<string, Uint8Array>, path: string): unknown {
  const bytes = files[path];
  if (!bytes) throw new Error(`Project archive is missing ${path}`);
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

function extensionData(value: unknown, label: string): ExtensionData {
  return object(value, label) as ExtensionData;
}

function sanitizeImportedValue(value: JsonValue, importedAt: string): JsonValue {
  if (Array.isArray(value)) return value.map((child) => sanitizeImportedValue(child, importedAt));
  if (!value || typeof value !== 'object') return value;
  const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeImportedValue(child, importedAt)])) as Record<string, JsonValue>;
  const marginNote = result.margin_note;
  if (!marginNote || typeof marginNote !== 'object' || Array.isArray(marginNote)) return result;
  const sourceStates = marginNote.sourceStates;
  if (sourceStates && typeof sourceStates === 'object' && !Array.isArray(sourceStates)) {
    marginNote.sourceStates = Object.fromEntries(Object.entries(sourceStates).map(([sourceId, state]) => [
      sourceId,
      sourceId === 'local-craft' || sourceId === 'fake-sentinel' ? state : 'off'
    ]));
  }
  if (Array.isArray(marginNote.runs)) {
    marginNote.runs = marginNote.runs.map((run) => {
      if (!run || typeof run !== 'object' || Array.isArray(run) || (run.state !== 'queued' && run.state !== 'running')) return run;
      const proposalIds = Array.isArray(run.proposalIds) ? run.proposalIds : [];
      const errors = Array.isArray(run.errors) ? run.errors : [];
      return {
        ...run,
        state: proposalIds.length ? 'partial' : 'failed',
        errors: [...errors, {
          source: 'project_import',
          kind: 'provider_request',
          classification: 'interrupted',
          recoveryAction: 'retry_transient',
          recovered: false,
          message: 'This run was active when the project archive was created and was not resumed on import.'
        }],
        completedAt: importedAt
      };
    });
  }
  if (Array.isArray(marginNote.activities)) {
    marginNote.activities = marginNote.activities.map((activity) => activity && typeof activity === 'object' && !Array.isArray(activity) && activity.state === 'running'
      ? { ...activity, state: 'partial', completedAt: importedAt }
      : activity);
  }
  return result;
}

function documentRecord(value: unknown, sourceProjectId: string, importedAt: string): WorkspaceDocument {
  const record = object(value, 'Imported document');
  const id = safeId(string(record.id, 'Imported document ID'), 'Imported document');
  const projectId = string(record.projectId, `Document ${id} project`);
  if (projectId !== sourceProjectId) throw new Error(`Document ${id} belongs to another project`);
  const parentId = record.parentId === null ? null : safeId(string(record.parentId, `Document ${id} parent`), `Document ${id} parent`);
  const role = record.role === undefined ? undefined : string(record.role, `Document ${id} role`);
  return {
    id,
    projectId,
    parentId,
    title: string(record.title, `Document ${id} title`),
    order: integer(record.order, `Document ${id} order`),
    revision: integer(record.revision, `Document ${id} revision`),
    ...(role ? { role } : {}),
    extensions: sanitizeImportedValue(extensionData(record.extensions, `Document ${id} extensions`), importedAt) as ExtensionData,
    kind: 'document',
    content: typeof record.content === 'string' ? record.content : (() => { throw new Error(`Document ${id} content must be text`); })(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : importedAt
  };
}

function contextRecord(value: unknown, sourceProjectId: string, documentIds: Set<string>, importedAt: string): ContextBucket {
  const record = object(value, 'Imported context');
  const id = safeId(string(record.id, 'Imported context ID'), 'Imported context');
  const projectId = string(record.projectId, `Context ${id} project`);
  if (projectId !== sourceProjectId) throw new Error(`Context ${id} belongs to another project`);
  if (record.scope !== 'project' && record.scope !== 'document') throw new Error(`Context ${id} has an invalid scope`);
  const documentId = record.documentId === null ? null : safeId(string(record.documentId, `Context ${id} document`), `Context ${id} document`);
  if (record.scope === 'project' && documentId) throw new Error(`Project context ${id} cannot target a document`);
  if (record.scope === 'document' && (!documentId || !documentIds.has(documentId))) throw new Error(`Context ${id} targets an unknown document`);
  const role = record.role === undefined ? undefined : string(record.role, `Context ${id} role`);
  return {
    id,
    projectId,
    documentId,
    scope: record.scope,
    title: string(record.title, `Context ${id} title`),
    ...(role ? { role } : {}),
    content: typeof record.content === 'string' ? record.content : (() => { throw new Error(`Context ${id} content must be text`); })(),
    revision: integer(record.revision, `Context ${id} revision`),
    extensions: sanitizeImportedValue(extensionData(record.extensions, `Context ${id} extensions`), importedAt) as ExtensionData,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : importedAt
  };
}

function assetRecord(value: unknown, sourceProjectId: string, content: Uint8Array): WorkspaceAsset {
  const record = object(value, 'Imported asset');
  const id = safeId(string(record.id, 'Imported asset ID'), 'Imported asset');
  if (string(record.projectId, `Asset ${id} project`) !== sourceProjectId) throw new Error(`Asset ${id} belongs to another project`);
  const mimeType = string(record.mimeType, `Asset ${id} MIME type`);
  if (!mimeType.startsWith('image/')) throw new Error(`Asset ${id} is not a supported image`);
  if (integer(record.byteSize, `Asset ${id} byte size`) !== content.byteLength) throw new Error(`Asset ${id} byte size does not match its metadata`);
  return {
    id,
    projectId: sourceProjectId,
    fileName: string(record.fileName, `Asset ${id} file name`),
    mimeType,
    byteSize: content.byteLength,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  };
}

function assertDocumentGraph(documents: WorkspaceDocument[]): void {
  const ids = new Set(documents.map((document) => document.id));
  if (ids.size !== documents.length) throw new Error('Project archive contains duplicate document IDs');
  if (documents.filter((document) => document.role === 'spine').length !== 1) throw new Error('Imported project must contain exactly one Spine');
  if (documents.filter((document) => document.role === 'todos').length !== 1) throw new Error('Imported project must contain exactly one Todos root');
  for (const document of documents) {
    if (document.parentId && !ids.has(document.parentId)) throw new Error(`Document ${document.id} has an unknown parent`);
    const seen = new Set([document.id]);
    let parentId = document.parentId;
    while (parentId) {
      if (seen.has(parentId)) throw new Error(`Document ${document.id} has cyclic containment`);
      seen.add(parentId);
      parentId = documents.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }
}

export function inspectProjectArchive(archive: Uint8Array): ProjectImportCandidate {
  if (!archive.byteLength) throw new Error('Choose a Margin Note project archive');
  if (archive.byteLength > maximumArchiveBytes) throw new Error('Project archive exceeds the 128 MB compact-import limit');
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new Error('The selected file is not a readable ZIP archive');
  }
  const paths = Object.keys(files);
  if (paths.length > maximumEntries) throw new Error('Project archive contains too many files');
  if (paths.some((path) => !safePath(path))) throw new Error('Project archive contains an unsafe path');
  const expandedBytes = Object.values(files).reduce((total, value) => total + value.byteLength, 0);
  if (expandedBytes > maximumExpandedBytes) throw new Error('Expanded project archive exceeds the 512 MB import limit');

  const manifest = object(readJson(files, 'manifest.json'), 'Project manifest');
  if (manifest.format !== projectTransferFormat) throw new Error('This is not a Margin Note project archive');
  if (manifest.version !== projectTransferVersion) throw new Error(`Project archive version ${String(manifest.version)} is not supported`);
  if (manifest.exportMode !== 'compact') throw new Error('Import requires a compact .mnote.zip archive, not a forensic archive');
  const manifestProject = object(manifest.project, 'Manifest project');
  const manifestCounts = object(manifest.counts, 'Manifest counts');
  const manifestOmitted = object(manifest.omitted, 'Manifest omitted counts');
  const manifestDocumentCount = integer(manifestCounts.documents, 'Manifest document count');
  const manifestContextCount = integer(manifestCounts.contextBuckets, 'Manifest context count');
  const manifestAssetCount = integer(manifestCounts.assets, 'Manifest asset count');
  const manifestActiveRuns = integer(manifestCounts.activeRuns, 'Manifest active-run count');
  const omittedDocumentRevisions = integer(manifestOmitted.documentRevisions, 'Manifest omitted document revisions');
  const omittedContextRevisions = integer(manifestOmitted.contextRevisions, 'Manifest omitted context revisions');
  const manifestFiles = array(manifest.files, 'Manifest file list').map((path) => string(path, 'Manifest path'));
  if (manifestFiles.some((path) => !safePath(path)) || new Set(manifestFiles).size !== manifestFiles.length) throw new Error('Manifest contains an unsafe or duplicate path');
  if (manifestFiles.length !== paths.length || manifestFiles.some((path) => !files[path]) || paths.some((path) => !manifestFiles.includes(path))) {
    throw new Error('Project archive files do not match the manifest');
  }

  const importedAt = new Date().toISOString();
  const projectValue = object(readJson(files, 'project.json'), 'Imported project');
  const sourceProjectId = safeId(string(projectValue.id, 'Imported project ID'), 'Imported project');
  if (sourceProjectId !== string(manifestProject.id, 'Manifest project ID')) throw new Error('Project identity does not match the manifest');
  const structure = object(readJson(files, 'structure.json'), 'Project structure');
  const projectExtensions = extensionData(projectValue.extensions, 'Project extensions');
  const project: WorkspaceProject = {
    id: sourceProjectId,
    title: string(projectValue.title, 'Imported project title'),
    revision: integer(projectValue.revision, 'Imported project revision'),
    extensions: sanitizeImportedValue({
      ...projectExtensions,
      ...(structure.navigator === null || structure.navigator === undefined ? {} : { navigator: structure.navigator as JsonValue })
    }, importedAt) as ExtensionData,
    updatedAt: typeof projectValue.updatedAt === 'string' ? projectValue.updatedAt : importedAt
  };

  const documentIndex = array(readJson(files, 'documents/index.json'), 'Document index').map((value) => object(value, 'Document index entry'));
  const documents = documentIndex.map((entry) => {
    const id = safeId(string(entry.id, 'Document index ID'), 'Document index');
    return documentRecord(readJson(files, `documents/${id}.json`), sourceProjectId, importedAt);
  });
  assertDocumentGraph(documents);
  const documentIds = new Set(documents.map((document) => document.id));

  const contextIndex = array(readJson(files, 'context/index.json'), 'Context index').map((value) => object(value, 'Context index entry'));
  const contextBuckets = contextIndex.map((entry) => {
    const id = safeId(string(entry.id, 'Context index ID'), 'Context index');
    return contextRecord(readJson(files, `context/${id}.json`), sourceProjectId, documentIds, importedAt);
  });
  if (new Set(contextBuckets.map((bucket) => bucket.id)).size !== contextBuckets.length) throw new Error('Project archive contains duplicate context IDs');

  const assetIndex = array(readJson(files, 'assets/index.json'), 'Asset index').map((value) => object(value, 'Asset index entry'));
  const assets = assetIndex.map((entry) => {
    const id = safeId(string(entry.id, 'Asset index ID'), 'Asset index');
    const content = files[`assets/files/${id}`];
    if (!content) throw new Error(`Project archive is missing asset ${id}`);
    return { asset: assetRecord(entry, sourceProjectId, content), content: Buffer.from(content) };
  });
  if (new Set(assets.map(({ asset }) => asset.id)).size !== assets.length) throw new Error('Project archive contains duplicate asset IDs');

  if (manifestDocumentCount !== documents.length
    || manifestContextCount !== contextBuckets.length
    || manifestAssetCount !== assets.length) throw new Error('Project archive counts do not match the manifest');
  const warnings = [
    ...(manifestActiveRuns ? [`${manifestActiveRuns} active AI ${manifestActiveRuns === 1 ? 'run was' : 'runs were'} interrupted and will not resume automatically.`] : []),
    ...(omittedDocumentRevisions ? [`${omittedDocumentRevisions} omitted writing revisions are not part of this compact backup.`] : []),
    ...(omittedContextRevisions ? [`${omittedContextRevisions} omitted context revisions are not part of this compact backup.`] : [])
  ];
  return {
    preview: {
      title: project.title,
      formatVersion: projectTransferVersion,
      exportMode: 'compact',
      documents: documents.length,
      contextBuckets: contextBuckets.length,
      assets: assets.length,
      activeRuns: manifestActiveRuns,
      archiveBytes: archive.byteLength,
      expandedBytes,
      warnings
    },
    input: { project, documents, contextBuckets, assets }
  };
}
