import { describe, expect, it } from 'vitest';
import { estimateProviderCost, trackedProviderSpend, type SpendEvent } from './provider-usage';

function suggestion(runId: string, source: string, model: string, inputTokens: number, outputTokens: number, costUsd = 0): SpendEvent {
  return {
    type: 'suggestion_generated',
    payload: { suggestion: { source, provenance: { runId, model, inputTokens, outputTokens, costUsd } } }
  };
}

describe('provider usage accounting', () => {
  it('uses cached and uncached model rates separately', () => {
    expect(estimateProviderCost('gpt-5.6-terra', {
      inputTokens: 1_000_000,
      cachedInputTokens: 250_000,
      outputTokens: 100_000
    })).toBeCloseTo(2.75);
  });

  it('counts one legacy provider call once when it produced several Inputs', () => {
    expect(trackedProviderSpend([
      suggestion('run-1', 'openai', 'gpt-5.6-terra', 1_000_000, 1_000_000),
      suggestion('run-1', 'openai', 'gpt-5.6-terra', 1_000_000, 1_000_000)
    ])).toBeCloseTo(14);
  });

  it('prefers a new provider usage event over a legacy token estimate', () => {
    expect(trackedProviderSpend([
      suggestion('run-1', 'openrouter', 'anthropic/claude-haiku-4.5', 1_000_000, 1_000_000),
      {
        type: 'provider_usage_recorded',
        payload: { runId: 'run-1', usage: { source: 'openrouter', costUsd: 4.25 } }
      }
    ])).toBeCloseTo(4.25);
  });
});
