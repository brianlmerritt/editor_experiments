export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ExtensionData = Record<string, JsonValue>;

export interface WorkspaceProject {
  id: string;
  title: string;
  revision: number;
  extensions: ExtensionData;
  updatedAt: string;
}

interface WorkspaceNodeBase {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  order: number;
  revision: number;
  role?: string;
  extensions: ExtensionData;
}

export interface WorkspaceContainer extends WorkspaceNodeBase {
  kind: 'container';
}

export interface WorkspaceDocument extends WorkspaceNodeBase {
  kind: 'document';
  content: string;
  updatedAt: string;
}

export type WorkspaceNode = WorkspaceContainer | WorkspaceDocument;

export interface DocumentRevision {
  id: string;
  documentId: string;
  number: number;
  title: string;
  content: string;
  extensions: ExtensionData;
  createdAt: string;
  createdBy?: string;
  reason?: string;
}

export type ContextScope = 'project' | 'document';

export interface ContextBucket {
  id: string;
  projectId: string;
  documentId: string | null;
  scope: ContextScope;
  title: string;
  role?: string;
  content: string;
  revision: number;
  extensions: ExtensionData;
  updatedAt: string;
}

export interface ContextBucketRevision {
  id: string;
  bucketId: string;
  number: number;
  title: string;
  role?: string;
  content: string;
  createdAt: string;
  createdBy?: string;
  reason?: string;
}

export interface PersistentWorkspace {
  projects: WorkspaceProject[];
  documents: WorkspaceDocument[];
  contextBuckets: ContextBucket[];
}
