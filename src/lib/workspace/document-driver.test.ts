import { describe, expect, it } from 'vitest';
import { YjsDocumentDriver, type WorkspaceCommit } from './document-driver';

describe('Yjs document driver', () => {
  it('mirrors canonical Svelte commits without becoming the active editor state', async () => {
    const driver = new YjsDocumentDriver(false);
    const commit: WorkspaceCommit = {
      documentId: 'main',
      content: 'Canonical Rune text.',
      extensions: { margin_note: { revision: 7 } },
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
      extensions: { margin_note: { revision: 7 } },
      workspaceRevision: 7,
      durableRevision: 3
    });
  });
});
