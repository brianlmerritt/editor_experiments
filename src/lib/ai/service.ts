import type { GenerationRequest, InputProposal, SourceState, WritingBrief, WritingMode } from '$lib/domain';
import { firstTextTarget } from '$lib/workspace/attachments';
import type { WorkspaceFacade } from '$lib/workspace/facade';
import type { AIInteractionRequest, AIInteractionResult, AIInteractionService } from './contracts';

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

/**
 * Temporary transport adapter for the existing craft endpoint. It receives all of
 * its evidence in the request and has no access to WorkspaceState or persistence.
 */
export class FacadeAIInteractionService implements AIInteractionService {
  constructor(private readonly facade: WorkspaceFacade) {}

  async execute(request: AIInteractionRequest, signal?: AbortSignal): Promise<AIInteractionResult<InputProposal>> {
    const responseContract = request.action.responseContract;
    const proposalKind = responseContract === 'commentary' ? 'commentary_input'
      : responseContract === 'annotated_findings' ? 'annotated_input'
        : responseContract === 'revision_options' ? 'revision_options'
          : responseContract === 'alternative_draft' ? 'alternative_draft'
            : 'craft_input';
    if (!request.permittedProposalKinds.includes(proposalKind)) {
      return {
        proposals: [],
        diagnostics: [{ source: 'interaction_service', kind: 'contract', message: `The interaction transport was called without permission to return ${proposalKind}.` }],
        context: request.context,
        usage: []
      };
    }
    const target = firstTextTarget(request.target.target);
    if (!target || target.nodeId !== request.documentId) {
      return {
        proposals: [],
        diagnostics: [{ source: 'interaction_service', kind: 'contract', message: 'The craft transport requires one captured text target in the active document.' }],
        context: request.context,
        usage: []
      };
    }
    const generation = craftGeneration(request.generation);
    const spine = request.context.items.find((item) => item.sent && item.sourceType === 'spine');
    const sourceStates = Object.fromEntries(request.sources.map((source) => [source.sourceId, source.participation])) as Record<string, SourceState>;
    const legacyRequest: GenerationRequest = {
      text: request.target.exactText,
      from: target.start,
      to: target.end,
      branchId: request.documentId,
      sessionId: request.sessionId,
      // The Spine is the writing authority. The legacy brief shape remains only
      // as transport compatibility until the old craft endpoint is retired.
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
      responseContract,
      optionCount: request.action.optionCount,
      includeExplanation: request.action.includeExplanation,
      inputCategory: request.action.inputCategory as GenerationRequest['inputCategory'],
      maxOutputTokens: request.action.maxOutputTokens,
      temperature: request.action.temperature
    };
    const result = await this.facade.requestInputs(legacyRequest, signal);
    return {
      proposals: result.proposals.map((proposal) => ({ kind: proposalKind, payload: proposal })),
      diagnostics: result.errors,
      context: request.context,
      usage: result.usage ?? []
    };
  }
}
