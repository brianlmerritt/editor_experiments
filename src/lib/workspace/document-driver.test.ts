import { describe, expect, it } from 'vitest';
import { documentMirrorDatabaseName, YjsDocumentDriver, type WorkspaceCommit } from './document-driver';

describe('Yjs document driver', () => {
  it('mirrors canonical Svelte commits without becoming the active editor state', async () => {
    const driver = new YjsDocumentDriver(false);
    const commit: WorkspaceCommit = {
      documentId: 'main',
      content: 'Canonical Rune text.',
      extensions: { margin_note: { revision: 7, inputs: [{ id: 'input-1' }], runs: [{ id: 'run-1' }], contextSnapshots: { context_1: {} }, activities: [{ id: 'activity-1' }] } },
      workspaceRevision: 7,
      durableRevision: 3,
      transactionId: 'transaction-7',
      sessionId: 'session-1',
      reason: 'Edit text'
    };

    await driver.commit(commit);

    expect(await driver.inspect('main')).toEqual({
      documentId: 'main',
      content: 'Canonical Rune text.',
      extensions: { margin_note: { revision: 7, inputs: [{ id: 'input-1' }] } },
      workspaceRevision: 7,
      durableRevision: 3
    });
  });
});

describe('document mirror database names', () => {
  it('identifies the project and document while retaining collision-safe IDs', () => {
    expect(documentMirrorDatabaseName('document_9f2c5a7b6652', {
      projectId: 'project_4db8912cc781',
      projectTitle: 'AGI: The Book Test',
      documentTitle: 'Chapter 1 — Entrance Fee'
    })).toBe('margin-note:v2:document:agi-the-book-test-4db8912cc781:chapter-1-entrance-fee-9f2c5a7b6652');
  });

  it('keeps the legacy identity when project metadata is unavailable', () => {
    expect(documentMirrorDatabaseName('main')).toBe('margin-note:v2:document:main');
  });
});
