import { env } from '$env/dynamic/private';
import type { Category, GenerationRequest, Suggestion, SuggestionVariant } from '$lib/domain';
import { makeId } from '$lib/domain';

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

function suggestionFromDraft(draft: DraftSuggestion, request: GenerationRequest, source: string, sourceNumber: number, sourceKind: 'local' | 'ai', latencyMs: number, costUsd = 0): Suggestion {
  const id = makeId('sg');
  const anchorText = request.text.slice(draft.from - request.from, draft.to - request.from);
  const candidates = draft.variants ?? (draft.replacement !== undefined ? [draft.replacement] : []);
  const effective = [...new Set(candidates)].filter((text) => text !== anchorText);
  const variants: SuggestionVariant[] = effective.map((text, index) => ({ id: `${id}_v${index + 1}`, text, confidence: Math.max(0.45, draft.confidence - index * 0.04) }));
  const type = draft.type === 'replacement' && !variants.length ? 'annotation' : draft.type;
  return {
    id,
    source,
    sourceNumber,
    sourceKind,
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

async function openAiShaped(baseUrl: string, apiKey: string | undefined, model: string, request: GenerationRequest): Promise<{ drafts: DraftSuggestion[]; latencyMs: number; inputTokens?: number; outputTokens?: number }> {
  const started = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({ model, temperature: 0.3, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: assemblePrompt(request) }] })
  });
  if (!response.ok) throw new Error(`Provider returned ${response.status}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? '{"suggestions":[]}') as { suggestions?: Array<Omit<DraftSuggestion, 'from' | 'to'> & { from: number; to: number }> };
  const drafts = (parsed.suggestions ?? []).map((item) => ({ ...item, from: request.from + item.from, to: request.from + item.to })).filter((item) => item.to >= item.from && item.from >= request.from && item.to <= request.from + request.text.length);
  return { drafts, latencyMs: performance.now() - started, inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens };
}

export async function generateSuggestions(request: GenerationRequest): Promise<{ suggestions: Suggestion[]; errors: { source: string; message: string }[] }> {
  const suggestions: Suggestion[] = [];
  const errors: { source: string; message: string }[] = [];
  if (request.sourceStates['local-craft'] !== 'off') {
    const started = performance.now();
    const drafts = localChecks(request);
    const latency = performance.now() - started;
    suggestions.push(...drafts.map((draft) => suggestionFromDraft(draft, request, 'local-craft', 1, 'local', latency)));
  }
  if (request.sourceStates['fake-sentinel'] !== 'off') {
    await new Promise((resolve) => setTimeout(resolve, 280));
    suggestions.push(...scriptedChecks(request).map((draft) => suggestionFromDraft(draft, request, 'fake-sentinel', 2, 'ai', 280, 0.00002)));
  }
  const providers = [
    env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL ? { id: 'openrouter', number: 3, baseUrl: 'https://openrouter.ai/api/v1', key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL } : null,
    env.OLLAMA_MODEL ? { id: 'ollama', number: 4, baseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1', key: undefined, model: env.OLLAMA_MODEL } : null
  ].filter(Boolean) as { id: string; number: number; baseUrl: string; key?: string; model: string }[];
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
  return { suggestions, errors };
}
