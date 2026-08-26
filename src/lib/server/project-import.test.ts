import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectArchive } from './project-export';
import { inspectProjectArchive } from './project-import';
import { WorkspaceRepository } from './workspace-store';

describe('native project import inspection', () => {
  let database: Database.Database;
  let repository: WorkspaceRepository;

  beforeEach(() => {
    database = new Database(':memory:');
    repository = new WorkspaceRepository(database);
  });

  afterEach(() => database.close());

  it('validates a compact archive and sanitizes provider state before adoption', async () => {
    const workspace = repository.workspace();
    const project = repository.saveProject(workspace.projects[0].id, 'Moon Dark');
    const spine = repository.saveDocument({
      id: workspace.documents.find((document) => document.role === 'spine')!.id,
      content: 'The moon was dark.',
      extensions: {
        margin_note: {
          sourceStates: { 'local-craft': 'visible', terra: 'visible' },
          runs: [{ id: 'run_1', state: 'running', proposalIds: [], errors: [] }],
          activities: [{ id: 'activity_1', state: 'running' }]
        }
      }
    });
    const snapshot = {
      project,
      documents: workspace.documents.map((document) => document.id === spine.id ? spine : document),
      contextBuckets: [],
      capturedAt: '2026-08-26T12:00:00.000Z'
    };
    const exported = createProjectArchive(snapshot, repository);
    const candidate = inspectProjectArchive(new Uint8Array(await new Response(exported.stream).arrayBuffer()));
    const importedSpine = candidate.input.documents.find((document) => document.role === 'spine')!;
    const marginNote = importedSpine.extensions.margin_note as Record<string, unknown>;

    expect(candidate.preview).toMatchObject({ title: 'Moon Dark', documents: 2, activeRuns: 1, exportMode: 'compact' });
    expect(candidate.preview.warnings[0]).toContain('will not resume automatically');
    expect(marginNote.sourceStates).toEqual({ 'local-craft': 'visible', terra: 'off' });
    expect((marginNote.runs as Array<Record<string, unknown>>)[0]).toMatchObject({ state: 'failed', completedAt: expect.any(String) });
    expect((marginNote.activities as Array<Record<string, unknown>>)[0]).toMatchObject({ state: 'partial', completedAt: expect.any(String) });

    const adopted = repository.importProject(candidate.input);
    expect(adopted.project.id).not.toBe(project.id);
    expect(adopted.project.title).toBe('Moon Dark');
    expect(adopted.documents.find((document) => document.role === 'spine')?.content).toBe('The moon was dark.');
    expect(repository.workspace().projects).toHaveLength(2);
  });

  it('rejects unreadable files before changing repository state', () => {
    const before = repository.workspace();
    expect(() => inspectProjectArchive(new TextEncoder().encode('not a zip'))).toThrow('not a readable ZIP archive');
    expect(repository.workspace()).toEqual(before);
  });
});
