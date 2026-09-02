import type { Category } from '$lib/domain';
import type { AIContextSelection, AIInteractionIntent } from './contracts';

export const aiResponseContracts = ['commentary', 'annotated_findings', 'revision_options', 'alternative_draft'] as const;
export type AIResponseContract = (typeof aiResponseContracts)[number];
export type AIActionTargetScope = 'selection' | 'document';
export const aiTellAuditActionId = 'ai-tell-audit';
export const prosePatternAuditActionId = 'prose-pattern-audit';
export const aiActionDefaultsVersion = 5;

export interface AIActionDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  intent: Exclude<AIInteractionIntent, 'propose_project_change'>;
  instruction: string;
  allowedTargets: AIActionTargetScope[];
  defaultTarget: AIActionTargetScope;
  requiresSelection: boolean;
  context: AIContextSelection;
  responseContract: AIResponseContract;
  optionCount: number;
  includeExplanation: boolean;
  inputCategory: Category;
  preferredSourceId?: string;
  maxOutputTokens: number;
  temperature?: number;
}

const common = {
  version: 1,
  allowedTargets: ['selection', 'document'] as AIActionTargetScope[],
  defaultTarget: 'selection' as const,
  requiresSelection: false,
  context: { includeMaterial: true, includeRelationships: true, includeTodos: true, addedSourceIds: [] },
  optionCount: 3,
  includeExplanation: true,
  preferredSourceId: undefined,
  maxOutputTokens: 15000,
  temperature: undefined
};

export const defaultAIActions: AIActionDefinition[] = [
  {
    ...common,
    id: 'discuss-passage',
    name: 'Discuss passage',
    description: 'Ask for an editorial response without proposing a replacement.',
    intent: 'discuss',
    instruction: 'Discuss the target in relation to the supplied writing context. Be specific, candid, and useful. Do not rewrite it unless the writer explicitly asks you to.',
    responseContract: 'commentary',
    inputCategory: 'canon'
  },
  {
    ...common,
    id: 'review-passage',
    name: 'Review passage',
    description: 'Return precisely anchored editorial findings.',
    intent: 'review',
    instruction: 'Review the target against the supplied writing context. Report only substantive findings, anchor each finding to exact target text, and include a correction only when it is genuinely useful.',
    responseContract: 'annotated_findings',
    inputCategory: 'canon'
  },
  {
    ...common,
    id: 'suggest-revisions',
    name: 'Suggest revisions',
    description: 'Offer several complete alternatives for the selected target.',
    intent: 'revise',
    instruction: 'Offer distinct revisions of the complete target. Preserve established facts and constraints, and explain the meaningful trade-off of each option briefly.',
    responseContract: 'revision_options',
    allowedTargets: ['selection'],
    requiresSelection: true,
    inputCategory: 'diction'
  },
  {
    ...common,
    id: 'alternative-draft',
    name: 'Alternative draft',
    description: 'Produce one complete alternative version for comparison.',
    intent: 'revise',
    instruction: 'Rewrite the complete target as one coherent alternative. Preserve established facts and all supplied constraints. Return only the alternative passage.',
    responseContract: 'alternative_draft',
    allowedTargets: ['selection'],
    requiresSelection: true,
    optionCount: 1,
    includeExplanation: false,
    inputCategory: 'diction'
  },
  {
    ...common,
    id: aiTellAuditActionId,
    name: 'AI pattern audit',
    version: 4,
    description: 'Audit high-confidence formulas and statistical habits associated with unedited generated prose.',
    intent: 'review',
    instruction: `Perform a narrow, high-precision audit for recognised formulas and statistical habits associated with unedited generated prose. This is not an authorship-classification task: never claim that AI wrote the text and never assign an AI probability. Do not turn this into a general document review. Name the recognised pattern, anchor its exact evidence, explain the local effect, and suggest a correction only when useful. Return no finding when the evidence is ordinary, isolated, intentional, genre-appropriate or better described as a general craft issue.

RECOGNISED LANGUAGE AND RHETORIC
- Stock openings (“In today’s fast-paced digital landscape”), fake invitations (“Let’s delve into…”), importance warnings (“It is important to note”), hollow “at its core” claims, ceremonial “testament” claims, historic “pivotal moment/evolving landscape” inflation, decorative “tapestry/realm/intricate interplay” metaphors, buzzword bundles and inflated “serves as/boasts” verbs.
- Forced contrast (“not just X, but Y”), “not only…but also” double promises, compulsory trios (“faster, smarter, and more effective”), synthetic benefit/challenge balance, binary packaging and formula cappers such as “there’s a difference.”
- Dangling interpretation in trailing “-ing” phrases (“…, underscoring its relevance”), unnamed authorities (“experts believe”, “studies show”), hedge parades, transition parades, conclusion announcements or conclusion replays, generic “the future remains promising” optimism, sycophantic openings and vague calls to action.
- Low-information prose that could survive swapping in a different subject; false depth that restates a problem, lists obvious considerations and ends with “it depends”; praise or significance unsupported by evidence.

STATISTICAL HABITS
- Topic-sentence machinery repeated across paragraphs; conspicuously uniform sentence or paragraph rhythm; repetitive sentence openings; symmetry addiction in equally sized sections, pros/cons or steps.
- List abuse, especially parallel grammatical openings, needless nesting, or neat groups of three or five where prose, a table or fewer items would be clearer.
- Triadic sensory catalogues, recurrent negative assertions, “thought about X” catalogues, em-dash dependence, section breaks used instead of transitions, cataloguing description instead of selecting the revealing detail, and information density that stays unnaturally even.

HIGH-SIGNAL FICTION FORMULAS
- Familiar generated-fiction packages such as “couldn’t help but feel”, held breath the character did not know they were holding, generic waves or surges of named emotion, mechanically heavy silence, catalogue-description shorthand, and conspicuously polished balanced dialogue formulas.
- Do not flag a literal physical phrase merely because it resembles an emotional idiom. Do not flag ordinary emotion labels, common bodily actions, general pacing, plot shape, continuity, character development or scene effectiveness; those belong to Prose Pattern Audit or Document Review.

JUDGEMENT RULES
Evaluate against the supplied genre, voice and purpose. Distinguish deliberate repetition, technical terminology, necessary uncertainty and genre convention from an unexamined generated-prose default. A lone ordinary phrase is not proof of a problem. Sentence-count parity alone is not a finding; require audible repeated machinery. One negative assertion is ordinary; flag a close recurrent tic. Do not invent evidence outside the target or supplied context. Return one finding per substantive pattern family, using related anchors for its repeated evidence rather than duplicate cards. Corrections must preserve facts, voice, tense, point of view and narrative distance. Prefix every comment with a short recognised pattern name, for example “Synthetic balance — …”.`,
    responseContract: 'annotated_findings',
    defaultTarget: 'document',
    inputCategory: 'ai_tell'
  },
  {
    ...common,
    id: prosePatternAuditActionId,
    name: 'Prose pattern audit',
    description: 'Find recurrent prose habits that weaken variety, precision or character distinction, regardless of authorship.',
    intent: 'review',
    instruction: `Audit the target for recurrent prose habits that have become limiting defaults. This is style-neutral editorial analysis, not AI-authorship detection and not a general document review. Judge patterns by their cumulative effect in this particular work. A device can be effective in one passage and excessive across the document.

PATTERN FAMILIES
- Cadence monoculture: persistent fragment chains, uniformly short or long sentences, repeated paragraph shapes, repeated sentence launches, excessive rhythmic symmetry, or one high-intensity cadence continuing after the dramatic pressure changes.
- Recycled lexical and somatic machinery: conspicuous recurrence of breath, heartbeat, swallowing, nodding, silence, stillness, softness, slowness, looking, bodily tension, or another small vocabulary doing the emotional work across many beats.
- Emotional restatement and over-explanation: an image, gesture, line of dialogue or emotional conclusion lands and is then paraphrased, named or confirmed again; motifs recur beyond useful reinforcement.
- Stock emotional shorthand: inherited metaphors, reactions or reassuring phrases that could be transferred unchanged to unrelated characters or scenes.
- Voice convergence: multiple supplied speakers or viewpoint characters repeatedly use the same syntax, emotional fluency, jokes, reassurance, metaphors or coping language. Require comparison evidence from more than one character before finding this.
- Recurrent exposition habits: repeated filtering, interpretation after action, explanatory cappers, catalogue description, or summary that duplicates a scene-level beat.

BOUNDARY
Do not decide whether the plot works, whether a scene should exist, whether continuity or canon is correct, or whether the work satisfies its brief; those belong to Document Review. Do not call a single ordinary phrase a pattern. Do not punish intentional refrain, genre convention, character-specific diction or a cadence that changes appropriately with pressure. Return one finding per pattern family, not one card per occurrence. Use related anchors for exact supporting examples distributed across the target, state the observed recurrence in the comment, and explain where the device remains effective as well as where it becomes excessive. Suggest a correction only when a local correction is genuinely useful. Prefix every comment with a short pattern name such as “Cadence monoculture — …” or “Somatic repetition — …”.`,
    responseContract: 'annotated_findings',
    defaultTarget: 'document',
    inputCategory: 'prose_pattern'
  }
];

export function cloneDefaultAIActions(): AIActionDefinition[] {
  return defaultAIActions.map((action) => ({
    ...action,
    allowedTargets: [...action.allowedTargets],
    context: { ...action.context, addedSourceIds: [...action.context.addedSourceIds] }
  }));
}

export function migrateAIActions(value: unknown, storedDefaultsVersion: unknown): {
  actions: AIActionDefinition[];
  migrated: boolean;
} {
  const actions = normalizedAIActions(value);
  const version = typeof storedDefaultsVersion === 'number' && Number.isInteger(storedDefaultsVersion)
    ? storedDefaultsVersion
    : 1;
  if (version >= aiActionDefaultsVersion) return { actions, migrated: false };
  const managedDefaults = cloneDefaultAIActions().filter((action) =>
    action.id === aiTellAuditActionId || action.id === prosePatternAuditActionId);
  const migratedActions = managedDefaults.reduce((current, managed) => {
    const existingIndex = current.findIndex((action) => action.id === managed.id);
    if (existingIndex < 0) return [...current, managed];
    return current.map((action, index) => index === existingIndex && action.version < managed.version ? managed : action);
  }, actions);
  return {
    actions: migratedActions,
    migrated: true
  };
}

export function normalizedAIActions(value: unknown): AIActionDefinition[] {
  if (!Array.isArray(value)) return cloneDefaultAIActions();
  const actions = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const action = candidate as Partial<AIActionDefinition>;
    const allowedTargets = Array.isArray(action.allowedTargets)
      ? action.allowedTargets.filter((scope): scope is AIActionTargetScope => scope === 'selection' || scope === 'document')
      : [];
    if (!action.id?.trim() || !action.name?.trim() || !action.instruction?.trim()
      || !action.responseContract || !aiResponseContracts.includes(action.responseContract)
      || !action.intent
      || !['review', 'revise', 'discuss', 'generate'].includes(action.intent)
      || !allowedTargets.length) return [];
    const defaultTarget = allowedTargets.includes(action.defaultTarget as AIActionTargetScope)
      ? action.defaultTarget as AIActionTargetScope
      : allowedTargets[0];
    return [{
      id: action.id.trim(),
      name: action.name.trim(),
      description: action.description?.trim() ?? '',
      version: Number.isInteger(action.version) && Number(action.version) > 0 ? Number(action.version) : 1,
      intent: action.intent,
      instruction: action.instruction.trim(),
      allowedTargets,
      defaultTarget,
      requiresSelection: action.requiresSelection === true,
      context: {
        includeMaterial: action.context?.includeMaterial !== false,
        includeRelationships: action.context?.includeRelationships !== false,
        includeTodos: action.context?.includeTodos !== false,
        addedSourceIds: Array.isArray(action.context?.addedSourceIds) ? action.context.addedSourceIds.map(String) : []
      },
      responseContract: action.responseContract,
      optionCount: Math.max(1, Math.min(5, Number.isInteger(action.optionCount) ? Number(action.optionCount) : 3)),
      includeExplanation: action.includeExplanation !== false,
      inputCategory: action.inputCategory && ['pov', 'tense', 'canon', 'cadence', 'diction', 'distance', 'ai_tell', 'prose_pattern'].includes(action.inputCategory)
        ? action.inputCategory
        : 'canon',
      preferredSourceId: action.preferredSourceId?.trim() || undefined,
      maxOutputTokens: Math.max(1000, Math.min(50000, Number.isInteger(action.maxOutputTokens) ? Number(action.maxOutputTokens) : 15000)),
      temperature: typeof action.temperature === 'number' && Number.isFinite(action.temperature)
        ? Math.max(0, Math.min(2, action.temperature))
        : undefined
    } satisfies AIActionDefinition];
  });
  return actions.length ? actions : cloneDefaultAIActions();
}
