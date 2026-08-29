import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAppServerClient } from './codex-app-server';

class FakeAppServer extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  requests: Array<Record<string, unknown>> = [];
  private input = '';

  constructor() {
    super();
    this.stdin.on('data', (chunk) => {
      this.input += String(chunk);
      let newline = this.input.indexOf('\n');
      while (newline >= 0) {
        const line = this.input.slice(0, newline);
        this.input = this.input.slice(newline + 1);
        if (line) this.handle(JSON.parse(line) as Record<string, unknown>);
        newline = this.input.indexOf('\n');
      }
    });
  }

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }

  private send(message: unknown): void {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  private handle(request: Record<string, unknown>): void {
    this.requests.push(request);
    if (typeof request.id !== 'number') return;
    if (request.method === 'initialize') this.send({ id: request.id, result: { userAgent: 'codex-test', codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos' } });
    if (request.method === 'account/read') this.send({ id: request.id, result: { account: { type: 'chatgpt', email: 'writer@example.test', planType: 'plus' }, requiresOpenaiAuth: true } });
    if (request.method === 'account/login/start') this.send({ id: request.id, result: { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.example.test/' } });
    if (request.method === 'thread/start') this.send({ id: request.id, result: { thread: { id: 'thread-1' } } });
    if (request.method === 'turn/start') {
      this.send({ id: request.id, result: { turn: { id: 'turn-1', status: 'inProgress', items: [] } } });
      this.send({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 120, outputTokens: 32, cachedInputTokens: 20 } } } });
      this.send({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed', error: null, items: [{ type: 'agentMessage', id: 'message-1', text: '{"suggestions":[]}' }] } } });
    }
  }
}

describe('Codex app-server client', () => {
  let client: CodexAppServerClient | undefined;
  afterEach(() => client?.close());

  it('uses the local ChatGPT account without exposing credentials', async () => {
    const process = new FakeAppServer();
    client = new CodexAppServerClient('codex-test', () => process as unknown as ChildProcessWithoutNullStreams);

    await expect(client.status()).resolves.toMatchObject({
      available: true, connected: true, accountType: 'chatgpt', email: 'writer@example.test', planType: 'plus', userAgent: 'codex-test'
    });
    await expect(client.startChatGptLogin()).resolves.toEqual({ loginId: 'login-1', authUrl: 'https://auth.example.test/' });

    const login = process.requests.find((request) => request.method === 'account/login/start');
    expect(login?.params).toEqual({ type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' });
    expect(JSON.stringify(process.requests)).not.toContain('apiKey');
  });

  it('runs an ephemeral, read-only turn and returns usage with its final message', async () => {
    const process = new FakeAppServer();
    client = new CodexAppServerClient('codex-test', () => process as unknown as ChildProcessWithoutNullStreams);
    const outputSchema = { type: 'object', properties: { suggestions: { type: 'array' } } };

    await expect(client.complete({
      model: 'gpt-5.6-terra',
      messages: [{ role: 'user', content: 'Review this passage.' }],
      maxOutputTokens: 6000,
      outputSchema
    })).resolves.toEqual({ content: '{"suggestions":[]}', inputTokens: 120, outputTokens: 32, cachedInputTokens: 20 });

    const thread = process.requests.find((request) => request.method === 'thread/start');
    expect(thread?.params).toMatchObject({
      model: 'gpt-5.6-terra', approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, serviceName: 'margin_note'
    });
    const turn = process.requests.find((request) => request.method === 'turn/start');
    expect(turn?.params).toMatchObject({
      threadId: 'thread-1', approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false }, outputSchema
    });
  });
});
