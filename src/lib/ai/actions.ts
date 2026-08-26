import type { Category } from '$lib/domain';
import type { AIContextSelection, AIInteractionIntent } from './contracts';

export const aiResponseContracts = ['commentary', 'annotated_findings', 'revision_options', 'alternative_draft'] as const;
export type AIResponseContract = (typeof aiResponseContracts)[number];
export type AIActionTargetScope = 'selection' | 'document';

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
  }
];

export function cloneDefaultAIActions(): AIActionDefinition[] {
  return defaultAIActions.map((action) => ({
    ...action,
    allowedTargets: [...action.allowedTargets],
    context: { ...action.context, addedSourceIds: [...action.context.addedSourceIds] }
  }));
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
      inputCategory: action.inputCategory && ['pov', 'tense', 'canon', 'cadence', 'diction', 'distance'].includes(action.inputCategory)
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
