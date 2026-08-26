import type {
  Branch,
  GenerationRequest,
  InputError,
  InputProposal,
  ProviderUsage,
  JudgmentPair,
  LedgerEvent,
  SourceAvailability,
  ProviderProfileInput,
  TaskPrompt,
  WritingBrief
} from '$lib/domain';
import type {
  ContextBucket,
  ContextBucketRevision,
  ContextScope,
  DocumentRevision,
  ExtensionData,
  PersistentWorkspace,
  WorkspaceDocument,
  WorkspaceAsset,
  WorkspaceProject
} from '$lib/workspace/model';
import type { ProjectArchiveExport, ProjectExportSnapshot } from '$lib/workspace/project-transfer';
import { defaultDocumentDriver, type DocumentDriver, type WorkspaceCommit } from '$lib/workspace/document-driver';

export interface LedgerStats {
  events: number;
  costUsd: number;
}

export interface WorkspaceBootstrap {
  brief: WritingBrief;
  prompts: TaskPrompt[];
  branches: Branch[];
  events: Required<LedgerEvent>[];
  stats: LedgerStats;
  persistent: PersistentWorkspace;
  activeProjectId: string;
  activeDocumentId: string;
  sourceAvailability: Record<string, SourceAvailability>;
  providerSettingsError?: string;
}

export interface InputProposalBatch {
  proposals: InputProposal[];
  errors: InputError[];
  usage?: ProviderUsage[];
}

export interface MarkdownExport {
  blob: Blob;
  filename: string;
}

export interface JudgmentRecord {
  pairId: string;
  suggestionId: string;
  winner: string;
  reason: string;
  category: string;
  sessionId: string;
  branchId: string;
  presentationOrder: string[];
}

export interface CommitReceipt {
  transactionId: string;
  documentId: string;
  durableRevision: number;
  updatedAt: string;
}

export interface UploadedAsset extends WorkspaceAsset {
  url: string;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function responseError(response: Response): Promise<Error> {
  const body = await response.text();
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === 'string') return new Error(parsed.error);
    } catch {
      // Fall through to the status message for non-JSON responses.
    }
  }
  return new Error(`Workspace request failed (${response.status})`);
}

async function jsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await responseError(response);
  return response.json() as Promise<T>;
}

function jsonRequest(body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal
  };
}

function exportFilename(response: Response): string {
  const disposition = response.headers.get('content-disposition') ?? '';
  return disposition.match(/filename="([^"]+)"/)?.[1] ?? 'draft.md';
}

/**
 * The browser-facing boundary for workspace operations.
 *
 * UI state depends on this class rather than HTTP routes or their response shapes.
 * A different transport can be supplied in tests or when persistence changes.
 */
export class WorkspaceFacade {
  constructor(
    private readonly fetcher: FetchLike = fetch,
    private readonly documentDriver: DocumentDriver = defaultDocumentDriver()
  ) {}

  async load(preferred?: { projectId?: string; documentId?: string }): Promise<WorkspaceBootstrap> {
    const persistent = await this.get<PersistentWorkspace>('/api/workspace');
    const activeProject = persistent.projects.find((project) => project.id === preferred?.projectId) ?? persistent.projects[0];
    if (!activeProject) throw new Error('Workspace has no project');
    const projectDocuments = persistent.documents.filter((document) => document.projectId === activeProject.id);
    const activeDocument = projectDocuments.find((document) => document.id === preferred?.documentId) ?? projectDocuments[0];
    if (!activeDocument) throw new Error('Project has no document');
    const [settings, eventFeed] = await Promise.all([
      this.get<{ brief: WritingBrief; prompts: TaskPrompt[]; sourceAvailability?: Record<string, SourceAvailability>; providerSettingsError?: string }>('/api/settings'),
      this.get<{ events: Required<LedgerEvent>[]; stats: LedgerStats }>(`/api/events?history=suggestions&branch=${encodeURIComponent(activeDocument.id)}`)
    ]);
    const bootstrap: WorkspaceBootstrap = {
      brief: settings.brief,
      prompts: settings.prompts,
      branches: projectDocuments.map((document) => ({
        id: document.id,
        name: document.title,
        createdAt: document.updatedAt,
        wordCount: document.content.trim() ? document.content.trim().split(/\s+/).length : 0,
        lastEdited: document.updatedAt
      })),
      events: eventFeed.events,
      stats: eventFeed.stats,
      persistent,
      activeProjectId: activeProject.id,
      activeDocumentId: activeDocument.id,
      sourceAvailability: settings.sourceAvailability ?? {
        'local-craft': { available: true },
        'fake-sentinel': { available: true }
      },
      ...(settings.providerSettingsError ? { providerSettingsError: settings.providerSettingsError } : {})
    };
    const extension = activeDocument.extensions.margin_note;
    const workspaceRevision = extension && typeof extension === 'object' && !Array.isArray(extension)
      && typeof extension.revision === 'number' ? extension.revision : activeDocument.revision;
    await this.documentDriver.hydrate({
      documentId: activeDocument.id,
      content: activeDocument.content,
      extensions: activeDocument.extensions,
      workspaceRevision,
      durableRevision: activeDocument.revision
    });
    return bootstrap;
  }

  async commit(transaction: WorkspaceCommit): Promise<CommitReceipt> {
    const document = await this.saveDocument({
      id: transaction.documentId,
      content: transaction.content,
      extensions: transaction.extensions,
      createdBy: transaction.sessionId,
      reason: transaction.reason
    });
    await this.documentDriver.commit({ ...transaction, durableRevision: document.revision });
    return {
      transactionId: transaction.transactionId,
      documentId: document.id,
      durableRevision: document.revision,
      updatedAt: document.updatedAt
    };
  }

  persistentWorkspace(): Promise<PersistentWorkspace> {
    return this.get('/api/workspace');
  }

  async createProject(title: string): Promise<WorkspaceProject> {
    const result = await this.post<{ project: WorkspaceProject }>('/api/workspace', { action: 'create_project', title });
    return result.project;
  }

  async saveProject(id: string, title: string, extensions?: ExtensionData): Promise<WorkspaceProject> {
    const result = await this.post<{ project: WorkspaceProject }>('/api/workspace', { action: 'save_project', id, title, extensions });
    return result.project;
  }

  async resetProject(id: string): Promise<PersistentWorkspace> {
    const result = await this.post<{ workspace: PersistentWorkspace }>('/api/workspace', { action: 'reset_project', id });
    return result.workspace;
  }

  async createDocument(input: {
    id?: string;
    projectId: string;
    title: string;
    content?: string;
    role?: string;
    parentId?: string | null;
    extensions?: ExtensionData;
    createdBy?: string;
    reason?: string;
  }): Promise<WorkspaceDocument> {
    const result = await this.post<{ document: WorkspaceDocument }>('/api/workspace', { action: 'create_document', input });
    return result.document;
  }

  async saveDocument(input: { id: string; title?: string; content?: string; extensions?: ExtensionData; parentId?: string | null; order?: number; createdBy?: string; reason?: string }): Promise<WorkspaceDocument> {
    const result = await this.post<{ document: WorkspaceDocument }>('/api/workspace', { action: 'save_document', input });
    return result.document;
  }

  async deleteDocument(id: string): Promise<void> {
    await this.post('/api/workspace', { action: 'delete_document', id });
  }

  async restoreDocument(documentId: string, revisionId: string, sessionId: string): Promise<WorkspaceDocument> {
    const result = await this.post<{ document: WorkspaceDocument }>('/api/workspace', { action: 'restore_document', documentId, revisionId, sessionId });
    return result.document;
  }

  async documentRevisions(documentId: string): Promise<DocumentRevision[]> {
    const result = await this.get<{ revisions: DocumentRevision[] }>(`/api/workspace?document=${encodeURIComponent(documentId)}`);
    return result.revisions;
  }

  async uploadAsset(projectId: string, file: File): Promise<UploadedAsset> {
    const body = new FormData();
    body.set('projectId', projectId);
    body.set('file', file, file.name || 'Pasted image');
    const result = await jsonResponse<{ asset: WorkspaceAsset }>(await this.fetcher('/api/assets', { method: 'POST', body }));
    return { ...result.asset, url: `/api/assets/${encodeURIComponent(result.asset.id)}` };
  }

  async createContextBucket(input: {
    projectId: string;
    documentId?: string | null;
    scope: ContextScope;
    title: string;
    role?: string;
    content?: string;
    createdBy?: string;
  }): Promise<ContextBucket> {
    const result = await this.post<{ bucket: ContextBucket }>('/api/workspace', { action: 'create_bucket', input });
    return result.bucket;
  }

  async saveContextBucket(input: { id: string; title?: string; role?: string; content?: string; createdBy?: string; reason?: string }): Promise<ContextBucket> {
    const result = await this.post<{ bucket: ContextBucket }>('/api/workspace', { action: 'save_bucket', input });
    return result.bucket;
  }

  async deleteContextBucket(id: string): Promise<void> {
    await this.post('/api/workspace', { action: 'delete_bucket', id });
  }

  async contextBucketRevisions(bucketId: string): Promise<ContextBucketRevision[]> {
    const result = await this.get<{ revisions: ContextBucketRevision[] }>(`/api/workspace?bucket=${encodeURIComponent(bucketId)}`);
    return result.revisions;
  }

  async appendEvent(event: LedgerEvent): Promise<Required<LedgerEvent>> {
    const result = await this.post<{ event: Required<LedgerEvent> }>('/api/events', event);
    return result.event;
  }

  async events(limit = 45, branchId?: string): Promise<{ events: Required<LedgerEvent>[]; stats: LedgerStats }> {
    const query = new URLSearchParams({ limit: String(limit) });
    if (branchId) query.set('branch', branchId);
    return this.get(`/api/events?${query}`);
  }

  suggestionHistory(branchId: string): Promise<{ events: Required<LedgerEvent>[]; stats: LedgerStats }> {
    return this.get(`/api/events?history=suggestions&branch=${encodeURIComponent(branchId)}`);
  }

  requestInputs(request: GenerationRequest, signal?: AbortSignal): Promise<InputProposalBatch> {
    return this.post('/api/suggest', request, signal);
  }

  async saveBrief(value: WritingBrief, sessionId: string, branchId: string): Promise<void> {
    await this.post('/api/settings', { kind: 'brief', value, sessionId, branchId });
  }

  async savePrompt(value: TaskPrompt, sessionId: string, branchId: string): Promise<void> {
    await this.post('/api/settings', { kind: 'prompt', value, sessionId, branchId });
  }

  async configureOpenRouter(key: string, model: string): Promise<Record<string, SourceAvailability>> {
    const result = await this.configureProvider({
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1', key, model
    });
    return result.sourceAvailability;
  }

  configureProvider(profile: ProviderProfileInput): Promise<{ profileId: string; sourceAvailability: Record<string, SourceAvailability> }> {
    return this.post('/api/settings', { kind: 'provider_profile', profile });
  }

  async deleteProvider(id: string): Promise<Record<string, SourceAvailability>> {
    const result = await this.post<{ sourceAvailability: Record<string, SourceAvailability> }>('/api/settings', { kind: 'delete_provider_profile', id });
    return result.sourceAvailability;
  }

  async createBranch(branch: Branch, sessionId: string): Promise<Branch[]> {
    const result = await this.post<{ branches: Branch[] }>('/api/branches', { ...branch, sessionId });
    return result.branches;
  }

  async exportMarkdown(input: { markdown: string; title?: string; sessionId: string; branchId: string }): Promise<MarkdownExport> {
    const response = await this.fetcher('/api/export', jsonRequest(input));
    if (!response.ok) throw await responseError(response);
    return { blob: await response.blob(), filename: exportFilename(response) };
  }

  async exportProject(snapshot: ProjectExportSnapshot): Promise<ProjectArchiveExport> {
    const response = await this.fetcher('/api/project-export', jsonRequest(snapshot));
    if (!response.ok) throw await responseError(response);
    return { blob: await response.blob(), filename: exportFilename(response) };
  }

  async reviewPairs(scope?: { sessionId?: string; branchId?: string }): Promise<JudgmentPair[]> {
    const query = new URLSearchParams();
    if (scope?.sessionId) query.set('session', scope.sessionId);
    if (scope?.branchId) query.set('branch', scope.branchId);
    const result = await this.get<{ pairs: JudgmentPair[] }>(`/api/review${query.size ? `?${query}` : ''}`);
    return result.pairs;
  }

  async recordJudgment(record: JudgmentRecord): Promise<void> {
    await this.post('/api/review', record);
  }

  private async get<T>(path: string): Promise<T> {
    return jsonResponse<T>(await this.fetcher(path));
  }

  private async post<T = unknown>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return jsonResponse<T>(await this.fetcher(path, jsonRequest(body, signal)));
  }
}

export const workspaceFacade = new WorkspaceFacade();
