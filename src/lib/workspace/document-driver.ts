import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type { ExtensionData } from './model';

export interface DocumentMirrorSnapshot {
  documentId: string;
  content: string;
  extensions: ExtensionData;
  workspaceRevision: number;
  durableRevision: number;
}

export interface WorkspaceCommit extends DocumentMirrorSnapshot {
  transactionId: string;
  sessionId: string;
  reason: string;
}

export interface DocumentDriver {
  hydrate(snapshot: DocumentMirrorSnapshot): Promise<void>;
  commit(transaction: WorkspaceCommit): Promise<void>;
}

export class NullDocumentDriver implements DocumentDriver {
  async hydrate(): Promise<void> {}
  async commit(): Promise<void> {}
}

interface YjsHandle {
  doc: Y.Doc;
  persistence?: IndexeddbPersistence;
}

/**
 * A write-behind Yjs document mirror. It receives canonical Svelte snapshots through
 * WorkspaceFacade and never supplies live editor state directly.
 */
export class YjsDocumentDriver implements DocumentDriver {
  private readonly handles = new Map<string, Promise<YjsHandle>>();

  constructor(private readonly persist = typeof indexedDB !== 'undefined') {}

  async hydrate(snapshot: DocumentMirrorSnapshot): Promise<void> {
    const handle = await this.open(snapshot.documentId);
    this.write(handle.doc, snapshot, 'hydrate');
  }

  async commit(transaction: WorkspaceCommit): Promise<void> {
    const handle = await this.open(transaction.documentId);
    this.write(handle.doc, transaction, transaction.transactionId);
  }

  async inspect(documentId: string): Promise<DocumentMirrorSnapshot | null> {
    const handle = await this.open(documentId);
    const state = handle.doc.getMap<unknown>('workspace');
    const content = state.get('content');
    if (typeof content !== 'string') return null;
    return {
      documentId,
      content,
      extensions: (state.get('extensions') ?? {}) as ExtensionData,
      workspaceRevision: Number(state.get('workspaceRevision') ?? 0),
      durableRevision: Number(state.get('durableRevision') ?? 0)
    };
  }

  private open(documentId: string): Promise<YjsHandle> {
    const existing = this.handles.get(documentId);
    if (existing) return existing;
    const opened = (async () => {
      const doc = new Y.Doc();
      if (!this.persist) return { doc };
      const persistence = new IndexeddbPersistence(`margin-note:document:${documentId}`, doc);
      await persistence.whenSynced;
      return { doc, persistence };
    })();
    this.handles.set(documentId, opened);
    return opened;
  }

  private write(doc: Y.Doc, snapshot: DocumentMirrorSnapshot, origin: string): void {
    doc.transact(() => {
      const state = doc.getMap<unknown>('workspace');
      state.set('content', snapshot.content);
      state.set('extensions', JSON.parse(JSON.stringify(snapshot.extensions)));
      state.set('workspaceRevision', snapshot.workspaceRevision);
      state.set('durableRevision', snapshot.durableRevision);
      state.set('lastOrigin', origin);
    }, { kind: 'workspace-facade', origin });
  }
}

export function defaultDocumentDriver(): DocumentDriver {
  return typeof indexedDB === 'undefined' ? new NullDocumentDriver() : new YjsDocumentDriver(true);
}
