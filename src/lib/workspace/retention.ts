export interface DocumentStorageAnalysis {
  documentId: string;
  title: string;
  currentBytes: number;
  revisionCount: number;
  revisionBytes: number;
  sameProseRevisionCount: number;
  sameProseRevisionBytes: number;
}

export interface ProjectStorageAnalysis {
  projectId: string;
  title: string;
  currentBytes: number;
  revisionCount: number;
  revisionBytes: number;
  sameProseRevisionCount: number;
  sameProseRevisionBytes: number;
  assetCount: number;
  assetBytes: number;
  documents: DocumentStorageAnalysis[];
}

export interface StorageAnalysis {
  generatedAt: string;
  readOnly: true;
  databaseBytes: number;
  freePageBytes: number;
  currentBytes: number;
  revisionCount: number;
  revisionBytes: number;
  normalizationCandidateBytes: number;
  safeReclaimableBytes: 0;
  projects: ProjectStorageAnalysis[];
}
