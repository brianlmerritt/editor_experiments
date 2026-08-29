import { describe, expect, it } from 'vitest';
import { estimateProviderCost, providerUsage, trackedCodexTokens, trackedProviderSpend, type SpendEvent } from './provider-usage';

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

  it('does not apply API dollar pricing to ChatGPT-plan Codex usage', () => {
    expect(providerUsage({
      source: 'codex-chatgpt', model: 'gpt-5.6-terra', protocol: 'codex_app_server',
      attempts: 1, inputTokens: 1_000_000, outputTokens: 1_000_000
    })).toEqual(expect.objectContaining({ costBasis: 'unavailable' }));
    expect(providerUsage({
      source: 'codex-chatgpt', model: 'gpt-5.6-terra', protocol: 'codex_app_server',
      attempts: 1, inputTokens: 1_000_000, outputTokens: 1_000_000
    }).costUsd).toBeUndefined();
  });

  it('tracks Codex input and output tokens without treating cached input as extra usage', () => {
    expect(trackedCodexTokens([
      {
        type: 'provider_usage_recorded',
        payload: { usage: { protocol: 'codex_app_server', inputTokens: 15_409, outputTokens: 31, cachedInputTokens: 2_000 } }
      },
      {
        type: 'provider_usage_recorded',
        payload: { usage: { protocol: 'anthropic', inputTokens: 100_000, outputTokens: 10_000 } }
      }
    ])).toBe(15_440);
  });
});
