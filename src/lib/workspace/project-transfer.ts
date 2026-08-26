import type { ContextBucket, WorkspaceDocument, WorkspaceProject } from './model';

export const projectTransferFormat = 'margin-note-project' as const;
export const projectTransferVersion = 1 as const;
export const projectTransferMimeType = 'application/vnd.margin-note.project+zip';
export type ProjectExportMode = 'compact' | 'forensic';

export interface ProjectExportSnapshot {
  project: WorkspaceProject;
  documents: WorkspaceDocument[];
  contextBuckets: ContextBucket[];
  capturedAt: string;
}

export interface ProjectTransferManifest {
  format: typeof projectTransferFormat;
  version: typeof projectTransferVersion;
  exportedAt: string;
  producer: { name: 'Margin Note'; version: string };
  project: { id: string; title: string; revision: number };
  exportMode: ProjectExportMode;
  counts: {
    documents: number;
    documentRevisions: number;
    contextBuckets: number;
    contextRevisions: number;
    assets: number;
    activeRuns: number;
  };
  omitted: {
    documentRevisions: number;
    contextRevisions: number;
  };
  safety: {
    providerCredentialsIncluded: false;
    paidProvidersEnabledOnImport: false;
  };
  files: string[];
}

export interface ProjectArchiveExport {
  blob: Blob;
  filename: string;
}
