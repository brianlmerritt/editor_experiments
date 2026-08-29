import { env } from '$env/dynamic/private';
import type { Category, GenerationRequest, InputAnchorStatus, InputError, InputProposal, ProviderProfileInput, ProviderProtocol, ProviderUsage, RecoveryClassification, SourceAvailability, Suggestion } from '$lib/domain';
import { isExactTextSpan, makeId } from '$lib/domain';
import { providerUsage } from '$lib/server/provider-usage';
import { codexAppServer, CodexAppServerError } from '$lib/server/codex-app-server';
import { deleteStoredProviderProfile, maskCredential, readStoredProviderProfiles, upsertStoredProviderProfile, type StoredProviderProfile } from '$lib/server/provider-settings';
import { jsonrepair } from 'jsonrepair';

interface DraftSuggestion {
  from: number;
  to: number;
  type: Suggestion['type'];
  category: Category;
  comment: string;
  replacement?: string;
  variants?: string[];
  sourceText?: string;
  confidence: number;
  anchorStatus?: InputAnchorStatus;
}

interface ConfiguredProvider {
  id: string;
  name: string;
  number: number;
  protocol: ProviderProtocol;
  baseUrl: string;
  key?: string;
  model: string;
  persistence?: SourceAvailability['persistence'];
}

interface RuntimeProviderSettings {
  profiles: Record<string, ConfiguredProvider>;
}

const maxRetainedProviderOutputCharacters = 250_000;

function retainedProviderOutput(value: string): string {
  return value.slice(0, maxRetainedProviderOutputCharacters);
}

interface LegacyRuntimeProviderSettings {
  openrouter?: { key: string; model: string; persistence?: SourceAvailability['persistence'] };
  ollama?: { model: string; baseUrl?: string };
}

export class ProviderOutputError extends Error {
  override readonly name = 'ProviderOutputError';

  constructor(message: string, readonly diagnostics: Array<Omit<InputError, 'source'>> = [], readonly usage?: ProviderUsage) {
    super(message);
  }
}

export class ProviderRequestError extends Error {
  override readonly name = 'ProviderRequestError';

  constructor(message: string, readonly diagnostics: Array<Omit<InputError, 'source'>> = [], readonly usage?: ProviderUsage) {
    super(message);
  }
}

const runtimeProviders = globalThis as typeof globalThis & {
  __marginNoteProviderSettings?: RuntimeProviderSettings | LegacyRuntimeProviderSettings;
};

function runtimeProviderSettings(): RuntimeProviderSettings {
  const current = runtimeProviders.__marginNoteProviderSettings;
  if (current && 'profiles' in current && current.profiles && typeof current.profiles === 'object') return current;

  const legacy = current as LegacyRuntimeProviderSettings | undefined;
  const profiles: Record<string, ConfiguredProvider> = {};
  if (legacy?.openrouter?.model) profiles.openrouter = {
    id: 'openrouter',
    name: 'OpenRouter',
    number: 3,
    protocol: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    key: legacy.openrouter.key,
    model: legacy.openrouter.model,
    persistence: legacy.openrouter.persistence
  };
  if (legacy?.ollama?.model) profiles.ollama = {
    id: 'ollama',
    name: 'Ollama',
    number: 4,
    protocol: 'openai_compatible',
    baseUrl: legacy.ollama.baseUrl ?? 'http://127.0.0.1:11434/v1',
    model: legacy.ollama.model
  };
  const migrated = { profiles };
  runtimeProviders.__marginNoteProviderSettings = migrated;
  return migrated;
}

export function configureSuggestionProvider(
  input: { source: 'openrouter'; key?: string; model: string },
  options: { persist?: boolean } = {}
): void {
  configureProviderProfile({
    id: 'openrouter', name: 'OpenRouter', protocol: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1', key: input.key, model: input.model
  }, options);
}

function environmentKey(id: string): string | undefined {
  if (id === 'openrouter') return env.OPENROUTER_API_KEY;
  if (id === 'openai') return env.OPENAI_API_KEY;
  if (id === 'anthropic') return env.ANTHROPIC_API_KEY;
  return undefined;
}

export function configureProviderProfile(input: ProviderProfileInput, options: { persist?: boolean } = {}): ConfiguredProvider {
  const stored = readStoredProviderProfiles().find((profile) => profile.id === input.id);
  const id = input.id?.trim() || makeId('provider');
  const key = input.key?.trim() || stored?.key || environmentKey(id);
  const profileInput = { ...input, id, key };
  const appServer = input.protocol === 'codex_app_server';
  const local = appServer || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/.test(input.baseUrl.trim());
  if (!input.name.trim() || !input.model.trim() || !input.baseUrl.trim()) throw new Error('Provider name, base URL, and model are required.');
  if (!key && !local) throw new Error('A remote provider requires an API key.');
  const persist = options.persist !== false;
  const saved = persist ? upsertStoredProviderProfile(profileInput) : {
    id,
    name: input.name.trim(),
    protocol: input.protocol,
    baseUrl: input.baseUrl.trim().replace(/\/$/, ''),
    model: input.model.trim(),
    key
  } satisfies StoredProviderProfile;
  const provider: ConfiguredProvider = {
    ...saved,
    number: 3,
    persistence: persist || stored?.key ? 'local_file' : key ? 'environment' : undefined
  };
  runtimeProviderSettings().profiles[id] = provider;
  return provider;
}

export function removeProviderProfile(id: string): void {
  delete runtimeProviderSettings().profiles[id];
  deleteStoredProviderProfile(id);
}

function environmentProfiles(): StoredProviderProfile[] {
  const profiles: StoredProviderProfile[] = [];
  if (env.OPENROUTER_API_KEY && env.OPENROUTER_MODEL) profiles.push({
      id: 'openrouter', name: 'OpenRouter', protocol: 'openai_compatible' as const,
      baseUrl: 'https://openrouter.ai/api/v1', key: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL
    });
  if (env.OPENAI_API_KEY && env.OPENAI_MODEL) profiles.push({
      id: 'openai', name: 'OpenAI', protocol: 'openai_compatible' as const,
      baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL
    });
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_MODEL) profiles.push({
      id: 'anthropic', name: 'Anthropic', protocol: 'anthropic' as const,
      baseUrl: env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1', key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL
    });
  if (env.OLLAMA_MODEL) profiles.push({
      id: 'ollama', name: 'Ollama', protocol: 'openai_compatible' as const,
      baseUrl: env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1', model: env.OLLAMA_MODEL
    });
  return profiles;
}

function configuredProviders(): ConfiguredProvider[] {
  const stored = readStoredProviderProfiles();
  const environment = environmentProfiles();
  const runtime = Object.values(runtimeProviderSettings().profiles);
  const profiles = new Map<string, StoredProviderProfile & { persistence?: SourceAvailability['persistence'] }>();
  for (const profile of environment) profiles.set(profile.id, { ...profile, persistence: 'environment' });
  for (const profile of stored) profiles.set(profile.id, { ...profile, persistence: 'local_file' });
  for (const profile of runtime) profiles.set(profile.id, profile);
  return [...profiles.values()].map((profile, index) => ({ ...profile, number: index + 3 }));
}

export function suggestionSourceAvailability(): Record<string, SourceAvailability> {
  const providers = configuredProviders();
  const availability: Record<string, SourceAvailability> = {
    'local-craft': { available: true },
    'fake-sentinel': { available: true }
  };
  for (const provider of providers) availability[provider.id] = {
    available: true,
    name: provider.name,
    model: provider.model,
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    sourceNumber: provider.number,
    configurable: provider.persistence === 'local_file',
    credentialHint: provider.protocol === 'codex_app_server' ? 'ChatGPT session' : provider.key ? maskCredential(provider.key) : undefined,
    persistence: provider.protocol === 'codex_app_server' ? 'chatgpt_session' : provider.persistence
  };
  return availability;
}

function proposalFromDraft(draft: DraftSuggestion, request: GenerationRequest, source: string, sourceNumber: number, sourceKind: 'local' | 'ai', latencyMs: number, costUsd = 0): InputProposal {
  const proposalId = makeId('proposal');
  const anchorText = request.text.slice(draft.from - request.from, draft.to - request.from);
  const candidates = draft.variants ?? (draft.replacement !== undefined ? [draft.replacement] : []);
  const effective = [...new Set(candidates)].filter((text) => text !== anchorText);
  const variants = effective;
  const type = draft.type === 'replacement' && !variants.length ? 'annotation' : draft.type;
  return {
    proposalId,
    source,
    sourceNumber,
    sourceKind,
    from: draft.from - request.from,
    to: draft.to - request.from,
    sourceText: anchorText,
    anchorStatus: draft.anchorStatus ?? 'exact',
    type,
    category: draft.category,
    comment: draft.comment,
    confidence: draft.confidence,
    variants,
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
  const contract = request.responseContract;
  const protocol = contract === 'commentary'
    ? 'Return a focused editorial response as readable Markdown. Do not return JSON and do not rewrite the passage unless the instructions explicitly request discussion of possible wording.'
    : contract === 'alternative_draft'
      ? 'Return only one complete alternative version of PASSAGE as plain text. Do not add a preface, explanation, Markdown fence, or JSON. Preserve all applicable facts and constraints.'
      : contract === 'revision_options'
        ? `Return JSON only: {"options":[{"text":"complete replacement for PASSAGE","rationale":"brief meaningful trade-off"}]}. Return ${Math.max(1, Math.min(5, request.optionCount ?? 3))} distinct complete alternatives. Each text must replace the entire PASSAGE and must not equal it.`
        : contract === 'annotated_findings'
          ? `Return JSON only: {"findings":[{"from":0,"to":4,"source_text":"exact text copied from PASSAGE","comment":"specific editorial finding","correction":"optional replacement","confidence":0.8}]}. Offsets are zero-based within PASSAGE and source_text must exactly equal PASSAGE.slice(from,to). Anchor the smallest complete word, phrase, sentence, or paragraph directly discussed. Never begin or end inside a word or include surrounding whitespace. Return no finding rather than inventing one.`
          : 'Return JSON only: {"suggestions":[{"from":0,"to":4,"source_text":"exact text copied from PASSAGE","type":"annotation|replacement|insertion","category":"pov|tense|canon|cadence|diction|distance","comment":"...","replacement":"...","variants":["..."],"confidence":0.8}]}. Offsets are zero-based within PASSAGE and source_text must exactly equal PASSAGE.slice(from,to). Anchor the smallest complete word, phrase, or sentence that the comment directly discusses. Never begin or end source_text inside a word and never include leading or trailing whitespace. For a passage-wide annotation, use from 0, to the full passage length, and copy the full passage into source_text. Return at most one annotation for the same substantive issue at the same location. For a replacement, provide two or three distinct alternatives in variants; none may equal source_text. If there is no useful change, return no suggestion instead of guessing an anchor.';
  return `You are a precise writing collaborator. ${protocol}\n\nWRITING CONTEXT\n${context || canon || 'No additional context supplied.'}\n\nACTION INSTRUCTIONS\n${request.prompt.instruction}\n\nPASSAGE\n${request.text}`;
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

type ProviderJsonNormalization = 'none' | 'extracted' | 'repaired';

function parseProviderJson(content: string): { value: unknown; normalization: ProviderJsonNormalization } {
  const trimmed = content.trim().replace(/^\uFEFF/, '');
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  const unclosedFence = /```(?:json)?\s*([\s\S]*)$/i.exec(trimmed)?.[1].trim();
  const jsonStart = [trimmed.indexOf('{'), trimmed.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const trailingJson = jsonStart == null ? undefined : trimmed.slice(jsonStart);
  const candidates = [...new Set([
    ...fenced,
    unclosedFence,
    ...balancedJsonCandidates(trimmed),
    trailingJson,
    trimmed
  ].filter((candidate): candidate is string => Boolean(candidate)))];
  for (const candidate of candidates) {
    const withoutTrailingCommas = candidate.replace(/,\s*([}\]])/g, '$1');
    const representations: Array<{ value: string; normalization: ProviderJsonNormalization }> = [
      { value: candidate, normalization: candidate === trimmed ? 'none' : 'extracted' },
      { value: withoutTrailingCommas, normalization: withoutTrailingCommas !== candidate ? 'repaired' : candidate === trimmed ? 'none' : 'extracted' }
    ];
    try {
      const repaired = jsonrepair(candidate);
      representations.push({
        value: repaired,
        normalization: repaired !== candidate ? 'repaired' : candidate === trimmed ? 'none' : 'extracted'
      });
    } catch {
      // The output is not locally repairable; other extracted candidates may be.
    }
    for (const representation of representations) {
      try {
        const parsed = JSON.parse(representation.value) as unknown;
        if (typeof parsed === 'object' && parsed !== null) return { value: parsed, normalization: representation.normalization };
      } catch {
        // Try the next locally recoverable representation.
      }
    }
  }
  throw new ProviderOutputError('Provider returned invalid JSON after local repair and validation.');
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProviderSuggestionsDetailed(content: string): {
  suggestions: Array<Omit<DraftSuggestion, 'from' | 'to'> & { from: number; to: number }>;
  normalization: ProviderJsonNormalization;
} {
  const parsedResult = parseProviderJson(content);
  const parsed = parsedResult.value;
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
      sourceText: typeof value.source_text === 'string' ? value.source_text : undefined,
      confidence
    }];
  });
  if (rawSuggestions.length && !valid.length) throw new ProviderOutputError('Provider JSON contained suggestions, but none matched the required suggestion schema.');
  return { suggestions: valid, normalization: parsedResult.normalization };
}

function unfencedText(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:markdown|md|text)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseActionOutputDetailed(content: string, request: GenerationRequest): {
  suggestions: Array<Omit<DraftSuggestion, 'from' | 'to'> & { from: number; to: number }>;
  normalization: ProviderJsonNormalization;
} {
  if (!request.responseContract) return parseProviderSuggestionsDetailed(content);
  const category = request.inputCategory ?? 'canon';
  if (request.responseContract === 'commentary') {
    const comment = unfencedText(content);
    if (!comment) throw new ProviderOutputError('Provider returned empty commentary.');
    return {
      suggestions: [{ from: 0, to: request.text.length, sourceText: request.text, type: 'annotation', category, comment, confidence: 0.75 }],
      normalization: 'none'
    };
  }
  if (request.responseContract === 'alternative_draft') {
    const replacement = unfencedText(content);
    if (!replacement || replacement === request.text.trim()) throw new ProviderOutputError('Provider did not return a material alternative draft.');
    return {
      suggestions: [{
        from: 0, to: request.text.length, sourceText: request.text, type: 'replacement', category,
        comment: 'Complete alternative draft for comparison.', replacement, variants: [replacement], confidence: 0.75
      }],
      normalization: replacement === content.trim() ? 'none' : 'extracted'
    };
  }

  const parsedResult = parseProviderJson(content);
  const parsed = parsedResult.value;
  if (!record(parsed)) throw new ProviderOutputError('Provider output must be one JSON object.');
  if (request.responseContract === 'revision_options') {
    const rawOptions = Array.isArray(parsed.options) ? parsed.options : [];
    const options = rawOptions.flatMap((value) => {
      if (typeof value === 'string') return value.trim() ? [{ text: value.trim(), rationale: '' }] : [];
      if (!record(value) || typeof value.text !== 'string' || !value.text.trim()) return [];
      return [{ text: value.text.trim(), rationale: typeof value.rationale === 'string' ? value.rationale.trim() : '' }];
    }).filter((option) => option.text !== request.text.trim()).slice(0, Math.max(1, Math.min(5, request.optionCount ?? 3)));
    if (!options.length) throw new ProviderOutputError('Provider JSON contained no usable revision options.');
    return {
      suggestions: [{
        from: 0, to: request.text.length, sourceText: request.text, type: 'replacement', category,
        comment: request.includeExplanation === false
          ? 'Complete revision options.'
          : options.map((option, index) => `${index + 1}. ${option.rationale || 'Alternative treatment.'}`).join('\n'),
        replacement: options[0].text,
        variants: options.map((option) => option.text),
        confidence: 0.75
      }],
      normalization: parsedResult.normalization
    };
  }

  const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = rawFindings.flatMap((value) => {
    if (!record(value) || !Number.isInteger(value.from) || !Number.isInteger(value.to)
      || typeof value.source_text !== 'string' || typeof value.comment !== 'string' || !value.comment.trim()) return [];
    const correction = typeof value.correction === 'string' ? value.correction : undefined;
    const confidence = typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.max(0, Math.min(1, value.confidence))
      : 0.7;
    return [{
      from: Number(value.from), to: Number(value.to), sourceText: value.source_text,
      type: correction !== undefined ? 'replacement' as const : 'annotation' as const,
      category, comment: value.comment.trim(), replacement: correction,
      variants: correction !== undefined ? [correction] : undefined, confidence
    }];
  });
  if (rawFindings.length && !findings.length) throw new ProviderOutputError('Provider JSON contained findings, but none matched the required finding schema.');
  return { suggestions: findings, normalization: parsedResult.normalization };
}

export function parseProviderActionOutput(content: string, request: GenerationRequest) {
  return parseActionOutputDetailed(content, request).suggestions;
}

export function parseProviderSuggestions(content: string): Array<Omit<DraftSuggestion, 'from' | 'to'> & { from: number; to: number }> {
  return parseProviderSuggestionsDetailed(content).suggestions;
}

export function resolveProviderRange(
  draft: Pick<DraftSuggestion, 'from' | 'to' | 'sourceText' | 'type'>,
  passage: string
): { from: number; to: number } | null {
  if (draft.type === 'insertion' && draft.from === draft.to && draft.sourceText === '') {
    return draft.from >= 0 && draft.from <= passage.length ? { from: draft.from, to: draft.to } : null;
  }
  if (!draft.sourceText) return null;
  if (isExactTextSpan(passage, draft.from, draft.to, draft.sourceText)) {
    return { from: draft.from, to: draft.to };
  }
  const matches: number[] = [];
  let cursor = passage.indexOf(draft.sourceText);
  while (cursor >= 0) {
    matches.push(cursor);
    cursor = passage.indexOf(draft.sourceText, cursor + 1);
  }
  if (matches.length !== 1) return null;
  const from = matches[0];
  const to = from + draft.sourceText.length;
  return isExactTextSpan(passage, from, to, draft.sourceText) ? { from, to } : null;
}

function attachProviderTargets(
  parsed: Array<Omit<DraftSuggestion, 'from' | 'to'> & { from: number; to: number }>,
  request: GenerationRequest
): DraftSuggestion[] {
  const requestOwnsTarget = request.responseContract === 'commentary'
    || request.responseContract === 'revision_options'
    || request.responseContract === 'alternative_draft';
  return parsed.map((item) => {
    if (requestOwnsTarget) {
      const unsafeDocumentReplacement = request.targetScope === 'document' && item.type !== 'annotation';
      return {
        ...item,
        from: request.from + item.from,
        to: request.from + item.to,
        anchorStatus: unsafeDocumentReplacement ? 'unanchored' : 'request_scope'
      };
    }
    const range = resolveProviderRange(item, request.text);
    return range
      ? { ...item, from: request.from + range.from, to: request.from + range.to, anchorStatus: 'exact' }
      : {
          ...item,
          from: request.from,
          to: request.to,
          sourceText: request.text,
          anchorStatus: 'unanchored'
        };
  });
}

function statusRecovery(status: number): { classification: RecoveryClassification; recoveryAction: InputError['recoveryAction']; retryable: boolean } {
  if (status === 401 || status === 403) return { classification: 'authentication', recoveryAction: 'reconfigure', retryable: false };
  if (status === 429) return { classification: 'rate_limited', recoveryAction: 'retry_transient', retryable: true };
  if ([408, 409, 425, 500, 502, 503, 504].includes(status)) return { classification: 'transient', recoveryAction: 'retry_transient', retryable: true };
  if (status === 400 || status === 404 || status === 422) return { classification: 'configuration', recoveryAction: 'reconfigure', retryable: false };
  return { classification: 'provider_unavailable', recoveryAction: 'human', retryable: false };
}

async function providerCompletion(
  provider: ConfiguredProvider,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  temperature?: number,
  outputSchema?: Record<string, unknown>
): Promise<{ content: string; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheWriteTokens?: number; costUsd?: number; truncated: boolean }> {
  if (provider.protocol === 'codex_app_server') {
    try {
      const completion = await codexAppServer().complete({ model: provider.model, messages, maxOutputTokens: maxTokens, outputSchema });
      return { ...completion, truncated: false };
    } catch (error) {
      const classification = error instanceof CodexAppServerError ? error.classification : 'provider_unavailable';
      const recoveryAction = classification === 'authentication' || classification === 'configuration' ? 'reconfigure'
        : classification === 'rate_limited' || classification === 'transient' ? 'retry_transient'
          : 'human';
      const message = error instanceof Error ? error.message : 'Codex app-server request failed.';
      throw new ProviderRequestError(message, [{
        kind: 'provider_request', classification, recoveryAction, recovered: false, message
      }]);
    }
  }
  const endpoint = provider.protocol === 'anthropic' ? '/messages' : '/chat/completions';
  const headers = provider.protocol === 'anthropic'
    ? { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...(provider.key ? { 'x-api-key': provider.key } : {}) }
    : { 'content-type': 'application/json', ...(provider.key ? { authorization: `Bearer ${provider.key}` } : {}) };
  const directOpenAI = provider.protocol === 'openai_compatible' && /^https:\/\/api\.openai\.com(?:\/|$)/.test(provider.baseUrl);
  const sampling = temperature === undefined ? {} : { temperature };
  const body = provider.protocol === 'anthropic'
    ? { model: provider.model, max_tokens: maxTokens, ...sampling, messages }
    : directOpenAI
      ? { model: provider.model, max_completion_tokens: maxTokens, messages }
      : { model: provider.model, max_tokens: maxTokens, ...sampling, messages };
  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl.replace(/\/$/, '')}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider network request failed';
    throw new ProviderRequestError(message, [{
      kind: 'provider_request',
      classification: 'transient',
      recoveryAction: 'retry_transient',
      recovered: false,
      message
    }]);
  }
  const rawResponse = await response.text();
  if (!response.ok) {
    const detail = rawResponse.slice(0, 2000);
    const recovery = statusRecovery(response.status);
    throw new ProviderRequestError(`Provider returned ${response.status}${detail ? `: ${detail}` : ''}`, [{
      kind: 'provider_request',
      status: response.status,
      classification: recovery.classification,
      recoveryAction: recovery.recoveryAction,
      recovered: false,
      message: `Provider returned ${response.status}${detail ? `: ${detail}` : ''}`
    }]);
  }
  let data: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawResponse) as unknown;
    if (!record(parsed)) throw new Error('Provider response envelope was not an object.');
    data = parsed;
  } catch (error) {
    const message = `Provider returned an invalid response envelope: ${error instanceof Error ? error.message : String(error)}`;
    throw new ProviderRequestError(message, [{
      kind: 'provider_request',
      classification: 'transient',
      recoveryAction: 'retry_transient',
      recovered: false,
      message,
      rawOutput: retainedProviderOutput(rawResponse)
    }]);
  }
  if (provider.protocol === 'anthropic') {
    const content = Array.isArray(data.content)
      ? data.content.flatMap((item) => record(item) && item.type === 'text' && typeof item.text === 'string' ? [item.text] : []).join('\n')
      : '';
    const usage = record(data.usage) ? data.usage : {};
    const uncachedInputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const cachedInputTokens = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    const cacheWriteTokens = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    return {
      content,
      inputTokens: uncachedInputTokens + cachedInputTokens + cacheWriteTokens || undefined,
      outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
      cachedInputTokens: cachedInputTokens || undefined,
      cacheWriteTokens: cacheWriteTokens || undefined,
      truncated: data.stop_reason === 'max_tokens'
    };
  }
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = record(choices[0]) ? choices[0] : {};
  const message = record(first.message) ? first.message : {};
  const usage = record(data.usage) ? data.usage : {};
  const promptDetails = record(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  return {
    content: typeof message.content === 'string' ? message.content : '',
    inputTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    outputTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    cachedInputTokens: typeof promptDetails.cached_tokens === 'number' ? promptDetails.cached_tokens : undefined,
    cacheWriteTokens: typeof promptDetails.cache_write_tokens === 'number' ? promptDetails.cache_write_tokens : undefined,
    costUsd: typeof usage.cost === 'number' ? usage.cost : undefined,
    truncated: first.finish_reason === 'length'
  };
}

function structuredOutputSchema(request: GenerationRequest): Record<string, unknown> | undefined {
  if (request.responseContract === 'commentary' || request.responseContract === 'alternative_draft') return undefined;
  if (request.responseContract === 'revision_options') return {
    type: 'object', additionalProperties: false, required: ['options'],
    properties: {
      options: {
        type: 'array',
        minItems: 1,
        maxItems: Math.max(1, Math.min(5, request.optionCount ?? 3)),
        items: {
          type: 'object', additionalProperties: false, required: ['text', 'rationale'],
          properties: { text: { type: 'string' }, rationale: { type: 'string' } }
        }
      }
    }
  };
  if (request.responseContract === 'annotated_findings') return {
    type: 'object', additionalProperties: false, required: ['findings'],
    properties: {
      findings: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['from', 'to', 'source_text', 'comment', 'correction', 'confidence'],
          properties: {
            from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 },
            source_text: { type: 'string' }, comment: { type: 'string' },
            correction: { type: ['string', 'null'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      }
    }
  };
  return {
    type: 'object', additionalProperties: false, required: ['suggestions'],
    properties: {
      suggestions: {
        type: 'array', items: {
          type: 'object', additionalProperties: false,
          required: ['from', 'to', 'source_text', 'type', 'category', 'comment', 'replacement', 'variants', 'confidence'],
          properties: {
            from: { type: 'integer', minimum: 0 }, to: { type: 'integer', minimum: 0 },
            source_text: { type: 'string' },
            type: { type: 'string', enum: ['annotation', 'replacement', 'insertion'] },
            category: { type: 'string', enum: ['pov', 'tense', 'canon', 'cadence', 'diction', 'distance'] },
            comment: { type: 'string' }, replacement: { type: ['string', 'null'] },
            variants: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'number', minimum: 0, maximum: 1 }
          }
        }
      }
    }
  };
}

async function requestConfiguredProvider(provider: ConfiguredProvider, request: GenerationRequest): Promise<{ drafts: DraftSuggestion[]; latencyMs: number; usage: ProviderUsage; diagnostics: Array<Omit<InputError, 'source'>> }> {
  const started = performance.now();
  const originalPrompt = assemblePrompt(request);
  let previousOutput = '';
  let previousFailure = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let cacheWriteTokens = 0;
  let reportedCostUsd: number | undefined;
  const diagnostics: Array<Omit<InputError, 'source'>> = [];
  const maxAttempts = 3;
  let maxTokens = Math.max(1000, Math.min(50000, request.maxOutputTokens ?? 6000));
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const messages = attempt === 1 || !previousFailure
      ? [{ role: 'user' as const, content: originalPrompt }]
      : [
          { role: 'user' as const, content: originalPrompt },
          ...(previousOutput ? [{ role: 'assistant' as const, content: previousOutput.slice(0, 12000) }] : []),
          {
            role: 'user' as const,
            content: `Your previous response was rejected: ${previousFailure} Return the answer again as one valid JSON object matching the requested schema exactly. Return JSON only, with no Markdown fence or explanation.`
          }
        ];
    let completion;
    try {
      completion = await providerCompletion(provider, messages, maxTokens, request.temperature, structuredOutputSchema(request));
    } catch (error) {
      if (!(error instanceof ProviderRequestError)) throw error;
      const diagnostic = error.diagnostics[0] ?? { kind: 'provider_request' as const, classification: 'provider_unavailable' as const, recoveryAction: 'human' as const, message: error.message };
      const retryable = diagnostic.recoveryAction === 'retry_transient' && attempt < maxAttempts;
      diagnostics.push({
        ...diagnostic,
        attempt,
        maxAttempts,
        model: provider.model,
        protocol: provider.protocol,
        outcome: retryable ? 'retry_requested' : 'rejected'
      });
      if (!retryable) throw new ProviderRequestError(error.message, diagnostics, providerUsage({
        source: provider.id, model: provider.model, protocol: provider.protocol, attempts: attempt,
        inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reportedCostUsd
      }));
      previousFailure = '';
      previousOutput = '';
      continue;
    }
    previousOutput = completion.content;
    inputTokens += completion.inputTokens ?? 0;
    outputTokens += completion.outputTokens ?? 0;
    cachedInputTokens += completion.cachedInputTokens ?? 0;
    cacheWriteTokens += completion.cacheWriteTokens ?? 0;
    if (completion.costUsd !== undefined) reportedCostUsd = (reportedCostUsd ?? 0) + completion.costUsd;
    if (completion.truncated) {
      const retryable = attempt < maxAttempts;
      diagnostics.push({
        kind: 'provider_output',
        classification: 'truncated',
        recoveryAction: retryable ? 'increase_budget' : 'human',
        attempt,
        maxAttempts,
        model: provider.model,
        protocol: provider.protocol,
        recovered: false,
        outcome: retryable ? 'retry_requested' : 'rejected',
        message: `Provider stopped at the ${maxTokens}-token output limit.`,
        rawOutput: retainedProviderOutput(previousOutput)
      });
      if (!retryable) throw new ProviderOutputError('Provider output remained truncated after bounded recovery.', diagnostics);
      maxTokens = Math.min(50000, Math.max(12000, maxTokens * 2));
      previousFailure = '';
      previousOutput = '';
      continue;
    }
    try {
      const parsedResult = parseActionOutputDetailed(previousOutput, request);
      const parsed = parsedResult.suggestions;
      const drafts = attachProviderTargets(parsed, request);
      if (parsedResult.normalization !== 'none') {
        const extracted = parsedResult.normalization === 'extracted';
        diagnostics.push({
          kind: 'provider_output',
          classification: extracted ? 'output_nonconforming' : 'output_invalid',
          recoveryAction: extracted ? 'extract_local' : 'repair_local',
          attempt,
          maxAttempts,
          model: provider.model,
          protocol: provider.protocol,
          recovered: true,
          outcome: extracted ? 'normalized_locally' : 'repaired_locally',
          message: extracted
            ? 'Valid JSON was extracted from surrounding provider text.'
            : 'Malformed provider output was repaired locally before validation.',
          rawOutput: retainedProviderOutput(previousOutput)
        });
      }
      for (let index = 0; index < diagnostics.length; index += 1) {
        if (diagnostics[index].outcome === 'retry_requested') diagnostics[index] = { ...diagnostics[index], recovered: true, outcome: 'recovered_by_retry' };
      }
      return {
        drafts,
        latencyMs: performance.now() - started,
        usage: providerUsage({
          source: provider.id, model: provider.model, protocol: provider.protocol, attempts: attempt,
          inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reportedCostUsd
        }),
        diagnostics
      };
    } catch (error) {
      if (!(error instanceof ProviderOutputError)) throw error;
      previousFailure = error.message;
      diagnostics.push({
        kind: 'provider_output',
        classification: 'output_invalid',
        recoveryAction: attempt < maxAttempts ? 'correct_output' : 'human',
        attempt,
        maxAttempts,
        model: provider.model,
        protocol: provider.protocol,
        recovered: false,
        outcome: attempt < maxAttempts ? 'retry_requested' : 'rejected',
        message: error.message,
        rawOutput: retainedProviderOutput(previousOutput)
      });
      if (attempt === maxAttempts) throw new ProviderOutputError(`${error.message} Automatic corrective retries also failed.`, diagnostics, providerUsage({
        source: provider.id, model: provider.model, protocol: provider.protocol, attempts: attempt,
        inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens, reportedCostUsd
      }));
    }
  }
  throw new ProviderOutputError('Provider output recovery exhausted.');
}

export async function generateSuggestions(request: GenerationRequest): Promise<{ proposals: InputProposal[]; errors: InputError[]; usage: ProviderUsage[] }> {
  const proposals: InputProposal[] = [];
  const errors: InputError[] = [];
  const usage: ProviderUsage[] = [];
  const providers = configuredProviders();
  const activeProviders = providers.filter((provider) => request.sourceStates[provider.id] && request.sourceStates[provider.id] !== 'off');
  const selectionRequest = request.prompt.id !== 'sentinel';
  if (request.sourceStates['local-craft'] !== 'off') {
    const started = performance.now();
    const drafts = localChecks(request);
    const latency = performance.now() - started;
    proposals.push(...drafts.map((draft) => proposalFromDraft(draft, request, 'local-craft', 1, 'local', latency)));
  }
  // Selection replay is a deterministic fallback. When a real provider is active,
  // do not obscure its result with a scripted "no safe alternative" annotation.
  if (request.sourceStates['fake-sentinel'] !== 'off' && !(selectionRequest && activeProviders.length)) {
    await new Promise((resolve) => setTimeout(resolve, 280));
    proposals.push(...scriptedChecks(request).map((draft) => proposalFromDraft(draft, request, 'fake-sentinel', 2, 'ai', 280, 0.00002)));
  }
  for (const provider of providers) {
    if (!request.sourceStates[provider.id] || request.sourceStates[provider.id] === 'off') continue;
    try {
      const result = await requestConfiguredProvider(provider, request);
      usage.push(result.usage);
      errors.push(...result.diagnostics.map((diagnostic) => ({ ...diagnostic, source: provider.id })));
      proposals.push(...result.drafts.map((draft) => {
        const proposal = proposalFromDraft(draft, request, provider.id, provider.number, 'ai', result.latencyMs);
        proposal.provenance.inputTokens = result.usage.inputTokens;
        proposal.provenance.outputTokens = result.usage.outputTokens;
        proposal.provenance.providerAttempts = result.usage.attempts;
        proposal.provenance.model = provider.model;
        return proposal;
      }));
    } catch (error) {
      if ((error instanceof ProviderOutputError || error instanceof ProviderRequestError) && error.diagnostics.length) {
        errors.push(...error.diagnostics.map((diagnostic) => ({ ...diagnostic, source: provider.id })));
        if (error.usage) usage.push(error.usage);
      } else {
        errors.push({
          source: provider.id,
          kind: error instanceof ProviderOutputError ? 'provider_output' : 'provider_request',
          message: error instanceof Error ? error.message : 'Provider failed'
        });
      }
    }
  }
  const availability = suggestionSourceAvailability();
  for (const [source, participation] of Object.entries(request.sourceStates)) {
    if (participation !== 'off' && source !== 'local-craft' && source !== 'fake-sentinel' && !availability[source]?.available) {
      errors.push({ source, kind: 'configuration', classification: 'configuration', recoveryAction: 'reconfigure', message: availability[source]?.reason ?? 'Source is not configured.' });
    }
  }
  return { proposals, errors, usage };
}

/** Replays retained provider text through current local parsing and anchoring. No provider is called. */
export function recoverSuggestions(
  request: GenerationRequest,
  retainedErrors: InputError[]
): { proposals: InputProposal[]; errors: InputError[]; usage: ProviderUsage[] } {
  const proposals: InputProposal[] = [];
  const errors: InputError[] = [];
  const providers = new Map(configuredProviders().map((provider) => [provider.id, provider]));
  const latestBySource = new Map<string, InputError>();
  for (const error of retainedErrors) {
    if (error.kind === 'provider_output' && error.rawOutput) latestBySource.set(error.source, error);
  }
  for (const [source, retained] of latestBySource) {
    try {
      let replayOutput = retained.rawOutput!;
      // Earlier Margin Note builds cut diagnostics at exactly 6000 characters.
      // Salvage only balanced, complete array items rather than letting JSON repair
      // turn the final cut-off option into a plausible but incomplete revision.
      if (replayOutput.length === 6000 && (request.responseContract === 'revision_options' || request.responseContract === 'annotated_findings')) {
        const key = request.responseContract === 'revision_options' ? 'options' : 'findings';
        const completeItems = balancedJsonCandidates(replayOutput).flatMap((candidate) => {
          try {
            const value = JSON.parse(candidate) as unknown;
            if (!record(value)) return [];
            if (key === 'options' && typeof value.text === 'string') return [value];
            if (key === 'findings' && typeof value.source_text === 'string' && typeof value.comment === 'string') return [value];
          } catch {
            // Only fully balanced legacy items are safe to salvage.
          }
          return [];
        });
        if (completeItems.length) replayOutput = JSON.stringify({ [key]: completeItems });
      }
      const parsed = parseActionOutputDetailed(replayOutput, request);
      const drafts = attachProviderTargets(parsed.suggestions, request);
      const provider = providers.get(source);
      const sourceNumber = provider?.number ?? 3;
      proposals.push(...drafts.map((draft) => {
        const proposal = proposalFromDraft(draft, request, source, sourceNumber, 'ai', 0);
        proposal.provenance.model = provider?.model ?? retained.model ?? source;
        return proposal;
      }));
      errors.push({
        ...retained,
        recovered: true,
        outcome: 'repaired_locally',
        recoveryAction: 'repair_local',
        localReplay: true,
        message: 'Retained provider response was recovered locally without a new provider request.'
      });
    } catch (error) {
      errors.push({
        ...retained,
        recovered: false,
        outcome: 'rejected',
        recoveryAction: 'human',
        localReplay: true,
        message: error instanceof Error ? error.message : 'Retained provider response could not be recovered locally.'
      });
    }
  }
  return { proposals, errors, usage: [] };
}
