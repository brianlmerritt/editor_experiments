import Database from 'better-sqlite3';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectExportSnapshot } from '$lib/workspace/project-transfer';
import { createProjectArchive } from './project-export';
import { WorkspaceRepository } from './workspace-store';

function readJson<T>(files: ReturnType<typeof unzipSync>, path: string): T {
  return JSON.parse(strFromU8(files[path])) as T;
}

describe('native project export', () => {
  let database: Database.Database;
  let repository: WorkspaceRepository;

  beforeEach(() => {
    database = new Database(':memory:');
    repository = new WorkspaceRepository(database);
  });

  afterEach(() => database.close());

  it('archives live project state compactly while reporting omitted autosave history', async () => {
    const durable = repository.workspace();
    const project = repository.saveProject(durable.projects[0].id, 'Harsh Mercy', {
      navigator: { version: 1, collections: [{ id: 'scenes' }] },
      ai_context_preferences: { review: { includeMaterial: true } }
    });
    const document = repository.saveDocument({
      id: durable.documents[0].id,
      content: 'Durable text',
      extensions: {
        margin_note: {
          sourceStates: { 'local-craft': 'visible', openrouter: 'visible' },
          runs: [{ id: 'run-1', state: 'running', usage: [{ source: 'openrouter', totalCostUsd: 0.25 }] }]
        }
      }
    });
    const bucket = repository.createBucket({
      projectId: project.id,
      scope: 'project',
      title: 'Narrative rules',
      content: 'Past tense.'
    });
    const asset = repository.createAsset(project.id, 'bed.png', 'image/png', Buffer.from([1, 2, 3]));
    const snapshot: ProjectExportSnapshot = {
      project,
      documents: [
        { ...document, content: 'Unsaved Svelte text' },
        ...durable.documents.filter((item) => item.id !== document.id)
      ],
      contextBuckets: [bucket],
      capturedAt: '2026-08-26T12:00:00.000Z'
    };

    const archive = createProjectArchive(snapshot, repository);
    const files = unzipSync(new Uint8Array(await new Response(archive.stream).arrayBuffer()));
    const manifest = readJson<{ exportMode: string; counts: Record<string, number>; omitted: Record<string, number>; safety: Record<string, boolean>; files: string[] }>(files, 'manifest.json');
    const exportedDocument = readJson<{ content: string; extensions: { margin_note: { sourceStates: Record<string, string>; runs: unknown[] } } }>(files, `documents/${document.id}.json`);
    const exportedProject = readJson<{ extensions: Record<string, unknown> }>(files, 'project.json');
    const structure = readJson<{ navigator: unknown }>(files, 'structure.json');

    expect(archive.filename).toBe('harsh-mercy.mnote.zip');
    expect(exportedDocument.content).toBe('Unsaved Svelte text');
    expect(exportedDocument.extensions.margin_note.sourceStates).toEqual({ 'local-craft': 'visible', openrouter: 'off' });
    expect(exportedDocument.extensions.margin_note.runs).toHaveLength(1);
    expect(exportedProject.extensions).not.toHaveProperty('navigator');
    expect(structure.navigator).toEqual({ version: 1, collections: [{ id: 'scenes' }] });
    expect(files[`assets/files/${asset.id}`]).toEqual(Uint8Array.from([1, 2, 3]));
    expect(manifest.exportMode).toBe('compact');
    expect(manifest.counts).toMatchObject({ documents: 2, documentRevisions: 0, contextBuckets: 1, contextRevisions: 0, assets: 1, activeRuns: 1 });
    expect(manifest.omitted).toEqual({ documentRevisions: 3, contextRevisions: 1 });
    expect(manifest.safety).toEqual({ providerCredentialsIncluded: false, paidProvidersEnabledOnImport: false });
    expect(files[`revisions/documents/${document.id}.jsonl`]).toBeUndefined();
    expect(manifest.files).not.toContain(`revisions/documents/${document.id}.jsonl`);

    const forensicArchive = createProjectArchive(snapshot, repository, 'forensic');
    const forensicFiles = unzipSync(new Uint8Array(await new Response(forensicArchive.stream).arrayBuffer()));
    const forensicManifest = readJson<{ exportMode: string; counts: Record<string, number>; omitted: Record<string, number>; files: string[] }>(forensicFiles, 'manifest.json');
    expect(forensicArchive.filename).toBe('harsh-mercy-forensic.mnote.zip');
    expect(forensicManifest.exportMode).toBe('forensic');
    expect(forensicManifest.counts).toMatchObject({ documentRevisions: 3, contextRevisions: 1 });
    expect(forensicManifest.omitted).toEqual({ documentRevisions: 0, contextRevisions: 0 });
    expect(strFromU8(forensicFiles[`revisions/documents/${document.id}.jsonl`]).trim().split('\n')).toHaveLength(2);
  });

  it('rejects records outside the selected project', () => {
    const durable = repository.workspace();
    const snapshot: ProjectExportSnapshot = {
      project: durable.projects[0],
      documents: [{ ...durable.documents[0], id: 'unknown' }],
      contextBuckets: [],
      capturedAt: new Date().toISOString()
    };
    expect(() => createProjectArchive(snapshot, repository)).toThrow('unknown document');
  });
});
