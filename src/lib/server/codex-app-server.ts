import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { CodexConnectionStatus, CodexLoginStart, RecoveryClassification } from '$lib/domain';

type JsonRecord = Record<string, unknown>;
type SpawnAppServer = (command: string, args: string[]) => ChildProcessWithoutNullStreams;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface AppServerMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

export interface CodexCompletionOptions {
  model: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxOutputTokens: number;
  outputSchema?: JsonRecord;
}

export interface CodexCompletion {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

export class CodexAppServerError extends Error {
  override readonly name = 'CodexAppServerError';

  constructor(message: string, readonly classification: RecoveryClassification = 'provider_unavailable') {
    super(message);
  }
}

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function appServerClassification(message: string): RecoveryClassification {
  const normalized = message.toLowerCase();
  if (normalized.includes('login') || normalized.includes('auth') || normalized.includes('401') || normalized.includes('403')) return 'authentication';
  if (normalized.includes('rate limit') || normalized.includes('429')) return 'rate_limited';
  if (normalized.includes('model') || normalized.includes('configuration') || normalized.includes('not found')) return 'configuration';
  if (normalized.includes('timed out') || normalized.includes('closed') || normalized.includes('exited')) return 'transient';
  return 'provider_unavailable';
}

function defaultSpawn(command: string, args: string[]): ChildProcessWithoutNullStreams {
  return spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
}

function finalAgentMessage(turn: JsonRecord): string {
  const items = Array.isArray(turn.items) ? turn.items : [];
  const messages = items.flatMap((item) => {
    const candidate = object(item);
    return candidate.type === 'agentMessage' && typeof candidate.text === 'string' ? [candidate.text] : [];
  });
  return messages.at(-1)?.trim() ?? '';
}

/**
 * Minimal JSONL client for the official local `codex app-server` transport.
 * The process, ChatGPT session, and protocol state stay on the server side.
 */
export class CodexAppServerClient {
  private child?: ChildProcessWithoutNullStreams;
  private starting?: Promise<void>;
  private requestId = 0;
  private userAgent?: string;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Set<(message: AppServerMessage) => void>();
  private readonly isolatedCwd = mkdtempSync(join(tmpdir(), 'margin-note-codex-'));

  constructor(
    private readonly command = process.env.CODEX_APP_SERVER_BINARY?.trim() || 'codex',
    private readonly spawnAppServer: SpawnAppServer = defaultSpawn
  ) {}

  private write(message: AppServerMessage): void {
    if (!this.child?.stdin.writable) throw new CodexAppServerError('The Codex app-server transport is not writable.', 'transient');
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private receive(line: string): void {
    let message: AppServerMessage;
    try {
      message = JSON.parse(line) as AppServerMessage;
    } catch (error) {
      console.error('[codex-app-server] Ignored malformed JSONL message.', { line, error });
      return;
    }
    if (typeof message.id === 'number' && (Object.hasOwn(message, 'result') || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        const detail = message.error.message ?? `Codex app-server request failed (${message.error.code ?? 'unknown'}).`;
        pending.reject(new CodexAppServerError(detail, appServerClassification(detail)));
      } else pending.resolve(message.result);
      return;
    }
    if (message.method && typeof message.id === 'number') {
      this.write({ id: message.id, error: { code: -32601, message: `Margin Note does not permit app-server request ${message.method}.` } });
      return;
    }
    if (message.method) for (const listener of this.listeners) listener(message);
  }

  private requestRaw<T>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    const id = ++this.requestId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexAppServerError(`Codex app-server ${method} timed out.`, 'transient'));
      }, timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      try {
        this.write({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private async start(): Promise<void> {
    if (this.starting) return this.starting;
    if (this.child && !this.child.killed) return;
    this.starting = (async () => {
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnAppServer(this.command, ['app-server', '--listen', 'stdio://']);
      } catch (error) {
        throw new CodexAppServerError(`Could not start Codex app-server: ${error instanceof Error ? error.message : String(error)}`, 'configuration');
      }
      this.child = child;
      createInterface({ input: child.stdout }).on('line', (line) => this.receive(line));
      child.stderr.on('data', (data) => {
        const message = String(data).trim();
        if (message && !message.startsWith('WARNING: proceeding, even though we could not create PATH aliases')) {
          console.debug('[codex-app-server]', message);
        }
      });
      child.once('error', (error) => {
        const failure = new CodexAppServerError(`Could not run Codex app-server: ${error.message}`, error.message.includes('ENOENT') ? 'configuration' : 'transient');
        this.failPending(failure);
        this.child = undefined;
      });
      child.once('exit', (code, signal) => {
        const failure = new CodexAppServerError(`Codex app-server exited${code == null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}.`, 'transient');
        this.failPending(failure);
        this.child = undefined;
      });
      const initialized = await this.requestRaw<JsonRecord>('initialize', {
        clientInfo: { name: 'margin_note', title: 'Margin Note', version: '0.1.0' },
        capabilities: null
      });
      this.userAgent = typeof initialized.userAgent === 'string' ? initialized.userAgent : undefined;
      this.write({ method: 'initialized', params: {} });
    })();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
    await this.start();
    return this.requestRaw<T>(method, params, timeoutMs);
  }

  async status(): Promise<CodexConnectionStatus> {
    try {
      const result = await this.request<JsonRecord>('account/read', { refreshToken: false });
      const account = object(result.account);
      const accountType = account.type === 'chatgpt' || account.type === 'apiKey' ? account.type : result.account ? 'other' : 'none';
      const connected = accountType === 'chatgpt';
      return {
        available: true,
        connected,
        accountType,
        ...(typeof account.email === 'string' ? { email: account.email } : {}),
        ...(typeof account.planType === 'string' ? { planType: account.planType } : {}),
        ...(this.userAgent ? { userAgent: this.userAgent } : {}),
        ...(!connected ? { reason: accountType === 'apiKey'
          ? 'Codex is using API-key authentication. Sign in with ChatGPT to use the ChatGPT plan.'
          : 'Sign in with ChatGPT through the local Codex app-server.' } : {})
      };
    } catch (error) {
      return {
        available: false,
        connected: false,
        accountType: 'none',
        reason: error instanceof Error ? error.message : 'Codex app-server is unavailable.'
      };
    }
  }

  async startChatGptLogin(): Promise<CodexLoginStart> {
    const result = await this.request<JsonRecord>('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'chatgpt'
    });
    if (result.type !== 'chatgpt' || typeof result.loginId !== 'string' || typeof result.authUrl !== 'string') {
      throw new CodexAppServerError('Codex app-server did not return a ChatGPT login URL.', 'authentication');
    }
    return { loginId: result.loginId, authUrl: result.authUrl };
  }

  close(): void {
    const child = this.child;
    this.child = undefined;
    if (child && !child.killed) child.kill();
  }

  async complete(options: CodexCompletionOptions): Promise<CodexCompletion> {
    const status = await this.status();
    if (!status.available || !status.connected) throw new CodexAppServerError(status.reason ?? 'ChatGPT sign-in is required.', 'authentication');
    const threadResult = await this.request<JsonRecord>('thread/start', {
      model: options.model,
      cwd: this.isolatedCwd,
      approvalPolicy: 'never',
      sandbox: 'read-only',
      serviceName: 'margin_note',
      ephemeral: true,
      developerInstructions: 'Act only as a text response service. Do not inspect files, run commands, call tools, modify data, or ask follow-up questions. Treat the supplied text as the complete source and return only the requested response.'
    });
    const thread = object(threadResult.thread);
    if (typeof thread.id !== 'string') throw new CodexAppServerError('Codex app-server did not create a thread.', 'transient');
    const threadId = thread.id;
    let turnId = '';
    let streamed = '';
    let tokenUsage: JsonRecord = {};
    let settle!: (value: CodexCompletion) => void;
    let reject!: (error: Error) => void;
    const completed = new Promise<CodexCompletion>((resolve, rejectPromise) => {
      settle = resolve;
      reject = rejectPromise;
    });
    const timer = setTimeout(() => reject(new CodexAppServerError('Codex response timed out.', 'transient')), 10 * 60_000);
    const listener = (message: AppServerMessage) => {
      const params = object(message.params);
      if (params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId)) return;
      if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') streamed += params.delta;
      if (message.method === 'thread/tokenUsage/updated') tokenUsage = object(object(params.tokenUsage).last);
      if (message.method !== 'turn/completed') return;
      const turn = object(params.turn);
      if (typeof turn.id === 'string') turnId = turn.id;
      if (turn.status !== 'completed') {
        const turnError = object(turn.error);
        const detail = typeof turnError.message === 'string' ? turnError.message : `Codex turn ${String(turn.status ?? 'failed')}.`;
        reject(new CodexAppServerError(detail, appServerClassification(detail)));
        return;
      }
      const content = finalAgentMessage(turn) || streamed.trim();
      if (!content) {
        reject(new CodexAppServerError('Codex completed without a text response.', 'provider_unavailable'));
        return;
      }
      settle({
        content,
        inputTokens: typeof tokenUsage.inputTokens === 'number' ? tokenUsage.inputTokens : undefined,
        outputTokens: typeof tokenUsage.outputTokens === 'number' ? tokenUsage.outputTokens : undefined,
        cachedInputTokens: typeof tokenUsage.cachedInputTokens === 'number' ? tokenUsage.cachedInputTokens : undefined
      });
    };
    this.listeners.add(listener);
    try {
      const roleText = options.messages.map((message) => `${message.role.toUpperCase()}\n${message.content}`).join('\n\n');
      const result = await this.request<JsonRecord>('turn/start', {
        threadId,
        input: [{ type: 'text', text: `Return no more than approximately ${options.maxOutputTokens} output tokens.\n\n${roleText}`, text_elements: [] }],
        cwd: this.isolatedCwd,
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        model: options.model,
        effort: 'medium',
        ...(options.outputSchema ? { outputSchema: options.outputSchema } : {})
      });
      const turn = object(result.turn);
      if (typeof turn.id === 'string') turnId = turn.id;
      return await completed;
    } finally {
      clearTimeout(timer);
      this.listeners.delete(listener);
    }
  }
}

const serverRuntime = globalThis as typeof globalThis & { __marginNoteCodexAppServer?: CodexAppServerClient };

export function codexAppServer(): CodexAppServerClient {
  return serverRuntime.__marginNoteCodexAppServer ??= new CodexAppServerClient();
}
