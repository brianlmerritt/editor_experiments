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
  CodexConnectionStatus,
  CodexLoginStart,
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
import type { ProjectArchiveExport, ProjectExportMode, ProjectExportSnapshot, ProjectImportPreview, ProjectImportResult } from '$lib/workspace/project-transfer';
import type { StorageAnalysis } from '$lib/workspace/retention';
import { defaultDocumentDriver, type DocumentDriver, type WorkspaceCommit } from '$lib/workspace/document-driver';

export interface LedgerStats {
  events: number;
  costUsd: number;
  codexTokens: number;
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
    private readonly documentDriver: DocumentDriver = defaultDocumentDriver(),
    private readonly mirrorWaitMs = 2_000
  ) {}

  private async settleMirror(operation: Promise<void>, label: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol('mirror_timeout');
    try {
      const result = await Promise.race([
        operation.then(() => null),
        new Promise<symbol>((resolve) => { timeout = setTimeout(() => resolve(timedOut), this.mirrorWaitMs); })
      ]);
      if (result === timedOut) console.warn(`[Margin Note] ${label} timed out; Svelte and durable storage remain authoritative.`);
    } catch (error) {
      console.warn(`[Margin Note] ${label} failed; Svelte and durable storage remain authoritative.`, error);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

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
    await this.settleMirror(this.documentDriver.hydrate({
      documentId: activeDocument.id,
      mirrorIdentity: {
        projectId: activeProject.id,
        projectTitle: activeProject.title,
        documentTitle: activeDocument.title
      },
      content: activeDocument.content,
      extensions: activeDocument.extensions,
      workspaceRevision,
      durableRevision: activeDocument.revision
    }), 'Document mirror hydration');
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
    await this.settleMirror(
      this.documentDriver.commit({ ...transaction, durableRevision: document.revision }),
      'Document mirror commit'
    );
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

  storageAnalysis(projectId?: string): Promise<StorageAnalysis> {
    return this.get(`/api/storage-report${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`);
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

  async deleteProject(project: WorkspaceProject, documents: WorkspaceDocument[]): Promise<{ workspace: PersistentWorkspace; mirrorCleanupWarning?: string }> {
    const result = await this.post<{ workspace: PersistentWorkspace }>('/api/workspace', { action: 'delete_project', id: project.id });
    try {
      await this.documentDriver.remove?.(documents.map((document) => ({
        documentId: document.id,
        mirrorIdentity: {
          projectId: project.id,
          projectTitle: project.title,
          documentTitle: document.title
        }
      })));
      return { workspace: result.workspace };
    } catch (error) {
      console.error('Project deleted, but browser recovery mirror cleanup failed.', error);
      return {
        workspace: result.workspace,
        mirrorCleanupWarning: 'The project was deleted from the server, but this browser could not remove every recovery mirror. Close other Margin Note tabs and clear site data if the old mirrors remain.'
      };
    }
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

  recoverInputs(request: GenerationRequest, errors: InputError[]): Promise<InputProposalBatch> {
    return this.post('/api/suggest/recover', { request, errors });
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

  async codexStatus(): Promise<CodexConnectionStatus> {
    const result = await this.get<{ status: CodexConnectionStatus }>('/api/codex');
    return result.status;
  }

  async startCodexLogin(): Promise<CodexLoginStart> {
    const result = await this.post<{ login: CodexLoginStart }>('/api/codex', { kind: 'login' });
    return result.login;
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

  async exportProject(snapshot: ProjectExportSnapshot, mode: ProjectExportMode = 'compact'): Promise<ProjectArchiveExport> {
    const response = await this.fetcher(`/api/project-export?mode=${mode}`, jsonRequest(snapshot));
    if (!response.ok) throw await responseError(response);
    return { blob: await response.blob(), filename: exportFilename(response) };
  }

  async inspectProjectImport(file: File): Promise<ProjectImportPreview> {
    const body = new FormData();
    body.set('action', 'inspect');
    body.set('file', file, file.name);
    const result = await jsonResponse<{ preview: ProjectImportPreview }>(await this.fetcher('/api/project-import', { method: 'POST', body }));
    return result.preview;
  }

  async importProject(file: File): Promise<ProjectImportResult> {
    const body = new FormData();
    body.set('action', 'import');
    body.set('file', file, file.name);
    return jsonResponse<ProjectImportResult>(await this.fetcher('/api/project-import', { method: 'POST', body }));
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
