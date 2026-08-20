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
  PersistentWorkspace,
  WorkspaceDocument,
  WorkspaceProject
} from '$lib/workspace/model';

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
      this.database.prepare(`
        INSERT OR IGNORE INTO workspace_projects (id, title) VALUES (?, ?)
      `).run(defaultProjectId, 'My writing project');

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
    this.database.prepare('INSERT INTO workspace_projects (id, title) VALUES (?, ?)').run(projectId, title.trim());
    return projectFromRow(this.database.prepare('SELECT * FROM workspace_projects WHERE id = ?').get(projectId) as ProjectRow);
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
    const number = current.revision + 1;
    const save = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE workspace_documents
        SET title = ?, content = ?, parent_id = ?, sort_order = ?, extensions = ?, revision = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?
      `).run(title, content, parentId, order, JSON.stringify(nextExtensions), number, input.id);
      this.insertDocumentRevision(input.id, number, title, content, nextExtensions, input.createdBy, input.reason ?? 'Saved document');
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
    const prior = this.database.prepare(`
      SELECT * FROM workspace_document_revisions WHERE id = ? AND document_id = ?
    `).get(revisionId, documentId) as DocumentRevisionRow | undefined;
    if (!prior) throw new Error('Document revision not found');
    return this.saveDocument({
      id: documentId,
      title: prior.title,
      content: prior.content,
      extensions: extensions(prior.extensions),
      createdBy,
      reason: `Restored revision ${prior.number}`
    });
  }

  documentRevisions(documentId: string): DocumentRevision[] {
    return (this.database.prepare(`
      SELECT * FROM workspace_document_revisions WHERE document_id = ? ORDER BY number DESC
    `).all(documentId) as DocumentRevisionRow[]).map(revisionFromRow);
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
    `).run(id('document_revision'), documentId, number, title, content, JSON.stringify(extensionData), createdBy ?? null, reason ?? null);
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
