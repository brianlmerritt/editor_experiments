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

  it('creates a durable default project, document, and narrative-rules bucket', () => {
    const first = repository.workspace();
    const second = repository.workspace();

    expect(first.projects).toHaveLength(1);
    expect(first.documents.map((document) => document.id)).toEqual(['main']);
    expect(first.contextBuckets).toEqual([
      expect.objectContaining({ title: 'Narrative rules', role: 'narrative_rules', scope: 'project', revision: 1 })
    ]);
    expect(second).toEqual(first);
  });

  it('stores immutable document revisions and restores by creating a new revision', () => {
    repository.workspace();
    const edited = repository.saveDocument({ id: 'main', content: 'Second version', createdBy: 'writer' });
    const unchanged = repository.saveDocument({ id: 'main', content: 'Second version', createdBy: 'writer' });
    const original = repository.documentRevisions('main').at(-1)!;
    const restored = repository.restoreDocument('main', original.id, 'writer');

    expect(edited.revision).toBe(2);
    expect(unchanged.revision).toBe(2);
    expect(restored.revision).toBe(3);
    expect(restored.content).toBe(original.content);
    expect(repository.documentRevisions('main').map((revision) => revision.number)).toEqual([3, 2, 1]);
  });

  it('versions freely named project and document context without imposing a schema', () => {
    const workspace = repository.workspace();
    const projectId = workspace.projects[0].id;
    const bucket = repository.createBucket({
      projectId,
      documentId: 'main',
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
      documentId: 'main',
      scope: 'project',
      title: 'Broken scope'
    })).toThrow('Project context cannot target a document');
  });

  it('keeps narrative rules in place while retaining ordinary deleted bucket history', () => {
    const workspace = repository.workspace();
    const narrative = workspace.contextBuckets.find((bucket) => bucket.role === 'narrative_rules')!;
    expect(() => repository.deleteBucket(narrative.id)).toThrow('Narrative rules cannot be removed');
  });
});
