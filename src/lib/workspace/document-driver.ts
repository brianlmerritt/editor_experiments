import { clearDocument, IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import type { ExtensionData } from './model';

export interface DocumentMirrorSnapshot {
  documentId: string;
  mirrorIdentity?: DocumentMirrorIdentity;
  content: string;
  extensions: ExtensionData;
  workspaceRevision: number;
  durableRevision: number;
}

export interface DocumentMirrorIdentity {
  projectId: string;
  projectTitle: string;
  documentTitle: string;
}

export interface DocumentMirrorTarget {
  documentId: string;
  mirrorIdentity: DocumentMirrorIdentity;
}

export interface WorkspaceCommit extends DocumentMirrorSnapshot {
  transactionId: string;
  sessionId: string;
  reason: string;
}

export interface DocumentDriver {
  hydrate(snapshot: DocumentMirrorSnapshot): Promise<void>;
  commit(transaction: WorkspaceCommit): Promise<void>;
  remove?(documents: DocumentMirrorTarget[]): Promise<void>;
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
    const handle = await this.open(snapshot.documentId, snapshot.mirrorIdentity);
    this.write(handle.doc, snapshot, 'hydrate');
  }

  async commit(transaction: WorkspaceCommit): Promise<void> {
    const handle = await this.open(transaction.documentId, transaction.mirrorIdentity);
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

  async remove(documents: DocumentMirrorTarget[]): Promise<void> {
    for (const document of documents) {
      const openHandle = this.handles.get(document.documentId);
      if (openHandle) {
        const handle = await openHandle;
        if (handle.persistence) await handle.persistence.clearData();
        this.handles.delete(document.documentId);
      } else if (this.persist) {
        await clearDocument(documentMirrorDatabaseName(document.documentId, document.mirrorIdentity));
      }
      if (this.persist) await clearDocument(documentMirrorDatabaseName(document.documentId));
    }
  }

  private open(documentId: string, identity?: DocumentMirrorIdentity): Promise<YjsHandle> {
    const existing = this.handles.get(documentId);
    if (existing) return existing;
    const opened = (async () => {
      const doc = new Y.Doc();
      if (!this.persist) return { doc };
      const persistence = new IndexeddbPersistence(documentMirrorDatabaseName(documentId, identity), doc);
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

function readableStoragePart(value: string, fallback: string): string {
  const readable = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return readable || fallback;
}

function stableStorageSuffix(value: string): string {
  const suffix = value.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(-12);
  return suffix || 'unknown';
}

/**
 * Human-readable IndexedDB identity for the device-local recovery mirror.
 * Stable ID suffixes prevent projects or documents with identical titles colliding.
 */
export function documentMirrorDatabaseName(documentId: string, identity?: DocumentMirrorIdentity): string {
  if (!identity) return `margin-note:document:${documentId}`;
  const project = readableStoragePart(identity.projectTitle, 'untitled-project');
  const document = readableStoragePart(identity.documentTitle, 'untitled-document');
  return `margin-note:document:${project}-${stableStorageSuffix(identity.projectId)}:${document}-${stableStorageSuffix(documentId)}`;
}

export function defaultDocumentDriver(): DocumentDriver {
  return typeof indexedDB === 'undefined' ? new NullDocumentDriver() : new YjsDocumentDriver(true);
}
