import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationRequest, TaskPrompt } from '$lib/domain';
import { configureSuggestionProvider, generateSuggestions, parseProviderSuggestions } from './suggesters';

afterEach(() => vi.unstubAllGlobals());

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
  it('returns distinct word alternatives instead of the selected source text', async () => {
    const result = await generateSuggestions(request('noticed', {
      id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten it.'
    }));

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].variants.map((variant) => variant.text)).toEqual(['saw', 'observed']);
    expect(result.suggestions[0].variants.every((variant) => variant.text !== 'noticed')).toBe(true);
  });

  it('does not pretend cadence can be changed in a one-word selection', async () => {
    const result = await generateSuggestions(request('noticed', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    }));

    expect(result.suggestions[0]).toMatchObject({ type: 'annotation', category: 'cadence', variants: [] });
    expect(result.suggestions[0].payload.comment).toContain('Select at least four words');
  });

  it('offers grammatical cadence alternatives around a conjunction pivot', async () => {
    const result = await generateSuggestions(request('Mara noticed the clock, and she stopped.', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    }));

    expect(result.suggestions[0].variants.map((variant) => variant.text)).toEqual([
      'Mara noticed the clock. And she stopped.',
      'Mara noticed the clock — and she stopped.'
    ]);
  });

  it('does not fabricate a cadence rewrite when the local replay has no safe pivot', async () => {
    const result = await generateSuggestions(request('Mara crossed the empty platform alone.', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    }));

    expect(result.suggestions[0]).toMatchObject({ type: 'annotation', variants: [] });
    expect(result.suggestions[0].payload.comment).toContain('no safe replay alternative');
  });

  it('removes no-op variants from replacement suggestions', async () => {
    const result = await generateSuggestions(request('quietly', {
      id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Review it.'
    }));

    expect(result.suggestions[0].variants.map((variant) => variant.text)).toEqual(['']);
  });

  it('uses a configured provider instead of showing the scripted cadence fallback', async () => {
    configureSuggestionProvider({ source: 'openrouter', key: 'test-key', model: 'provider/model' }, { persist: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        suggestions: [{
          from: 0,
          to: 38,
          type: 'replacement',
          category: 'cadence',
          comment: 'Vary the sentence movement.',
          variants: ['Alone, Mara crossed the empty platform.', 'Mara crossed the platform. Empty. Alone.'],
          confidence: 0.84
        }]
      }) } }],
      usage: { prompt_tokens: 20, completion_tokens: 30 }
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const providerRequest = request('Mara crossed the empty platform alone.', {
      id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Vary it.'
    });
    providerRequest.sourceStates.openrouter = 'visible';

    const result = await generateSuggestions(providerRequest);

    expect(result.errors).toEqual([]);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].source).toBe('openrouter');
    expect(result.suggestions[0].variants).toHaveLength(2);
    expect(result.suggestions[0].payload.comment).not.toContain('no safe replay alternative');
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

  it('rejects a response whose suggestions do not match the required schema', () => {
    expect(() => parseProviderSuggestions('{"suggestions":[{"from":"zero","to":4}]}'))
      .toThrow('none matched the required suggestion schema');
  });
});
