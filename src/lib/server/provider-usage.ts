import type { ProviderProtocol, ProviderUsage } from '$lib/domain';

interface ModelPricing {
  input: number;
  cachedInput?: number;
  cacheWrite?: number;
  output: number;
}

const modelPricing: Record<string, ModelPricing> = {
  'claude-haiku-4-5-20251001': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'claude-haiku-4.5': { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 }
};

function modelKey(model: string): string {
  return model.trim().toLowerCase().replace(/^(?:anthropic|openai)\//, '');
}

export function estimateProviderCost(model: string, usage: Pick<ProviderUsage, 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheWriteTokens'>): number | undefined {
  const pricing = modelPricing[modelKey(model)];
  if (!pricing) return undefined;
  const cached = Math.max(0, usage.cachedInputTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  const uncached = Math.max(0, usage.inputTokens - cached - cacheWrite);
  return (
    uncached * pricing.input
    + cached * (pricing.cachedInput ?? pricing.input)
    + cacheWrite * (pricing.cacheWrite ?? pricing.input)
    + Math.max(0, usage.outputTokens) * pricing.output
  ) / 1_000_000;
}

export function providerUsage(input: {
  source: string;
  model: string;
  protocol: ProviderProtocol;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reportedCostUsd?: number;
}): ProviderUsage {
  const { reportedCostUsd, ...base } = input;
  if (typeof input.reportedCostUsd === 'number' && Number.isFinite(input.reportedCostUsd)) {
    return { ...base, costUsd: Math.max(0, input.reportedCostUsd), costBasis: 'provider_reported' };
  }
  const estimated = estimateProviderCost(input.model, input);
  return {
    ...base,
    ...(estimated === undefined ? {} : { costUsd: estimated }),
    costBasis: estimated === undefined ? 'unavailable' : 'estimated'
  };
}

export interface SpendEvent {
  type: 'provider_usage_recorded' | 'suggestion_generated' | 'generated_hidden';
  payload: Record<string, unknown>;
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Provider usage events are authoritative for new work. Older suggestion events are
 * grouped by run and source so one paid call is never counted once per resulting Input.
 */
export function trackedProviderSpend(events: SpendEvent[]): number {
  let total = 0;
  const recordedRuns = new Set<string>();
  const legacy = new Map<string, { model: string; inputTokens: number; outputTokens: number }>();

  for (const event of events) {
    if (event.type !== 'provider_usage_recorded') continue;
    const usage = object(event.payload.usage);
    const runId = typeof event.payload.runId === 'string' ? event.payload.runId : '';
    const source = typeof usage.source === 'string' ? usage.source : '';
    if (runId && source) recordedRuns.add(`${runId}:${source}`);
    total += Math.max(0, finiteNumber(usage.costUsd) ?? 0);
  }

  for (const event of events) {
    if (event.type === 'provider_usage_recorded') continue;
    const suggestion = object(event.payload.suggestion);
    const provenance = object(suggestion.provenance);
    total += Math.max(0, finiteNumber(provenance.costUsd) ?? 0);
    const runId = typeof provenance.runId === 'string' ? provenance.runId : '';
    const source = typeof suggestion.source === 'string' ? suggestion.source : '';
    const model = typeof provenance.model === 'string' ? provenance.model : '';
    if (!runId || !source || !model || recordedRuns.has(`${runId}:${source}`)) continue;
    const key = `${runId}:${source}`;
    const current = legacy.get(key) ?? { model, inputTokens: 0, outputTokens: 0 };
    current.inputTokens = Math.max(current.inputTokens, finiteNumber(provenance.inputTokens) ?? 0);
    current.outputTokens = Math.max(current.outputTokens, finiteNumber(provenance.outputTokens) ?? 0);
    legacy.set(key, current);
  }

  for (const item of legacy.values()) {
    total += estimateProviderCost(item.model, item) ?? 0;
  }
  return total;
}
