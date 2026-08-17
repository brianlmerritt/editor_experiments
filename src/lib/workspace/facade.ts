import type {
  Branch,
  GenerationRequest,
  JudgmentPair,
  LedgerEvent,
  Suggestion,
  TaskPrompt,
  WritingBrief
} from '$lib/domain';

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
}

export interface SuggestionResult {
  suggestions: Suggestion[];
  errors: { source: string; message: string }[];
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
  constructor(private readonly fetcher: FetchLike = fetch) {}

  async load(): Promise<WorkspaceBootstrap> {
    const [settings, branches, eventFeed] = await Promise.all([
      this.get<{ brief: WritingBrief; prompts: TaskPrompt[] }>('/api/settings'),
      this.get<{ branches: Branch[] }>('/api/branches'),
      this.get<{ events: Required<LedgerEvent>[]; stats: LedgerStats }>('/api/events?limit=45')
    ]);
    return {
      brief: settings.brief,
      prompts: settings.prompts,
      branches: branches.branches,
      events: eventFeed.events,
      stats: eventFeed.stats
    };
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

  suggestions(request: GenerationRequest, signal?: AbortSignal): Promise<SuggestionResult> {
    return this.post('/api/suggest', request, signal);
  }

  async saveBrief(value: WritingBrief, sessionId: string, branchId: string): Promise<void> {
    await this.post('/api/settings', { kind: 'brief', value, sessionId, branchId });
  }

  async savePrompt(value: TaskPrompt, sessionId: string, branchId: string): Promise<void> {
    await this.post('/api/settings', { kind: 'prompt', value, sessionId, branchId });
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
