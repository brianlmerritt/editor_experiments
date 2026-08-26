import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest, TaskPrompt } from '$lib/domain';
import { configureProviderProfile, configureSuggestionProvider, generateSuggestions, parseProviderSuggestions, resolveProviderRange, suggestionSourceAvailability } from './suggesters';

const providerRuntime = globalThis as typeof globalThis & { __marginNoteProviderSettings?: unknown };

afterEach(() => {
  vi.unstubAllGlobals();
  delete providerRuntime.__marginNoteProviderSettings;
});

function request(text: string, prompt: TaskPrompt): GenerationRequest {
  return {
    text,
    from: 10,
    to: 10 + text.length,
    branchId: 'main',
    sessionId: 'test',
    brief: { version: 1, form: 'fiction', pov: 'third person', tense: 'past', distance: 'close', canon: '' },
    prompt,
    sourceStates: { 'local-craft': 'off', 'fake-sentinel': 'visible', openrouter: 'off', ollama: 'off' },
    mode: 'revising'
  };
}

describe('selection suggestions', () => {
  it('migrates provider runtime state left alive by a development hot reload', () => {
    providerRuntime.__marginNoteProviderSettings = {
      openrouter: { key: 'test-key', model: 'provider/model', persistence: 'local_file' },
      ollama: { model: 'local/model', baseUrl: 'http://127.0.0.1:11434/v1' }
    };

    expect(suggestionSourceAvailability()).toMatchObject({
      openrouter: { available: true, name: 'OpenRouter', model: 'provider/model' },
      ollama: { available: true, name: 'Ollama', model: 'local/model' }
    });
  });

  it('returns distinct word alternatives instead of the selected source text', async () => {
    const result = await generateSuggestions(request('noticed', {
      id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.'
    }));

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].variants).toEqual(['saw', 'observed']);
    expect(result.proposals[0].variants.every((variant) => variant !== 'noticed')).toBe(true);
  });

  it('does not pretend cadence can be changed in a one-word selection', async () => {
    const result = await generateSuggestions(request('noticed', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    }));

    expect(result.proposals[0]).toMatchObject({ type: 'annotation', category: 'cadence', variants: [] });
    expect(result.proposals[0].comment).toContain('Select at least four words');
  });

  it('offers grammatical cadence alternatives around a conjunction pivot', async () => {
    const result = await generateSuggestions(request('Mara noticed the clock, and she stopped.', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    }));

    expect(result.proposals[0].variants).toEqual([
      'Mara noticed the clock. And she stopped.',
      'Mara noticed the clock — and she stopped.'
    ]);
  });

  it('does not fabricate a cadence rewrite when the local replay has no safe pivot', async () => {
    const result = await generateSuggestions(request('Mara crossed the empty platform alone.', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    }));

    expect(result.proposals[0]).toMatchObject({ type: 'annotation', variants: [] });
    expect(result.proposals[0].comment).toContain('no safe replay alternative');
  });

  it('removes no-op variants from replacement suggestions', async () => {
    const result = await generateSuggestions(request('quietly', {
      id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Review it.'
    }));

    expect(result.proposals[0].variants).toEqual(['']);
  });

  it('uses a configured provider instead of showing the scripted cadence fallback', async () => {
    configureSuggestionProvider({ source: 'openrouter', key: 'test-key', model: 'provider/model' }, { persist: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        suggestions: [{
          from: 0,
          to: 38,
          source_text: 'Mara crossed the empty platform alone.',
          type: 'replacement',
          category: 'cadence',
          comment: 'Vary the sentence movement.',
          variants: ['Alone, Mara crossed the empty platform.', 'Mara crossed the platform. Empty. Alone.'],
          confidence: 0.84
        }]
      }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 30, cost: 0.42 }
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const providerRequest = request('Mara crossed the empty platform alone.', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    });
    providerRequest.sourceStates.openrouter = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(result.errors).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].source).toBe('openrouter');
    expect(result.proposals[0].variants).toHaveLength(2);
    expect(result.proposals[0].comment).not.toContain('no safe replay alternative');
    expect(result.usage).toEqual([expect.objectContaining({ source: 'openrouter', costUsd: 0.42, costBasis: 'provider_reported' })]);
  });

  it('retries once with a corrective request after unrecoverable provider output', async () => {
    configureSuggestionProvider({ source: 'openrouter', key: 'test-key', model: 'provider/model' }, { persist: false });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: 'No structured result was returned.' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.01 }
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          suggestions: [{
            from: 0,
            to: 7,
            source_text: 'noticed',
            type: 'replacement',
            category: 'diction',
            comment: 'Use a more direct verb.',
            variants: ['observed'],
            confidence: 0.8
          }]
        }) } }],
        usage: { prompt_tokens: 18, completion_tokens: 12, cost: 0.02 }
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const providerRequest = request('noticed', {
      id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.'
    });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates.openrouter = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual([expect.objectContaining({
      source: 'openrouter',
      kind: 'provider_output',
      attempt: 1,
      recovered: true,
      outcome: 'recovered_by_retry',
      rawOutput: 'No structured result was returned.'
    })]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].provenance).toMatchObject({
      providerAttempts: 2,
      inputTokens: 28,
      outputTokens: 17
    });
    expect(result.usage).toEqual([expect.objectContaining({ attempts: 2, inputTokens: 28, outputTokens: 17, costUsd: 0.03 })]);
    const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body as string) as { messages: { role: string; content: string }[] };
    expect(retryBody.messages.at(-1)?.content).toContain('previous response was rejected');
  });

  it('returns a console-ready diagnostic when malformed output is repaired locally', async () => {
    configureSuggestionProvider({ source: 'openrouter', key: 'test-key', model: 'provider/model' }, { persist: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: `\`\`\`json
{suggestions:[{from:0,to:7,source_text:'noticed',type:'replacement',category:'diction',comment:'Use a direct verb.',variants:['observed'],confidence:0.8,}]}
\`\`\`` } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const providerRequest = request('noticed', {
      id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.'
    });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates.openrouter = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(result.proposals).toHaveLength(1);
    expect(result.errors).toEqual([expect.objectContaining({
      source: 'openrouter',
      recovered: true,
      outcome: 'repaired_locally',
      rawOutput: expect.stringContaining('```json')
    })]);
  });

  it('classifies valid fenced JSON with trailing explanation as normalization rather than malformed output', async () => {
    configureSuggestionProvider({ source: 'openrouter', key: 'test-key', model: 'provider/model' }, { persist: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: `\`\`\`json
{"suggestions": []}
\`\`\`

No substantive issues detected.` } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const providerRequest = request('noticed', {
      id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Review it.'
    });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates.openrouter = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(result.proposals).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({
      source: 'openrouter',
      classification: 'output_nonconforming',
      recoveryAction: 'extract_local',
      recovered: true,
      outcome: 'normalized_locally',
      message: 'Valid JSON was extracted from surrounding provider text.'
    })]);
  });

  it('recovers suggestions from a fenced JSON provider response', () => {
    const suggestions = parseProviderSuggestions(`Here is the requested result:\n\n\`\`\`json
{
  "suggestions": [{
    "from": 0,
    "to": 12,
    "type": "replacement",
    "category": "cadence",
    "comment": "Change the rhythm.",
    "variants": ["First alternative.", "Second alternative."],
    "confidence": 0.82
  }]
}
\`\`\``);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ from: 0, to: 12, category: 'cadence', confidence: 0.82 });
    expect(suggestions[0].variants).toEqual(['First alternative.', 'Second alternative.']);
  });

  it('recovers surrounding JSON, removes trailing commas, and validates fields', () => {
    const suggestions = parseProviderSuggestions(`Result follows: {"suggestions":[{"from":0,"to":4,"type":"replacement","category":"distance","variants":["That"],"confidence":4,}],} End.`);

    expect(suggestions).toEqual([expect.objectContaining({
      from: 0,
      to: 4,
      category: 'distance',
      confidence: 1,
      comment: 'AI craft suggestion.'
    })]);
  });

  it('repairs common AI JSON damage before validating the suggestion schema', () => {
    const suggestions = parseProviderSuggestions(`\`\`\`json
{suggestions:[{from:0,to:4,source_text:'Mara',type:'annotation',category:'distance',comment:'Render the response physically.',variants:[],confidence:0.8,}]
`);

    expect(suggestions).toEqual([expect.objectContaining({
      from: 0,
      to: 4,
      sourceText: 'Mara',
      category: 'distance',
      confidence: 0.8
    })]);
  });

  it('rejects a response whose suggestions do not match the required schema', () => {
    expect(() => parseProviderSuggestions('{"suggestions":[{"from":"zero","to":4}]}'))
      .toThrow('none matched the required suggestion schema');
  });

  it('classifies exhausted malformed provider output separately from request failures', async () => {
    configureSuggestionProvider({ source: 'openrouter', key: 'test-key', model: 'provider/model' }, { persist: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'This is not JSON and contains no structured result.' } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const providerRequest = request('Mara crossed the empty platform alone.', {
      id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Review it.'
    });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates.openrouter = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(result.proposals).toEqual([]);
    expect(result.errors).toEqual([
      expect.objectContaining({ source: 'openrouter', kind: 'provider_output', attempt: 1, outcome: 'retry_requested', recovered: false }),
      expect.objectContaining({ source: 'openrouter', kind: 'provider_output', attempt: 2, outcome: 'retry_requested', recovered: false }),
      expect.objectContaining({ source: 'openrouter', kind: 'provider_output', attempt: 3, outcome: 'rejected', recovered: false, recoveryAction: 'human' })
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('uses the Anthropic Messages protocol for an Anthropic profile', async () => {
    configureProviderProfile({
      id: 'anthropic-test', name: 'Anthropic test', protocol: 'anthropic',
      baseUrl: 'https://api.anthropic.test/v1', key: 'test-key', model: 'claude-haiku-4-5-20251001'
    }, { persist: false });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ suggestions: [{
        from: 0, to: 7, source_text: 'noticed', type: 'replacement', category: 'diction',
        comment: 'Use a direct verb.', variants: ['observed'], confidence: 0.8
      }] }) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 21, output_tokens: 13 }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const providerRequest = request('noticed', { id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.' });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates['anthropic-test'] = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(result.proposals[0]).toMatchObject({ source: 'anthropic-test', variants: ['observed'] });
    expect(result.proposals[0].provenance).toMatchObject({ model: 'claude-haiku-4-5-20251001', inputTokens: 21, outputTokens: 13 });
    expect(result.usage).toEqual([expect.objectContaining({ costUsd: 0.000086, costBasis: 'estimated' })]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.anthropic.test/v1/messages');
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ 'x-api-key': 'test-key', 'anthropic-version': '2023-06-01' });
  });

  it('retries transient provider failures and records the recovered attempt', async () => {
    configureProviderProfile({
      id: 'transient-test', name: 'Transient test', protocol: 'openai_compatible',
      baseUrl: 'https://transient.test/v1', key: 'test-key', model: 'test-model'
    }, { persist: false });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Temporarily unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' }, finish_reason: 'stop' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const providerRequest = request('noticed', { id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.' });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates['transient-test'] = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual([expect.objectContaining({
      source: 'transient-test', classification: 'transient', recoveryAction: 'retry_transient',
      attempt: 1, recovered: true, outcome: 'recovered_by_retry'
    })]);
  });

  it('routes network exceptions through the same bounded recovery history', async () => {
    configureProviderProfile({
      id: 'network-test', name: 'Network test', protocol: 'openai_compatible',
      baseUrl: 'https://network.test/v1', key: 'test-key', model: 'test-model'
    }, { persist: false });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' }, finish_reason: 'stop' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const providerRequest = request('noticed', { id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.' });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates['network-test'] = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.errors).toEqual([expect.objectContaining({
      source: 'network-test', classification: 'transient', attempt: 1, recovered: true
    })]);
  });

  it('increases the output budget after explicit truncation', async () => {
    configureProviderProfile({
      id: 'truncated-test', name: 'Truncated test', protocol: 'openai_compatible',
      baseUrl: 'https://truncated.test/v1', key: 'test-key', model: 'test-model'
    }, { persist: false });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[' }, finish_reason: 'length' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestions":[]}' }, finish_reason: 'stop' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const providerRequest = request('noticed', { id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.' });
    providerRequest.sourceStates['fake-sentinel'] = 'off';
    providerRequest.sourceStates['truncated-test'] = 'visible';

    const result = await generateSuggestions(providerRequest);

    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(firstBody.max_tokens).toBe(6000);
    expect(secondBody.max_tokens).toBe(12000);
    expect(result.errors).toEqual([expect.objectContaining({
      source: 'truncated-test', classification: 'truncated', recoveryAction: 'increase_budget', recovered: true
    })]);
  });

  it('repairs wrong provider offsets only when source text has one exact match', () => {
    expect(resolveProviderRange({ from: 0, to: 7, sourceText: 'clock', type: 'replacement' }, 'Mara saw the clock stop.'))
      .toEqual({ from: 13, to: 18 });
  });

  it('rejects provider anchors whose source text is ambiguous or absent', () => {
    expect(resolveProviderRange({ from: 0, to: 5, sourceText: 'Mara', type: 'annotation' }, 'Mara watched Mara leave.')).toBeNull();
    expect(resolveProviderRange({ from: 0, to: 5, sourceText: 'Peter', type: 'annotation' }, 'Mara watched him leave.')).toBeNull();
  });

  it('rejects exact but visually misleading mid-word provider anchors', () => {
    const passage = 'The porter stood beneath the awning.';
    expect(resolveProviderRange({ from: 1, to: 14, sourceText: 'he porter sto', type: 'annotation' }, passage)).toBeNull();
    expect(resolveProviderRange({ from: 0, to: 14, sourceText: 'The porter sto', type: 'annotation' }, passage)).toBeNull();
  });
});
