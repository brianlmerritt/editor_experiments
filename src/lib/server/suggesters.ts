import { env } from '$env/dynamic/private';
import type { Category, GenerationRequest, SourceAvailability, Suggestion, SuggestionVariant } from '$lib/domain';
import { makeId } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
import { maskCredential, readStoredOpenRouterSettings, writeStoredOpenRouterSettings } from '$lib/server/provider-settings';

interface DraftSuggestion {
  from: number;
  to: number;
  type: Suggestion['type'];
  category: Category;
  comment: string;
  replacement?: string;
  variants?: string[];
  confidence: number;
}

interface ConfiguredProvider {
  id: 'openrouter' | 'ollama';
  number: number;
  baseUrl: string;
  key?: string;
  model: string;
  persistence?: SourceAvailability['persistence'];
}

interface RuntimeProviderSettings {
  openrouter?: { key: string; model: string; persistence?: SourceAvailability['persistence'] };
  ollama?: { model: string; baseUrl?: string };
}

const runtimeProviders = globalThis as typeof globalThis & {
  __marginNoteProviderSettings?: RuntimeProviderSettings;
};

function runtimeProviderSettings(): RuntimeProviderSettings {
  runtimeProviders.__marginNoteProviderSettings ??= {};
  return runtimeProviders.__marginNoteProviderSettings;
}

export function configureSuggestionProvider(
  input: { source: 'openrouter'; key?: string; model: string },
  options: { persist?: boolean } = {}
): void {
  const stored = readStoredOpenRouterSettings();
  const key = input.key?.trim() || stored.key || env.OPENROUTER_API_KEY;
  const model = input.model.trim();
  if (!key || !model) throw new Error('OpenRouter requires both an API key and a model.');
  const persist = options.persist !== false;
  if (persist) writeStoredOpenRouterSettings({ key, model });
  runtimeProviderSettings().openrouter = {
    key,
    model,
    persistence: persist || stored.key ? 'local_file' : 'environment'
  };
}

function configuredProviders(): ConfiguredProvider[] {
  const runtime = runtimeProviderSettings();
  const stored = readStoredOpenRouterSettings();
  const openrouterKey = runtime.openrouter?.key || stored.key || env.OPENROUTER_API_KEY;
  const openrouterModel = runtime.openrouter?.model || stored.model || env.OPENROUTER_MODEL;
  const openrouterPersistence = runtime.openrouter?.persistence || (stored.key ? 'local_file' : env.OPENROUTER_API_KEY ? 'environment' : undefined);
  const ollamaModel = runtime.ollama?.model || env.OLLAMA_MODEL;
  const ollamaBaseUrl = runtime.ollama?.baseUrl || env.OLLAMA_BASE_URL;
  const providers: ConfiguredProvider[] = [];
  if (openrouterKey && openrouterModel) {
    providers.push({
      id: 'openrouter',
      number: 3,
      baseUrl: 'https://openrouter.ai/api/v1',
      key: openrouterKey,
      model: openrouterModel,
      persistence: openrouterPersistence
    });
  }
  if (ollamaModel) {
    providers.push({ id: 'ollama', number: 4, baseUrl: ollamaBaseUrl ?? 'http://127.0.0.1:11434/v1', model: ollamaModel });
  }
  return providers;
}

export function suggestionSourceAvailability(): Record<string, SourceAvailability> {
  const providers = configuredProviders();
  const openrouter = providers.find((provider) => provider.id === 'openrouter');
  const ollama = providers.find((provider) => provider.id === 'ollama');
  return {
    'local-craft': { available: true },
    'fake-sentinel': { available: true },
    openrouter: openrouter
      ? {
          available: true,
          model: openrouter.model,
          credentialHint: maskCredential(openrouter.key ?? ''),
          persistence: openrouter.persistence
        }
      : { available: false, reason: 'Configure OpenRouter here or set OPENROUTER_API_KEY and OPENROUTER_MODEL.' },
    ollama: ollama
      ? { available: true, model: ollama.model }
      : { available: false, reason: 'Set OLLAMA_MODEL, then restart the app.' }
  };
}

function suggestionFromDraft(draft: DraftSuggestion, request: GenerationRequest, source: string, sourceNumber: number, sourceKind: 'local' | 'ai', latencyMs: number, costUsd = 0): Suggestion {
  const id = makeId('sg');
  const anchorText = request.text.slice(draft.from - request.from, draft.to - request.from);
  const candidates = draft.variants ?? (draft.replacement !== undefined ? [draft.replacement] : []);
  const effective = [...new Set(candidates)].filter((text) => text !== anchorText);
  const variants: SuggestionVariant[] = effective.map((text, index) => ({ id: `${id}_v${index + 1}`, text, confidence: Math.max(0.45, draft.confidence - index * 0.04) }));
  const type = draft.type === 'replacement' && !variants.length ? 'annotation' : draft.type;
  return {
    id,
    kind: 'craft_suggestion',
    source,
    sourceNumber,
    sourceKind,
    target: textTarget(request.branchId, draft.from, draft.to, anchorText),
    behaviourId: 'craft-input',
    events: [],
    anchor: { from: draft.from, to: draft.to, text: anchorText },
    type,
    payload: { text: variants[0]?.text, comment: draft.comment },
    category: draft.category,
    confidence: draft.confidence,
    variants,
    state: request.sourceStates[source] === 'invisible' ? 'hidden' : 'pending',
    order: draft.from,
    createdAt: new Date().toISOString(),
    provenance: {
      promptVersion: request.prompt.version,
      briefVersion: request.brief.version,
      model: source,
      latencyMs,
      costUsd
    }
  };
}

const selectionWords: Record<string, Record<string, string[]>> = {
  heighten: {
    noticed: ['saw', 'observed'],
    felt: ['sensed', 'detected'],
    looked: ['stared', 'gazed'],
    said: ['insisted', 'murmured'],
    saw: ['glimpsed', 'took in'],
    heard: ['caught', 'made out']
  },
  synonyms: {
    noticed: ['observed', 'registered'],
    felt: ['sensed', 'experienced'],
    looked: ['gazed', 'glanced'],
    said: ['replied', 'remarked'],
    saw: ['observed', 'glimpsed'],
    heard: ['caught', 'detected']
  },
  distance: {
    noticed: ['observed', 'perceived'],
    felt: ['experienced', 'was conscious of'],
    looked: ['gazed', 'glanced'],
    saw: ['observed', 'perceived'],
    heard: ['detected', 'could make out']
  }
};

function matchInitialCase(source: string, replacement: string): string {
  return /^[A-Z]/.test(source) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

function selectionVariants(text: string, promptId: string): string[] {
  if (promptId === 'cadence') {
    if (text.trim().split(/\s+/).length < 4) return [];
    const conjunctionPivot = /,\s+(and|but|yet)\s+/i;
    if (!conjunctionPivot.test(text)) return [];
    const candidates = [
      text.replace(conjunctionPivot, (_match, conjunction: string) => `. ${conjunction[0].toUpperCase()}${conjunction.slice(1)} `),
      text.replace(conjunctionPivot, (_match, conjunction: string) => ` — ${conjunction.toLowerCase()} `)
    ];
    return [...new Set(candidates)].filter((candidate) => candidate !== text);
  }

  const choices = selectionWords[promptId];
  if (!choices) return [];
  for (const [word, alternatives] of Object.entries(choices)) {
    const pattern = new RegExp(`\\b${word}\\b`, 'i');
    const match = pattern.exec(text);
    if (!match) continue;
    return alternatives.map((alternative) => text.replace(pattern, matchInitialCase(match[0], alternative)));
  }
  return [];
}

function localChecks(request: GenerationRequest): DraftSuggestion[] {
  const findings: DraftSuggestion[] = [];
  const offset = request.from;
  const filterPattern = /\b(saw|felt|noticed|realized|seemed|heard|thought)\b/gi;
  for (const match of request.text.matchAll(filterPattern)) {
    const word = match[0];
    const index = match.index ?? 0;
    findings.push({
      from: offset + index,
      to: offset + index + word.length,
      type: 'annotation',
      category: 'distance',
      comment: `“${word}” can filter the moment through perception. Check whether the image can arrive more directly.`,
      confidence: 0.82
    });
  }
  const passivePattern = /\b(?:was|were|is|are|been|be)\s+([a-z]+ed)\b/gi;
  for (const match of request.text.matchAll(passivePattern)) {
    const index = match.index ?? 0;
    findings.push({
      from: offset + index,
      to: offset + index + match[0].length,
      type: 'annotation',
      category: 'diction',
      comment: 'Possible passive construction. It may be intentional; check whether naming the actor would sharpen the sentence.',
      confidence: 0.7
    });
  }
  const words = [...request.text.matchAll(/\b[\p{L}']{4,}\b/gu)];
  const last = new Map<string, RegExpMatchArray>();
  for (const word of words) {
    const normalized = word[0].toLowerCase();
    const prior = last.get(normalized);
    if (prior && (word.index ?? 0) - (prior.index ?? 0) < 90) {
      const index = word.index ?? 0;
      findings.push({
        from: offset + index,
        to: offset + index + word[0].length,
        type: 'annotation',
        category: 'diction',
        comment: `“${word[0]}” repeats nearby. Keep it if the echo is doing useful work.`,
        confidence: 0.76
      });
      last.delete(normalized);
    } else last.set(normalized, word);
  }
  const sentences = request.text.split(/(?<=[.!?])\s+/).filter(Boolean);
  for (let index = 1, cursor = sentences[0]?.length ?? 0; index < sentences.length; index += 1) {
    const previous = sentences[index - 1].trim().split(/\s+/)[0]?.toLowerCase();
    const current = sentences[index].trim().split(/\s+/)[0]?.toLowerCase();
    cursor = request.text.indexOf(sentences[index], cursor);
    if (previous && current && previous === current) {
      findings.push({
        from: offset + cursor,
        to: offset + cursor + Math.min(sentences[index].length, current.length),
        type: 'annotation',
        category: 'cadence',
        comment: `Consecutive sentences open with “${current}”. Consider varying the entry rhythm.`,
        confidence: 0.74
      });
    }
    cursor += sentences[index].length;
  }
  return findings.slice(0, 12);
}

function scriptedChecks(request: GenerationRequest): DraftSuggestion[] {
  const findings: DraftSuggestion[] = [];
  if (!request.text.trim()) return findings;
  const offset = request.from;
  const firstSentence = request.text.match(/[^.!?]+[.!?]?/)?.[0] ?? request.text;
  const trimmed = firstSentence.trim();
  const leading = firstSentence.indexOf(trimmed);

  if (request.prompt.id !== 'sentinel') {
    const variants = selectionVariants(trimmed, request.prompt.id);
    const category = request.prompt.id === 'cadence' ? 'cadence' : request.prompt.id === 'distance' ? 'distance' : 'diction';
    const noAlternative = request.prompt.id === 'cadence' && trimmed.split(/\s+/).length < 4
      ? 'Cadence needs a phrase or sentence. Select at least four words.'
      : `${request.prompt.name} found no safe replay alternative. Widen the selection or enable an AI source.`;
    findings.push({
      from: offset + leading,
      to: offset + leading + trimmed.length,
      type: variants.length ? 'replacement' : 'annotation',
      category,
      comment: variants.length ? `${request.prompt.name} pass: two distinct alternatives, preserving the passage's facts.` : noAlternative,
      replacement: variants[0],
      variants,
      confidence: 0.72
    });
    return findings;
  }

  const adverb = /\b\w+ly\b/i.exec(request.text);
  if (adverb?.index != null) {
    findings.push({
      from: offset + adverb.index,
      to: offset + adverb.index + adverb[0].length,
      type: 'replacement',
      category: 'diction',
      comment: 'The adverb may be carrying work the verb could do. Preview a leaner version.',
      replacement: '',
      variants: ['', adverb[0]],
      confidence: 0.63
    });
  }
  if (/\b(I|we)\b/.test(request.text) && /third/i.test(request.brief.pov)) {
    const match = /\b(I|we)\b/.exec(request.text)!;
    findings.push({
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      type: 'annotation',
      category: 'pov',
      comment: `The brief declares ${request.brief.pov}; this pronoun may signal a viewpoint slip.`,
      confidence: 0.88
    });
  }
  return findings;
}

function assemblePrompt(request: GenerationRequest): string {
  const canon = request.brief.canon.slice(0, 6000);
  const context = (request.context ?? [])
    .map((bucket) => `### ${bucket.title} (${bucket.scope}, v${bucket.revision}${bucket.role ? `, ${bucket.role}` : ''})\n${bucket.content}`)
    .join('\n\n');
  return `You are a precise writing suggester. Return JSON only: {"suggestions":[{"from":0,"to":4,"type":"annotation|replacement|insertion","category":"pov|tense|canon|cadence|diction|distance","comment":"...","replacement":"...","variants":["..."],"confidence":0.8}]}. Offsets are zero-based within PASSAGE. For a replacement, provide two or three distinct alternatives in variants; none may equal the selected source text. If there is no useful change, return an annotation or no suggestion instead of a no-op replacement.\n\nBRIEF\nForm: ${request.brief.form}\nPOV: ${request.brief.pov}\nTense: ${request.brief.tense}\nDistance: ${request.brief.distance}\nCanon: ${canon}\n\nCONTEXT BUCKETS\n${context || 'None'}\n\nTASK\n${request.prompt.instruction}\n\nPASSAGE\n${request.text}`;
}

function balancedJsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  for (let start = 0; start < content.length; start += 1) {
    if (content[start] !== '{' && content[start] !== '[') continue;
    const stack: string[] = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < content.length; index += 1) {
      const character = content[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{' || character === '[') stack.push(character);
      else if (character === '}' || character === ']') {
        const expected = character === '}' ? '{' : '[';
        if (stack.pop() !== expected) break;
        if (!stack.length) {
          candidates.push(content.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
}

function parseProviderJson(content: string): unknown {
  const trimmed = content.trim().replace(/^\uFEFF/, '');
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  const candidates = [...new Set([trimmed, ...fenced, ...balancedJsonCandidates(trimmed)])];
  for (const candidate of candidates) {
    for (const value of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        // Try the next locally recoverable representation.
      }
    }
  }
  throw new Error('Provider returned invalid JSON after fenced-block and surrounding-text recovery.');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProviderSuggestions(content: string): Array<Omit<DraftSuggestion, 'from' | 'to'> & { from: number; to: number }> {
  const parsed = parseProviderJson(content);
  const rawSuggestions = Array.isArray(parsed) ? parsed : record(parsed) && Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const valid = rawSuggestions.flatMap((value) => {
    if (!record(value)) return [];
    const from = value.from;
    const to = value.to;
    const type = value.type;
    const category = value.category;
    if (!Number.isInteger(from) || !Number.isInteger(to)) return [];
    if (type !== 'annotation' && type !== 'replacement' && type !== 'insertion') return [];
    if (category !== 'pov' && category !== 'tense' && category !== 'canon' && category !== 'cadence' && category !== 'diction' && category !== 'distance') return [];
    const variants = Array.isArray(value.variants)
      ? [...new Set(value.variants.filter((variant): variant is string => typeof variant === 'string'))]
      : undefined;
    const replacement = typeof value.replacement === 'string' ? value.replacement : variants?.[0];
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : 0.7;
    return [{
      from: from as number,
      to: to as number,
      type: type as Suggestion['type'],
      category: category as Category,
      comment: typeof value.comment === 'string' ? value.comment : 'AI craft suggestion.',
      replacement,
      variants,
      confidence
    }];
  });
  if (rawSuggestions.length && !valid.length) throw new Error('Provider JSON contained suggestions, but none matched the required suggestion schema.');
  return valid;
}

async function openAiShaped(baseUrl: string, apiKey: string | undefined, model: string, request: GenerationRequest): Promise<{ drafts: DraftSuggestion[]; latencyMs: number; inputTokens?: number; outputTokens?: number }> {
  const started = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: assemblePrompt(request) }] })
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const parsed = parseProviderSuggestions(data.choices?.[0]?.message?.content ?? '{"suggestions":[]}');
  const drafts = parsed.map((item) => ({ ...item, from: request.from + item.from, to: request.from + item.to })).filter((item) => item.to >= item.from && item.from >= request.from && item.to <= request.from + request.text.length);
  return { drafts, latencyMs: performance.now() - started, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens };
}

export async function generateSuggestions(request: GenerationRequest): Promise<{ suggestions: Suggestion[]; errors: { source: string; message: string }[] }> {
  const suggestions: Suggestion[] = [];
  const errors: { source: string; message: string }[] = [];
  const providers = configuredProviders();
  const activeProviders = providers.filter((provider) => request.sourceStates[provider.id] !== 'off');
  const selectionRequest = request.prompt.id !== 'sentinel';
  if (request.sourceStates['local-craft'] !== 'off') {
    const started = performance.now();
    const drafts = localChecks(request);
    const latency = performance.now() - started;
    suggestions.push(...drafts.map((draft) => suggestionFromDraft(draft, request, 'local-craft', 1, 'local', latency)));
  }
  // Selection replay is a deterministic fallback. When a real provider is active,
  // do not obscure its result with a scripted "no safe alternative" annotation.
  if (request.sourceStates['fake-sentinel'] !== 'off' && !(selectionRequest && activeProviders.length)) {
    await new Promise((resolve) => setTimeout(resolve, 280));
    suggestions.push(...scriptedChecks(request).map((draft) => suggestionFromDraft(draft, request, 'fake-sentinel', 2, 'ai', 280, 0.00002)));
  }
  for (const provider of providers) {
    if (request.sourceStates[provider.id] === 'off') continue;
    try {
      const result = await openAiShaped(provider.baseUrl, provider.key, provider.model, request);
      suggestions.push(...result.drafts.map((draft) => {
        const suggestion = suggestionFromDraft(draft, request, provider.id, provider.number, 'ai', result.latencyMs);
        suggestion.provenance.inputTokens = result.inputTokens;
        suggestion.provenance.outputTokens = result.outputTokens;
        suggestion.provenance.model = provider.model;
        return suggestion;
      }));
    } catch (error) {
      errors.push({ source: provider.id, message: error instanceof Error ? error.message : 'Provider failed' });
    }
  }
  const availability = suggestionSourceAvailability();
  for (const source of ['openrouter', 'ollama'] as const) {
    if (request.sourceStates[source] !== 'off' && !availability[source].available) {
      errors.push({ source, message: availability[source].reason ?? 'Source is not configured.' });
    }
  }
  return { suggestions, errors };
}
