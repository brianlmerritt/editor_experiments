import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Branch } from '$lib/domain';
import type {
  ContextBucket,
  ContextBucketRevision,
  ContextScope,
  DocumentRevision,
  ExtensionData,
  JsonValue,
  PersistentWorkspace,
  WorkspaceAsset,
  WorkspaceDocument,
  WorkspaceProject
} from '$lib/workspace/model';
import type { DocumentStorageAnalysis, ProjectStorageAnalysis, StorageAnalysis } from '$lib/workspace/retention';

const defaultProjectId = 'project_default';

interface ProjectRow {
  id: string;
  title: string;
  revision: number;
  extensions: string;
  updated_at: string;
}

interface DocumentRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  title: string;
  sort_order: number;
  revision: number;
  role: string | null;
  content: string;
  extensions: string;
  updated_at: string;
}

interface DocumentRevisionRow {
  id: string;
  document_id: string;
  number: number;
  title: string;
  content: string;
  extensions: string;
  created_at: string;
  created_by: string | null;
  reason: string | null;
}

interface BucketRow {
  id: string;
  project_id: string;
  document_id: string | null;
  scope: ContextScope;
  title: string;
  role: string | null;
  content: string;
  revision: number;
  extensions: string;
  updated_at: string;
}

interface BucketRevisionRow {
  id: string;
  bucket_id: string;
  number: number;
  title: string;
  role: string | null;
  content: string;
  created_at: string;
  created_by: string | null;
  reason: string | null;
}

interface AssetRow {
  id: string;
  project_id: string;
  file_name: string;
  mime_type: string;
  byte_size: number;
  content: Buffer;
  created_at: string;
}

const operationalMarginNoteKeys = new Set([
  'revision',
  'inputs',
  'runs',
  'activities',
  'sourceStates',
  'inputSourceVisibility'
]);

function record(value: unknown): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : null;
}

/** Current documents retain complete domain state; immutable writing history omits
 * operational AI/Input state that otherwise grows on every lifecycle update. */
export function manuscriptRevisionExtensions(value: ExtensionData): ExtensionData {
  const result = JSON.parse(JSON.stringify(value)) as ExtensionData;
  const marginNote = record(result.margin_note);
  if (!marginNote) return result;
  for (const key of operationalMarginNoteKeys) delete marginNote[key];
  if (!Object.keys(marginNote).length) delete result.margin_note;
  return result;
}

function restoredDocumentExtensions(current: ExtensionData, revision: ExtensionData): ExtensionData {
  const restored = JSON.parse(JSON.stringify(revision)) as ExtensionData;
  const currentMarginNote = record(current.margin_note);
  if (!currentMarginNote) return restored;
  const restoredMarginNote = record(restored.margin_note) ?? {};
  for (const key of operationalMarginNoteKeys) {
    if (key in currentMarginNote) restoredMarginNote[key] = JSON.parse(JSON.stringify(currentMarginNote[key])) as JsonValue;
  }
  if (Object.keys(restoredMarginNote).length) restored.margin_note = restoredMarginNote;
  return restored;
}

export interface CreateDocumentInput {
  id?: string;
  projectId: string;
  title: string;
  content?: string;
  role?: string;
  parentId?: string | null;
  extensions?: ExtensionData;
  createdBy?: string;
  reason?: string;
}

export interface SaveDocumentInput {
  id: string;
  title?: string;
  content?: string;
  extensions?: ExtensionData;
  parentId?: string | null;
  order?: number;
  createdBy?: string;
  reason?: string;
}

export interface CreateContextBucketInput {
  projectId: string;
  documentId?: string | null;
  scope: ContextScope;
  title: string;
  role?: string;
  content?: string;
  createdBy?: string;
}

export interface SaveContextBucketInput {
  id: string;
  title?: string;
  role?: string;
  content?: string;
  createdBy?: string;
  reason?: string;
}

export interface ImportProjectInput {
  project: WorkspaceProject;
  documents: WorkspaceDocument[];
  contextBuckets: ContextBucket[];
  assets: Array<{ asset: WorkspaceAsset; content: Buffer }>;
}

export interface ImportedProjectRecords {
  project: WorkspaceProject;
  documents: WorkspaceDocument[];
  contextBuckets: ContextBucket[];
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function extensions(value: string): ExtensionData {
  return JSON.parse(value) as ExtensionData;
}

function projectFromRow(row: ProjectRow): WorkspaceProject {
  return {
    id: row.id,
    title: row.title,
    revision: row.revision,
    extensions: extensions(row.extensions),
    updatedAt: row.updated_at
  };
}

function documentFromRow(row: DocumentRow): WorkspaceDocument {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    title: row.title,
    order: row.sort_order,
    revision: row.revision,
    role: row.role ?? undefined,
    extensions: extensions(row.extensions),
    kind: 'document',
    content: row.content,
    updatedAt: row.updated_at
  };
}

function revisionFromRow(row: DocumentRevisionRow): DocumentRevision {
  return {
    id: row.id,
    documentId: row.document_id,
    number: row.number,
    title: row.title,
    content: row.content,
    extensions: extensions(row.extensions),
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
    reason: row.reason ?? undefined
  };
}

function bucketFromRow(row: BucketRow): ContextBucket {
  return {
    id: row.id,
    projectId: row.project_id,
    documentId: row.document_id,
    scope: row.scope,
    title: row.title,
    role: row.role ?? undefined,
    content: row.content,
    revision: row.revision,
    extensions: extensions(row.extensions),
    updatedAt: row.updated_at
  };
}

function bucketRevisionFromRow(row: BucketRevisionRow): ContextBucketRevision {
  return {
    id: row.id,
    bucketId: row.bucket_id,
    number: row.number,
    title: row.title,
    role: row.role ?? undefined,
    content: row.content,
    createdAt: row.created_at,
    createdBy: row.created_by ?? undefined,
    reason: row.reason ?? undefined
  };
}

function assetFromRow(row: AssetRow): WorkspaceAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    createdAt: row.created_at
  };
}

export class WorkspaceRepository {
  constructor(private readonly database: Database.Database) {
    this.migrate();
  }

  private migrate(): void {
    this.database.pragma('foreign_keys = ON');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workspace_projects (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        extensions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extensions)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE TABLE IF NOT EXISTS workspace_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id),
        parent_id TEXT,
        title TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        role TEXT,
        content TEXT NOT NULL DEFAULT '',
        extensions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extensions)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS workspace_documents_project_idx ON workspace_documents(project_id, sort_order, id);
      CREATE TABLE IF NOT EXISTS workspace_document_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES workspace_documents(id),
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        extensions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extensions)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        created_by TEXT,
        reason TEXT,
        UNIQUE(document_id, number)
      );
      CREATE TABLE IF NOT EXISTS workspace_context_buckets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id),
        document_id TEXT REFERENCES workspace_documents(id),
        scope TEXT NOT NULL CHECK(scope IN ('project', 'document')),
        title TEXT NOT NULL,
        role TEXT,
        content TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1,
        extensions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(extensions)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        deleted_at TEXT,
        CHECK((scope = 'project' AND document_id IS NULL) OR (scope = 'document' AND document_id IS NOT NULL))
      );
      CREATE INDEX IF NOT EXISTS workspace_context_project_idx ON workspace_context_buckets(project_id, document_id, id);
      CREATE TABLE IF NOT EXISTS workspace_context_bucket_revisions (
        id TEXT PRIMARY KEY,
        bucket_id TEXT NOT NULL REFERENCES workspace_context_buckets(id),
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        role TEXT,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        created_by TEXT,
        reason TEXT,
        UNIQUE(bucket_id, number)
      );
      CREATE TABLE IF NOT EXISTS workspace_assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES workspace_projects(id),
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        byte_size INTEGER NOT NULL,
        content BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS workspace_assets_project_idx ON workspace_assets(project_id, created_at, id);
    `);
    const bucketColumns = this.database.prepare("PRAGMA table_info('workspace_context_buckets')").all() as { name: string }[];
    if (!bucketColumns.some((column) => column.name === 'deleted_at')) {
      this.database.exec('ALTER TABLE workspace_context_buckets ADD COLUMN deleted_at TEXT');
    }
    const revisionColumns = this.database.prepare("PRAGMA table_info('workspace_document_revisions')").all() as { name: string }[];
    if (!revisionColumns.some((column) => column.name === 'extensions')) {
      this.database.exec("ALTER TABLE workspace_document_revisions ADD COLUMN extensions TEXT NOT NULL DEFAULT '{}'");
    }
  }

  ensureDefaults(_legacyBranches: Branch[] = []): void {
    const ensure = this.database.transaction(() => {
      const projectCount = (this.database.prepare('SELECT COUNT(*) count FROM workspace_projects').get() as { count: number }).count;
      if (!projectCount) {
        this.database.prepare(`
          INSERT INTO workspace_projects (id, title, extensions) VALUES (?, ?, ?)
        `).run(defaultProjectId, 'My writing project', JSON.stringify({ review_settings: { enabled: false } }));
      }

      const hasDefault = this.database.prepare('SELECT 1 FROM workspace_projects WHERE id = ?').get(defaultProjectId);
      if (!hasDefault) return;

      const hasSpine = this.database.prepare("SELECT 1 FROM workspace_documents WHERE project_id = ? AND role = 'spine' LIMIT 1").get(defaultProjectId);
      if (!hasSpine) {
        const inserted = this.database.prepare(`
          INSERT OR IGNORE INTO workspace_documents
            (id, project_id, parent_id, title, sort_order, role, content)
          VALUES ('spine_default', ?, NULL, 'Spine', 0, 'spine', '')
        `).run(defaultProjectId);
        if (inserted.changes) this.insertDocumentRevision('spine_default', 1, 'Spine', '', {}, 'system', 'Initial project Spine');
      }
      const hasTodos = this.database.prepare("SELECT 1 FROM workspace_documents WHERE project_id = ? AND role = 'todos' LIMIT 1").get(defaultProjectId);
      if (!hasTodos) {
        const inserted = this.database.prepare(`
          INSERT OR IGNORE INTO workspace_documents
            (id, project_id, parent_id, title, sort_order, role, content)
          VALUES ('todos_default', ?, NULL, 'Todos', 1, 'todos', '')
        `).run(defaultProjectId);
        if (inserted.changes) this.insertDocumentRevision('todos_default', 1, 'Todos', '', {}, 'system', 'Initial project Todos');
      }
    });
    ensure();
  }

  workspace(legacyBranches: Branch[] = []): PersistentWorkspace {
    this.ensureDefaults(legacyBranches);
    const projects = (this.database.prepare('SELECT * FROM workspace_projects ORDER BY created_at, id').all() as ProjectRow[]).map(projectFromRow);
    const documents = (this.database.prepare('SELECT * FROM workspace_documents ORDER BY project_id, sort_order, created_at, id').all() as DocumentRow[]).map(documentFromRow);
    const contextBuckets = (this.database.prepare('SELECT * FROM workspace_context_buckets WHERE deleted_at IS NULL ORDER BY project_id, created_at, id').all() as BucketRow[]).map(bucketFromRow);
    return { projects, documents, contextBuckets };
  }

  createProject(title: string): WorkspaceProject {
    if (!title.trim()) throw new Error('Project title is required');
    const projectId = id('project');
    this.database.prepare('INSERT INTO workspace_projects (id, title, extensions) VALUES (?, ?, ?)')
      .run(projectId, title.trim(), JSON.stringify({ review_settings: { enabled: false } }));
    return projectFromRow(this.database.prepare('SELECT * FROM workspace_projects WHERE id = ?').get(projectId) as ProjectRow);
  }

  importProject(input: ImportProjectInput): ImportedProjectRecords {
    if (!input.project.title.trim()) throw new Error('Imported project title is required');
    const sourceIdentities = [
      input.project.id,
      ...input.documents.map((document) => document.id),
      ...input.contextBuckets.map((bucket) => bucket.id),
      ...input.assets.map(({ asset }) => asset.id)
    ];
    if (new Set(sourceIdentities).size !== sourceIdentities.length) throw new Error('Imported project identities must be unique');
    const projectId = id('project');
    const documentIds = new Map(input.documents.map((document) => [document.id, id('document')]));
    const contextIds = new Map(input.contextBuckets.map((bucket) => [bucket.id, id('context')]));
    const assetIds = new Map(input.assets.map(({ asset }) => [asset.id, id('asset')]));
    if (input.documents.some((document) => document.projectId !== input.project.id || document.parentId && !documentIds.has(document.parentId))) {
      throw new Error('Imported document graph contains an unknown project or parent');
    }
    if (input.contextBuckets.some((bucket) => bucket.projectId !== input.project.id || bucket.documentId && !documentIds.has(bucket.documentId))) {
      throw new Error('Imported context contains an unknown project or document');
    }
    if (input.assets.some(({ asset }) => asset.projectId !== input.project.id)) throw new Error('Imported asset belongs to another project');
    const identityMap = new Map<string, string>([
      [input.project.id, projectId],
      ...documentIds,
      ...contextIds,
      ...assetIds
    ]);
    const remapString = (value: string): string => {
      const exact = identityMap.get(value);
      if (exact) return exact;
      let next = value;
      for (const [source, target] of [...identityMap].sort((left, right) => right[0].length - left[0].length)) {
        if (next.includes(source)) next = next.replaceAll(source, target);
        const encoded = encodeURIComponent(source);
        if (encoded !== source && next.includes(encoded)) next = next.replaceAll(encoded, encodeURIComponent(target));
      }
      return next;
    };
    const remapJson = (value: JsonValue): JsonValue => {
      if (typeof value === 'string') return remapString(value);
      if (Array.isArray(value)) return value.map(remapJson);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remapJson(child)]));
    };
    const importedAt = new Date().toISOString();
    const insert = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO workspace_projects (id, title, extensions, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(projectId, input.project.title.trim(), JSON.stringify(remapJson(input.project.extensions)), importedAt);
      for (const document of input.documents) {
        const nextId = documentIds.get(document.id);
        if (!nextId) throw new Error('Imported document identity could not be remapped');
        const nextExtensions = remapJson(document.extensions) as ExtensionData;
        this.database.prepare(`
          INSERT INTO workspace_documents
            (id, project_id, parent_id, title, sort_order, revision, role, content, extensions, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
        `).run(
          nextId,
          projectId,
          document.parentId ? documentIds.get(document.parentId) ?? null : null,
          document.title,
          document.order,
          document.role ?? null,
          document.content,
          JSON.stringify(nextExtensions),
          importedAt
        );
        this.insertDocumentRevision(nextId, 1, document.title, document.content, nextExtensions, 'project-import', 'Imported project archive');
      }
      for (const bucket of input.contextBuckets) {
        const nextId = contextIds.get(bucket.id);
        if (!nextId) throw new Error('Imported context identity could not be remapped');
        this.database.prepare(`
          INSERT INTO workspace_context_buckets
            (id, project_id, document_id, scope, title, role, content, revision, extensions, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          nextId,
          projectId,
          bucket.documentId ? documentIds.get(bucket.documentId) ?? null : null,
          bucket.scope,
          bucket.title,
          bucket.role ?? null,
          bucket.content,
          JSON.stringify(remapJson(bucket.extensions)),
          importedAt
        );
        this.insertBucketRevision(nextId, 1, bucket.title, bucket.role, bucket.content, 'project-import', 'Imported project archive');
      }
      for (const { asset, content } of input.assets) {
        const nextId = assetIds.get(asset.id);
        if (!nextId) throw new Error('Imported asset identity could not be remapped');
        this.database.prepare(`
          INSERT INTO workspace_assets (id, project_id, file_name, mime_type, byte_size, content, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(nextId, projectId, asset.fileName, asset.mimeType, content.byteLength, content, importedAt);
      }
    });
    insert();
    const workspace = this.workspace();
    return {
      project: workspace.projects.find((project) => project.id === projectId)!,
      documents: workspace.documents.filter((document) => document.projectId === projectId),
      contextBuckets: workspace.contextBuckets.filter((bucket) => bucket.projectId === projectId)
    };
  }

  deleteProject(projectId: string): PersistentWorkspace {
    const current = this.database.prepare('SELECT 1 FROM workspace_projects WHERE id = ?').get(projectId);
    if (!current) throw new Error('Project not found');
    const projectCount = (this.database.prepare('SELECT COUNT(*) count FROM workspace_projects').get() as { count: number }).count;
    if (projectCount <= 1) throw new Error('The final project cannot be deleted; create or import another project first');
    const remove = this.database.transaction(() => {
      const documentIds = (this.database.prepare('SELECT id FROM workspace_documents WHERE project_id = ?').all(projectId) as { id: string }[]).map((row) => row.id);
      if (documentIds.length && this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'").get()) {
        const removeEvent = this.database.prepare('DELETE FROM events WHERE branch_id = ?');
        for (const documentId of documentIds) removeEvent.run(documentId);
      }
      this.database.prepare(`
        DELETE FROM workspace_context_bucket_revisions
        WHERE bucket_id IN (SELECT id FROM workspace_context_buckets WHERE project_id = ?)
      `).run(projectId);
      this.database.prepare('DELETE FROM workspace_context_buckets WHERE project_id = ?').run(projectId);
      this.database.prepare('DELETE FROM workspace_assets WHERE project_id = ?').run(projectId);
      this.database.prepare(`
        DELETE FROM workspace_document_revisions
        WHERE document_id IN (SELECT id FROM workspace_documents WHERE project_id = ?)
      `).run(projectId);
      this.database.prepare('DELETE FROM workspace_documents WHERE project_id = ?').run(projectId);
      this.database.prepare('DELETE FROM workspace_projects WHERE id = ?').run(projectId);
    });
    remove();
    return this.workspace();
  }

  saveProject(projectId: string, title: string, nextExtensions?: ExtensionData): WorkspaceProject {
    if (!title.trim()) throw new Error('Project title is required');
    const current = this.database.prepare('SELECT * FROM workspace_projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
    if (!current) throw new Error('Project not found');
    const result = this.database.prepare(`
      UPDATE workspace_projects
      SET title = ?, extensions = ?, revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(title.trim(), JSON.stringify(nextExtensions ?? extensions(current.extensions)), projectId);
    if (!result.changes) throw new Error('Project not found');
    return projectFromRow(this.database.prepare('SELECT * FROM workspace_projects WHERE id = ?').get(projectId) as ProjectRow);
  }

  resetProject(projectId: string): PersistentWorkspace {
    const current = this.database.prepare('SELECT * FROM workspace_projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
    if (!current) throw new Error('Project not found');
    const reset = this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM workspace_context_bucket_revisions
        WHERE bucket_id IN (SELECT id FROM workspace_context_buckets WHERE project_id = ?)
      `).run(projectId);
      this.database.prepare('DELETE FROM workspace_context_buckets WHERE project_id = ?').run(projectId);
      this.database.prepare('DELETE FROM workspace_assets WHERE project_id = ?').run(projectId);
      this.database.prepare(`
        DELETE FROM workspace_document_revisions
        WHERE document_id IN (SELECT id FROM workspace_documents WHERE project_id = ?)
      `).run(projectId);
      this.database.prepare('DELETE FROM workspace_documents WHERE project_id = ?').run(projectId);
      this.database.prepare(`
        UPDATE workspace_projects
        SET extensions = '{}', revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(projectId);
      const spineId = id('document');
      const todosId = id('document');
      this.database.prepare(`
        INSERT INTO workspace_documents (id, project_id, parent_id, title, sort_order, role, content)
        VALUES (?, ?, NULL, 'Spine', 0, 'spine', '')
      `).run(spineId, projectId);
      this.insertDocumentRevision(spineId, 1, 'Spine', '', {}, 'system', 'Reset project Spine');
      this.database.prepare(`
        INSERT INTO workspace_documents (id, project_id, parent_id, title, sort_order, role, content)
        VALUES (?, ?, NULL, 'Todos', 1, 'todos', '')
      `).run(todosId, projectId);
      this.insertDocumentRevision(todosId, 1, 'Todos', '', {}, 'system', 'Reset project Todos');
    });
    reset();
    return this.workspace();
  }

  createDocument(input: CreateDocumentInput): WorkspaceDocument {
    if (!input.projectId) throw new Error('Document project is required');
    if (!input.title?.trim()) throw new Error('Document title is required');
    const documentId = input.id ?? id('document');
    const order = (this.database.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 value FROM workspace_documents WHERE project_id = ?').get(input.projectId) as { value: number }).value;
    const content = input.content ?? '';
    const title = input.title.trim();
    const create = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO workspace_documents
          (id, project_id, parent_id, title, sort_order, role, content, extensions)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(documentId, input.projectId, input.parentId ?? null, title, order, input.role ?? null, content, JSON.stringify(input.extensions ?? {}));
      this.insertDocumentRevision(documentId, 1, title, content, input.extensions ?? {}, input.createdBy, input.reason ?? 'Created document');
    });
    create();
    return this.document(documentId);
  }

  saveDocument(input: SaveDocumentInput): WorkspaceDocument {
    const current = this.document(input.id);
    const title = input.title?.trim() ?? current.title;
    if (!title) throw new Error('Document title is required');
    const content = input.content ?? current.content;
    const nextExtensions = input.extensions ?? current.extensions;
    const parentId = input.parentId === undefined ? current.parentId : input.parentId;
    const order = input.order ?? current.order;
    if (title === current.title && content === current.content && parentId === current.parentId && order === current.order
      && JSON.stringify(nextExtensions) === JSON.stringify(current.extensions)) return current;
    const writingStateChanged = title !== current.title || content !== current.content || parentId !== current.parentId || order !== current.order
      || JSON.stringify(manuscriptRevisionExtensions(nextExtensions)) !== JSON.stringify(manuscriptRevisionExtensions(current.extensions));
    const number = current.revision + 1;
    const save = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE workspace_documents
        SET title = ?, content = ?, parent_id = ?, sort_order = ?, extensions = ?, revision = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(title, content, parentId, order, JSON.stringify(nextExtensions), number, input.id);
      if (writingStateChanged) {
        this.insertDocumentRevision(input.id, number, title, content, nextExtensions, input.createdBy, input.reason ?? 'Saved document');
      }
    });
    save();
    return this.document(input.id);
  }

  deleteDocument(documentId: string): void {
    const current = this.document(documentId);
    if (current.role === 'spine' || current.role === 'todos') throw new Error(`Protected ${current.title} cannot be deleted`);
    const remove = this.database.transaction(() => {
      this.database.prepare('UPDATE workspace_documents SET parent_id = NULL WHERE parent_id = ?').run(documentId);
      this.database.prepare(`
        DELETE FROM workspace_context_bucket_revisions
        WHERE bucket_id IN (SELECT id FROM workspace_context_buckets WHERE document_id = ?)
      `).run(documentId);
      this.database.prepare('DELETE FROM workspace_context_buckets WHERE document_id = ?').run(documentId);
      this.database.prepare('DELETE FROM workspace_document_revisions WHERE document_id = ?').run(documentId);
      this.database.prepare('DELETE FROM workspace_documents WHERE id = ?').run(documentId);
    });
    remove();
  }

  restoreDocument(documentId: string, revisionId: string, createdBy?: string): WorkspaceDocument {
    const current = this.document(documentId);
    const prior = this.database.prepare(`
      SELECT * FROM workspace_document_revisions WHERE id = ? AND document_id = ?
    `).get(revisionId, documentId) as DocumentRevisionRow | undefined;
    if (!prior) throw new Error('Document revision not found');
    return this.saveDocument({
      id: documentId,
      title: prior.title,
      content: prior.content,
      extensions: restoredDocumentExtensions(current.extensions, extensions(prior.extensions)),
      createdBy,
      reason: `Restored revision ${prior.number}`
    });
  }

  documentRevisions(documentId: string): DocumentRevision[] {
    return (this.database.prepare(`
      SELECT * FROM workspace_document_revisions WHERE document_id = ? ORDER BY number DESC
    `).all(documentId) as DocumentRevisionRow[]).map(revisionFromRow);
  }

  documentRevisionCount(documentId: string): number {
    return (this.database.prepare('SELECT COUNT(*) count FROM workspace_document_revisions WHERE document_id = ?').get(documentId) as { count: number }).count;
  }

  forEachDocumentRevision(documentId: string, visit: (revision: DocumentRevision) => void): void {
    const rows = this.database.prepare(`
      SELECT * FROM workspace_document_revisions WHERE document_id = ? ORDER BY number
    `).iterate(documentId) as IterableIterator<DocumentRevisionRow>;
    for (const row of rows) visit(revisionFromRow(row));
  }

  createAsset(projectId: string, fileName: string, mimeType: string, content: Buffer): WorkspaceAsset {
    if (!projectId) throw new Error('Asset project is required');
    if (!mimeType.startsWith('image/')) throw new Error('Only image assets are supported');
    const project = this.database.prepare('SELECT 1 FROM workspace_projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('Project not found');
    const assetId = id('asset');
    this.database.prepare(`
      INSERT INTO workspace_assets (id, project_id, file_name, mime_type, byte_size, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(assetId, projectId, fileName || 'Pasted image', mimeType, content.byteLength, content);
    return assetFromRow(this.database.prepare('SELECT * FROM workspace_assets WHERE id = ?').get(assetId) as AssetRow);
  }

  asset(assetId: string): { asset: WorkspaceAsset; content: Buffer } {
    const row = this.database.prepare('SELECT * FROM workspace_assets WHERE id = ?').get(assetId) as AssetRow | undefined;
    if (!row) throw new Error('Asset not found');
    return { asset: assetFromRow(row), content: row.content };
  }

  projectAssets(projectId: string): WorkspaceAsset[] {
    return (this.database.prepare(`
      SELECT * FROM workspace_assets WHERE project_id = ? ORDER BY created_at, id
    `).all(projectId) as AssetRow[]).map(assetFromRow);
  }

  storageAnalysis(projectId?: string): StorageAnalysis {
    const projects = (this.database.prepare(`
      SELECT id, title FROM workspace_projects
      WHERE (? IS NULL OR id = ?)
      ORDER BY title, id
    `).all(projectId ?? null, projectId ?? null) as { id: string; title: string }[]);
    if (projectId && !projects.length) throw new Error('Project not found');
    const projectMap = new Map<string, ProjectStorageAnalysis>(projects.map((project) => [project.id, {
      projectId: project.id,
      title: project.title,
      currentBytes: 0,
      revisionCount: 0,
      revisionBytes: 0,
      sameProseRevisionCount: 0,
      sameProseRevisionBytes: 0,
      assetCount: 0,
      assetBytes: 0,
      documents: []
    }]));
    const documents = this.database.prepare(`
      SELECT id, project_id, title,
        length(title) + length(content) + length(extensions) current_bytes
      FROM workspace_documents
      WHERE (? IS NULL OR project_id = ?)
      ORDER BY project_id, sort_order, id
    `).all(projectId ?? null, projectId ?? null) as {
      id: string; project_id: string; title: string; current_bytes: number;
    }[];
    const documentMap = new Map<string, DocumentStorageAnalysis>();
    for (const row of documents) {
      const document: DocumentStorageAnalysis = {
        documentId: row.id,
        title: row.title,
        currentBytes: row.current_bytes,
        revisionCount: 0,
        revisionBytes: 0,
        sameProseRevisionCount: 0,
        sameProseRevisionBytes: 0
      };
      documentMap.set(row.id, document);
      const project = projectMap.get(row.project_id);
      if (project) {
        project.documents.push(document);
        project.currentBytes += row.current_bytes;
      }
    }
    const previousContent = new Map<string, string>();
    const revisionRows = this.database.prepare(`
      SELECT d.project_id, r.document_id, r.number, r.content,
        length(r.title) + length(r.content) + length(r.extensions) revision_bytes
      FROM workspace_document_revisions r
      JOIN workspace_documents d ON d.id = r.document_id
      WHERE (? IS NULL OR d.project_id = ?)
      ORDER BY r.document_id, r.number
    `).iterate(projectId ?? null, projectId ?? null) as IterableIterator<{
      project_id: string; document_id: string; number: number; content: string; revision_bytes: number;
    }>;
    for (const row of revisionRows) {
      const document = documentMap.get(row.document_id);
      const project = projectMap.get(row.project_id);
      if (!document || !project) continue;
      document.revisionCount += 1;
      document.revisionBytes += row.revision_bytes;
      project.revisionCount += 1;
      project.revisionBytes += row.revision_bytes;
      if (previousContent.get(row.document_id) === row.content) {
        document.sameProseRevisionCount += 1;
        document.sameProseRevisionBytes += row.revision_bytes;
        project.sameProseRevisionCount += 1;
        project.sameProseRevisionBytes += row.revision_bytes;
      }
      previousContent.set(row.document_id, row.content);
    }
    const assets = this.database.prepare(`
      SELECT project_id, count(*) asset_count, coalesce(sum(byte_size), 0) asset_bytes
      FROM workspace_assets
      WHERE (? IS NULL OR project_id = ?)
      GROUP BY project_id
    `).all(projectId ?? null, projectId ?? null) as { project_id: string; asset_count: number; asset_bytes: number }[];
    for (const row of assets) {
      const project = projectMap.get(row.project_id);
      if (project) {
        project.assetCount = row.asset_count;
        project.assetBytes = row.asset_bytes;
      }
    }
    const pageSize = Number(this.database.pragma('page_size', { simple: true }));
    const pageCount = Number(this.database.pragma('page_count', { simple: true }));
    const freePages = Number(this.database.pragma('freelist_count', { simple: true }));
    const resultProjects = [...projectMap.values()];
    return {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      databaseBytes: pageSize * pageCount,
      freePageBytes: pageSize * freePages,
      currentBytes: resultProjects.reduce((total, project) => total + project.currentBytes + project.assetBytes, 0),
      revisionCount: resultProjects.reduce((total, project) => total + project.revisionCount, 0),
      revisionBytes: resultProjects.reduce((total, project) => total + project.revisionBytes, 0),
      normalizationCandidateBytes: resultProjects.reduce((total, project) => total + project.sameProseRevisionBytes, 0),
      safeReclaimableBytes: 0,
      projects: resultProjects
    };
  }

  createBucket(input: CreateContextBucketInput): ContextBucket {
    if (!input.projectId) throw new Error('Context project is required');
    if (!input.title?.trim()) throw new Error('Context title is required');
    if (input.scope !== 'project' && input.scope !== 'document') throw new Error('Context scope must be project or document');
    if (input.scope === 'project' && input.documentId) throw new Error('Project context cannot target a document');
    if (input.scope === 'document' && !input.documentId) throw new Error('Document context requires a document');
    if (input.documentId) {
      const document = this.document(input.documentId);
      if (document.projectId !== input.projectId) throw new Error('Document does not belong to project');
    }
    const bucketId = id('context');
    const title = input.title.trim();
    const content = input.content ?? '';
    const create = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO workspace_context_buckets
          (id, project_id, document_id, scope, title, role, content)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(bucketId, input.projectId, input.scope === 'document' ? input.documentId : null, input.scope, title, input.role || null, content);
      this.insertBucketRevision(bucketId, 1, title, input.role, content, input.createdBy, 'Created context bucket');
    });
    create();
    return this.bucket(bucketId);
  }

  saveBucket(input: SaveContextBucketInput): ContextBucket {
    const current = this.bucket(input.id);
    const title = input.title?.trim() ?? current.title;
    if (!title) throw new Error('Context title is required');
    const role = input.role === undefined ? current.role : input.role || undefined;
    const content = input.content ?? current.content;
    if (title === current.title && role === current.role && content === current.content) return current;
    const number = current.revision + 1;
    const save = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE workspace_context_buckets
        SET title = ?, role = ?, content = ?, revision = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(title, role ?? null, content, number, input.id);
      this.insertBucketRevision(input.id, number, title, role, content, input.createdBy, input.reason ?? 'Saved context');
    });
    save();
    return this.bucket(input.id);
  }

  deleteBucket(bucketId: string): void {
    const bucket = this.bucket(bucketId);
    if (bucket.role === 'narrative_rules') throw new Error('Narrative rules cannot be removed; save a new version instead');
    const result = this.database.prepare(`
      UPDATE workspace_context_buckets
      SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND deleted_at IS NULL
    `).run(bucketId);
    if (!result.changes) throw new Error('Context bucket not found');
  }

  bucketRevisions(bucketId: string): ContextBucketRevision[] {
    return (this.database.prepare(`
      SELECT * FROM workspace_context_bucket_revisions WHERE bucket_id = ? ORDER BY number DESC
    `).all(bucketId) as BucketRevisionRow[]).map(bucketRevisionFromRow);
  }

  bucketRevisionCount(bucketId: string): number {
    return (this.database.prepare('SELECT COUNT(*) count FROM workspace_context_bucket_revisions WHERE bucket_id = ?').get(bucketId) as { count: number }).count;
  }

  forEachBucketRevision(bucketId: string, visit: (revision: ContextBucketRevision) => void): void {
    const rows = this.database.prepare(`
      SELECT * FROM workspace_context_bucket_revisions WHERE bucket_id = ? ORDER BY number
    `).iterate(bucketId) as IterableIterator<BucketRevisionRow>;
    for (const row of rows) visit(bucketRevisionFromRow(row));
  }

  private document(documentId: string): WorkspaceDocument {
    const row = this.database.prepare('SELECT * FROM workspace_documents WHERE id = ?').get(documentId) as DocumentRow | undefined;
    if (!row) throw new Error('Document not found');
    return documentFromRow(row);
  }

  private bucket(bucketId: string): ContextBucket {
    const row = this.database.prepare('SELECT * FROM workspace_context_buckets WHERE id = ? AND deleted_at IS NULL').get(bucketId) as BucketRow | undefined;
    if (!row) throw new Error('Context bucket not found');
    return bucketFromRow(row);
  }

  private insertDocumentRevision(documentId: string, number: number, title: string, content: string, extensionData: ExtensionData, createdBy?: string, reason?: string): void {
    this.database.prepare(`
      INSERT INTO workspace_document_revisions
        (id, document_id, number, title, content, extensions, created_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id('document_revision'), documentId, number, title, content, JSON.stringify(manuscriptRevisionExtensions(extensionData)), createdBy ?? null, reason ?? null);
  }

  private insertBucketRevision(bucketId: string, number: number, title: string, role: string | undefined, content: string, createdBy?: string, reason?: string): void {
    this.database.prepare(`
      INSERT INTO workspace_context_bucket_revisions
        (id, bucket_id, number, title, role, content, created_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id('context_revision'), bucketId, number, title, role ?? null, content, createdBy ?? null, reason ?? null);
  }
}

const databasePath = process.env.LEDGER_PATH ?? resolve('data/writing-ledger.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const workspaceDatabase = new Database(databasePath);
workspaceDatabase.pragma('journal_mode = WAL');

export const workspaceRepository = new WorkspaceRepository(workspaceDatabase);
