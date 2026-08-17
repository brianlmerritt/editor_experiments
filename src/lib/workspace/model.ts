export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ExtensionData = Record<string, JsonValue>;

export interface WorkspaceProject {
  id: string;
  title: string;
  revision: number;
  extensions: ExtensionData;
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
}

export type WorkspaceNode = WorkspaceContainer | WorkspaceDocument;

export interface DocumentRevision {
  id: string;
  documentId: string;
  number: number;
  content: string;
  createdAt: string;
  createdBy?: string;
  reason?: string;
}
