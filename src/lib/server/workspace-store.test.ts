import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRepository } from './workspace-store';

describe('WorkspaceRepository', () => {
  let database: Database.Database;
  let repository: WorkspaceRepository;

  beforeEach(() => {
    database = new Database(':memory:');
    repository = new WorkspaceRepository(database);
  });

  afterEach(() => database.close());

  it('creates a fresh project with empty protected Spine and Todos documents', () => {
    const first = repository.workspace();
    const second = repository.workspace();

    expect(first.projects).toHaveLength(1);
    expect(first.documents).toEqual([
      expect.objectContaining({ id: 'spine_default', title: 'Spine', role: 'spine', content: '' }),
      expect.objectContaining({ id: 'todos_default', title: 'Todos', role: 'todos', content: '' })
    ]);
    expect(first.contextBuckets).toEqual([]);
    expect(second).toEqual(first);
  });

  it('stores immutable document revisions and restores by creating a new revision', () => {
    const documentId = repository.workspace().documents[0].id;
    const edited = repository.saveDocument({ id: documentId, content: 'Second version', createdBy: 'writer' });
    const unchanged = repository.saveDocument({ id: documentId, content: 'Second version', createdBy: 'writer' });
    const original = repository.documentRevisions(documentId).at(-1)!;
    const restored = repository.restoreDocument(documentId, original.id, 'writer');

    expect(edited.revision).toBe(2);
    expect(unchanged.revision).toBe(2);
    expect(restored.revision).toBe(3);
    expect(restored.content).toBe(original.content);
    expect(repository.documentRevisions(documentId).map((revision) => revision.number)).toEqual([3, 2, 1]);
  });

  it('persists project-level Navigator state without changing the project identity', () => {
    const project = repository.workspace().projects[0];
    const saved = repository.saveProject(project.id, project.title, {
      navigator: { version: 1, revision: 1, collections: [], relationships: [], todos: [] }
    });

    expect(saved.id).toBe(project.id);
    expect(saved.revision).toBe(2);
    expect(saved.extensions.navigator).toEqual({
      version: 1, revision: 1, collections: [], relationships: [], todos: []
    });
  });

  it('versions attachment state with the document instead of losing it on restore', () => {
    const documentId = repository.workspace().documents[0].id;
    const edited = repository.saveDocument({
      id: documentId,
      extensions: { margin_note: { revision: 2, formats: [{ id: 'format-1' }] } },
      createdBy: 'writer'
    });
    const initial = repository.documentRevisions(documentId).at(-1)!;
    const restored = repository.restoreDocument(documentId, initial.id, 'writer');

    expect(edited.extensions.margin_note).toEqual({ revision: 2, formats: [{ id: 'format-1' }] });
    expect(repository.documentRevisions(documentId)[1].extensions.margin_note).toEqual({ revision: 2, formats: [{ id: 'format-1' }] });
    expect(restored.extensions).toEqual({});
  });

  it('stores pasted image bytes outside the document and returns durable asset metadata', () => {
    const projectId = repository.workspace().projects[0].id;
    const content = Buffer.from([137, 80, 78, 71]);
    const asset = repository.createAsset(projectId, 'hospital.png', 'image/png', content);
    const loaded = repository.asset(asset.id);

    expect(asset).toMatchObject({ projectId, fileName: 'hospital.png', mimeType: 'image/png', byteSize: 4 });
    expect(loaded.content).toEqual(content);
    expect(repository.projectAssets(projectId)).toEqual([asset]);
    expect(() => repository.createAsset(projectId, 'notes.txt', 'text/plain', Buffer.from('no'))).toThrow('Only image assets are supported');
  });

  it('moves durable documents without changing their stable identity', () => {
    const workspace = repository.workspace();
    const child = repository.createDocument({ projectId: workspace.projects[0].id, title: 'Scene', role: 'navigator_node' });
    const moved = repository.saveDocument({ id: child.id, parentId: workspace.documents[0].id, order: 4, reason: 'Navigator move' });

    expect(moved.id).toBe(child.id);
    expect(moved.parentId).toBe(workspace.documents[0].id);
    expect(moved.order).toBe(4);
    expect(moved.revision).toBe(2);
  });

  it('resets a project only after an explicit request and recreates clean protected content', () => {
    const initial = repository.workspace();
    const projectId = initial.projects[0].id;
    repository.saveDocument({ id: initial.documents[0].id, title: 'Test', content: 'Old Spine content' });
    repository.createDocument({ projectId, title: 'Scenes', role: 'navigator_collection' });
    repository.saveProject(projectId, initial.projects[0].title, {
      navigator: { version: 1, revision: 3, collections: [{ id: 'scenes' }], relationships: [], todos: [] }
    });

    const reset = repository.resetProject(projectId);
    const documents = reset.documents.filter((document) => document.projectId === projectId);

    expect(reset.projects.find((project) => project.id === projectId)?.extensions).toEqual({});
    expect(documents).toHaveLength(2);
    expect(documents).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Spine', role: 'spine', content: '' }),
      expect.objectContaining({ title: 'Todos', role: 'todos', content: '' })
    ]));
  });

  it('deletes ordinary documents but protects Spine and Todos', () => {
    const initial = repository.workspace();
    const collection = repository.createDocument({ projectId: initial.projects[0].id, title: 'Scenes', role: 'navigator_collection' });

    repository.deleteDocument(collection.id);

    expect(repository.workspace().documents.some((document) => document.id === collection.id)).toBe(false);
    expect(() => repository.deleteDocument(initial.documents.find((document) => document.role === 'spine')!.id)).toThrow('Protected Spine cannot be deleted');
    expect(() => repository.deleteDocument(initial.documents.find((document) => document.role === 'todos')!.id)).toThrow('Protected Todos cannot be deleted');
  });

  it('versions freely named project and document context without imposing a schema', () => {
    const workspace = repository.workspace();
    const projectId = workspace.projects[0].id;
    const documentId = workspace.documents[0].id;
    const bucket = repository.createBucket({
      projectId,
      documentId,
      scope: 'document',
      title: 'Geoffrey at the hospital',
      role: 'scene_state',
      content: 'Geoffrey is awake but cannot interact.'
    });
    const edited = repository.saveBucket({
      id: bucket.id,
      title: bucket.title,
      role: 'scene_state',
      content: 'Geoffrey is proud, controlling, awake, and cannot interact.'
    });

    expect(edited.revision).toBe(2);
    expect(repository.bucketRevisions(bucket.id).map((revision) => revision.number)).toEqual([2, 1]);
    repository.deleteBucket(bucket.id);
    expect(repository.workspace().contextBuckets.some((item) => item.id === bucket.id)).toBe(false);
    expect(repository.bucketRevisions(bucket.id)).toHaveLength(2);
  });

  it('rejects invalid context scope instead of silently changing it', () => {
    const projectId = repository.workspace().projects[0].id;
    expect(() => repository.createBucket({
      projectId,
      documentId: repository.workspace().documents[0].id,
      scope: 'project',
      title: 'Broken scope'
    })).toThrow('Project context cannot target a document');
  });

});
