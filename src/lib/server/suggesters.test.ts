import { describe, expect, it } from 'vitest';
import type { GenerationRequest, TaskPrompt } from '$lib/domain';
import { generateSuggestions } from './suggesters';

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
});
