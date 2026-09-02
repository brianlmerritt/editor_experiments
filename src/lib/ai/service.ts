import type { GenerationRequest, InputProposal, SourceState, WritingBrief, WritingMode } from '$lib/domain';
import { firstTextTarget } from '$lib/workspace/attachments';
import type { WorkspaceFacade } from '$lib/workspace/facade';
import type { AIInteractionRequest, AIInteractionResult, AIInteractionService, AIServiceDiagnostic } from './contracts';

interface CraftGenerationSettings {
  brief: WritingBrief;
  mode: WritingMode;
}

function craftGeneration(value: Record<string, unknown>): CraftGenerationSettings {
  const brief = value.brief as WritingBrief | undefined;
  const mode = value.mode;
  if (!brief || typeof brief.version !== 'number' || (mode !== 'drafting' && mode !== 'revising')) {
    throw new Error('Craft AI request is missing its captured brief or compatibility mode.');
  }
  return { brief, mode };
}

function proposalKind(request: AIInteractionRequest): string {
  return request.action.responseContract === 'commentary' ? 'commentary_input'
    : request.action.responseContract === 'annotated_findings' ? 'annotated_input'
      : request.action.responseContract === 'revision_options' ? 'revision_options'
        : request.action.responseContract === 'alternative_draft' ? 'alternative_draft'
          : 'craft_input';
}

function legacyGenerationRequest(request: AIInteractionRequest): GenerationRequest | null {
  const target = firstTextTarget(request.target.target);
  if (!target || target.nodeId !== request.documentId) return null;
  const generation = craftGeneration(request.generation);
  const spine = request.context.items.find((item) => item.sent && item.sourceType === 'spine');
  const sourceStates = Object.fromEntries(request.sources.map((source) => [source.sourceId, source.participation])) as Record<string, SourceState>;
  return {
    text: request.target.exactText,
    formattedText: request.target.formattedText,
    from: target.start,
    to: target.end,
    branchId: request.documentId,
    sessionId: request.sessionId,
    brief: spine ? {
      ...generation.brief,
      version: spine.sourceRevision,
      pov: 'See project Spine',
      tense: 'See project Spine',
      distance: 'See project Spine',
      canon: spine.content
    } : generation.brief,
    prompt: {
      id: request.action.id,
      name: request.action.name,
      version: request.action.version,
      instruction: request.writerInstruction?.trim() || request.action.instruction
    },
    sourceStates,
    mode: generation.mode,
    context: request.context.items
      .filter((item) => item.sent && item.sourceType !== 'action' && item.role !== 'target')
      .map((item) => ({
        title: item.title,
        role: item.role,
        scope: item.sourceType === 'manuscript' ? 'document' : 'project',
        content: item.content,
        revision: item.sourceRevision
      })),
    responseContract: request.action.responseContract,
    optionCount: request.action.optionCount,
    includeExplanation: request.action.includeExplanation,
    inputCategory: request.action.inputCategory as GenerationRequest['inputCategory'],
    maxOutputTokens: request.action.maxOutputTokens,
    temperature: request.action.temperature,
    targetScope: request.action.targetScope
  };
}

/**
 * Temporary transport adapter for the existing craft endpoint. It receives all of
 * its evidence in the request and has no access to WorkspaceState or persistence.
 */
export class FacadeAIInteractionService implements AIInteractionService {
  constructor(private readonly facade: WorkspaceFacade) {}

  async execute(request: AIInteractionRequest, signal?: AbortSignal): Promise<AIInteractionResult<InputProposal>> {
    const kind = proposalKind(request);
    if (!request.permittedProposalKinds.includes(kind)) {
      return {
        proposals: [],
        diagnostics: [{ source: 'interaction_service', kind: 'contract', message: `The interaction transport was called without permission to return ${kind}.` }],
        context: request.context,
        usage: []
      };
    }
    const legacyRequest = legacyGenerationRequest(request);
    if (!legacyRequest) {
      return {
        proposals: [],
        diagnostics: [{ source: 'interaction_service', kind: 'contract', message: 'The craft transport requires one captured text target in the active document.' }],
        context: request.context,
        usage: []
      };
    }
    const result = await this.facade.requestInputs(legacyRequest, signal);
    return {
      proposals: result.proposals.map((proposal) => ({ kind, payload: proposal })),
      diagnostics: result.errors,
      context: request.context,
      usage: result.usage ?? []
    };
  }

  async recover(request: AIInteractionRequest, diagnostics: AIServiceDiagnostic[]): Promise<AIInteractionResult<InputProposal>> {
    const kind = proposalKind(request);
    const legacyRequest = legacyGenerationRequest(request);
    if (!legacyRequest || !request.permittedProposalKinds.includes(kind)) {
      return {
        proposals: [],
        diagnostics: [{ source: 'interaction_service', kind: 'contract', message: 'The retained response no longer has a valid captured request.' }],
        context: request.context,
        usage: []
      };
    }
    const result = await this.facade.recoverInputs(legacyRequest, diagnostics);
    return {
      proposals: result.proposals.map((proposal) => ({ kind, payload: proposal })),
      diagnostics: result.errors,
      context: request.context,
      usage: []
    };
  }
}
