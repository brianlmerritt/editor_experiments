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
    expect(repository.documentRevisionCount(documentId)).toBe(3);
    const streamed: number[] = [];
    repository.forEachDocumentRevision(documentId, (revision) => streamed.push(revision.number));
    expect(streamed).toEqual([1, 2, 3]);
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
    expect(repository.documentRevisions(documentId)[1].extensions.margin_note).toEqual({ formats: [{ id: 'format-1' }] });
    expect(restored.extensions).toEqual({ margin_note: { revision: 2 } });
  });

  it('persists operational AI state without creating or inflating manuscript history', () => {
    const documentId = repository.workspace().documents[0].id;
    const operational = repository.saveDocument({
      id: documentId,
      extensions: {
        margin_note: {
          revision: 2,
          inputs: [{ id: 'input-1', state: 'pending' }],
          runs: [{ id: 'run-1', state: 'running' }]
        }
      },
      reason: 'Record running craft pass'
    });

    expect(operational.revision).toBe(2);
    expect(operational.extensions.margin_note).toMatchObject({
      inputs: [{ id: 'input-1', state: 'pending' }],
      runs: [{ id: 'run-1', state: 'running' }]
    });
    expect(repository.documentRevisionCount(documentId)).toBe(1);

    repository.saveDocument({
      id: documentId,
      content: 'A meaningful prose change.',
      extensions: {
        margin_note: {
          revision: 3,
          document: { type: 'doc', content: [] },
          formats: [],
          inputs: [{ id: 'input-1', state: 'accepted' }],
          runs: [{ id: 'run-1', state: 'completed' }]
        }
      },
      reason: 'Accept revision'
    });

    const revisions = repository.documentRevisions(documentId);
    expect(revisions.map((revision) => revision.number)).toEqual([3, 1]);
    expect(revisions[0].extensions.margin_note).toEqual({ document: { type: 'doc', content: [] }, formats: [] });
  });

  it('reports storage and same-prose normalization candidates without mutating data', () => {
    const workspace = repository.workspace();
    const documentId = workspace.documents[0].id;
    repository.saveDocument({
      id: documentId,
      extensions: { margin_note: { formats: [{ id: 'format-1' }] } },
      reason: 'Format text'
    });

    const before = repository.documentRevisionCount(documentId);
    const report = repository.storageAnalysis(workspace.projects[0].id);

    expect(report).toMatchObject({ readOnly: true, safeReclaimableBytes: 0 });
    expect(report.projects).toHaveLength(1);
    expect(report.projects[0]).toMatchObject({ revisionCount: 3, sameProseRevisionCount: 1 });
    expect(report.projects[0].documents.find((document) => document.documentId === documentId)).toMatchObject({
      revisionCount: 2,
      sameProseRevisionCount: 1
    });
    expect(report.normalizationCandidateBytes).toBeGreaterThan(0);
    expect(repository.documentRevisionCount(documentId)).toBe(before);
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

  it('imports a project atomically with remapped document, context, Navigator, and asset identities', () => {
    const sourceProjectId = 'project_source';
    const imported = repository.importProject({
      project: {
        id: sourceProjectId,
        title: 'Imported work',
        revision: 4,
        updatedAt: '2026-08-26T12:00:00.000Z',
        extensions: {
          navigator: {
            version: 1,
            collections: [{ id: 'collection_source' }],
            relationships: [{ id: 'relationship_1', sourceNodeId: 'scene_source', targetNodeId: 'spine_source' }],
            todos: []
          }
        }
      },
      documents: [
        { id: 'spine_source', projectId: sourceProjectId, parentId: null, title: 'Spine', order: 0, revision: 7, role: 'spine', extensions: {}, kind: 'document', content: 'Story direction', updatedAt: '2026-08-26T12:00:00.000Z' },
        { id: 'todos_source', projectId: sourceProjectId, parentId: null, title: 'Todos', order: 1, revision: 2, role: 'todos', extensions: {}, kind: 'document', content: '', updatedAt: '2026-08-26T12:00:00.000Z' },
        { id: 'collection_source', projectId: sourceProjectId, parentId: null, title: 'Scenes', order: 2, revision: 1, role: 'navigator_collection', extensions: { navigator: { collectionId: 'collection_source' } }, kind: 'document', content: '', updatedAt: '2026-08-26T12:00:00.000Z' },
        { id: 'scene_source', projectId: sourceProjectId, parentId: 'collection_source', title: 'Scene 1', order: 0, revision: 3, role: 'navigator_node', extensions: { margin_note: { image: '/api/assets/asset_source' } }, kind: 'document', content: 'Opening scene', updatedAt: '2026-08-26T12:00:00.000Z' }
      ],
      contextBuckets: [{ id: 'context_source', projectId: sourceProjectId, documentId: 'scene_source', scope: 'document', title: 'Scene brief', content: 'Keep it close.', revision: 2, extensions: {}, updatedAt: '2026-08-26T12:00:00.000Z' }],
      assets: [{ asset: { id: 'asset_source', projectId: sourceProjectId, fileName: 'moon.png', mimeType: 'image/png', byteSize: 3, createdAt: '2026-08-26T12:00:00.000Z' }, content: Buffer.from([1, 2, 3]) }]
    });

    expect(imported.project.id).not.toBe(sourceProjectId);
    expect(imported.documents).toHaveLength(4);
    const spine = imported.documents.find((document) => document.role === 'spine')!;
    const collection = imported.documents.find((document) => document.role === 'navigator_collection')!;
    const scene = imported.documents.find((document) => document.role === 'navigator_node')!;
    expect(scene.parentId).toBe(collection.id);
    expect(JSON.stringify(imported.project.extensions)).toContain(spine.id);
    expect(JSON.stringify(imported.project.extensions)).not.toContain('spine_source');
    expect(imported.contextBuckets[0].documentId).toBe(scene.id);
    expect(scene.extensions.margin_note).toEqual({ image: expect.stringMatching(/^\/api\/assets\/asset_/) });
    expect(repository.projectAssets(imported.project.id)).toEqual([expect.objectContaining({ fileName: 'moon.png', byteSize: 3 })]);
    expect(repository.documentRevisionCount(scene.id)).toBe(1);
  });

  it('deletes a complete project without recreating the default and protects the final project', () => {
    const initial = repository.workspace();
    const disposableProject = initial.projects[0];
    repository.createAsset(disposableProject.id, 'old.png', 'image/png', Buffer.from([1]));
    const survivor = repository.createProject('Survivor');
    repository.createDocument({ projectId: survivor.id, title: 'Spine', role: 'spine' });
    repository.createDocument({ projectId: survivor.id, title: 'Todos', role: 'todos' });

    const remaining = repository.deleteProject(disposableProject.id);

    expect(remaining.projects.map((project) => project.id)).toEqual([survivor.id]);
    expect(remaining.documents.every((document) => document.projectId === survivor.id)).toBe(true);
    expect(remaining.projects.some((project) => project.id === 'project_default')).toBe(false);
    expect(() => repository.deleteProject(survivor.id)).toThrow('final project cannot be deleted');
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
    expect(repository.bucketRevisionCount(bucket.id)).toBe(2);
    const streamed: number[] = [];
    repository.forEachBucketRevision(bucket.id, (revision) => streamed.push(revision.number));
    expect(streamed).toEqual([1, 2]);
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
