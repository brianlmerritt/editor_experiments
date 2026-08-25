import type { TargetSet } from '$lib/workspace/attachments';

export const aiInteractionIntents = ['review', 'revise', 'discuss', 'generate', 'propose_project_change'] as const;
export type AIInteractionIntent = (typeof aiInteractionIntents)[number];

export const aiContextRoles = ['protocol', 'constraint', 'fact', 'guidance', 'reference', 'target'] as const;
export type AIContextRole = (typeof aiContextRoles)[number];

export type AIContextSourceType = 'action' | 'spine' | 'material' | 'relationship' | 'todo' | 'manuscript' | 'input' | 'writer';
export type AIContextInclusion = 'required' | 'resolved' | 'writer_added';
export type AIContextOmissionReason = 'writer_excluded' | 'not_applicable' | 'budget';

export interface AICapturedTarget {
  documentId: string;
  sourceRevision: number;
  target: TargetSet;
  exactText: string;
}

export interface AIContextItem {
  id: string;
  sourceType: AIContextSourceType;
  sourceId: string;
  sourceRevision: number;
  role: AIContextRole;
  title: string;
  content: string;
  reason: string;
  inclusion: AIContextInclusion;
  sent: boolean;
  omissionReason?: AIContextOmissionReason;
}

export interface AIContextManifest {
  workspaceRevision: number;
  forkId: string;
  target: AICapturedTarget;
  items: AIContextItem[];
}

export interface AIActionSnapshot {
  id: string;
  name: string;
  version: number;
  intent: AIInteractionIntent;
  instruction: string;
}

export interface AISourceSelection {
  sourceId: string;
  participation: 'visible' | 'invisible' | 'off';
  model?: string;
}

export interface AIInteractionRequest {
  activityId: string;
  runId: string;
  sessionId: string;
  projectId: string;
  documentId: string;
  intent: AIInteractionIntent;
  action: AIActionSnapshot;
  writerInstruction?: string;
  target: AICapturedTarget;
  context: AIContextManifest;
  permittedProposalKinds: string[];
  sources: AISourceSelection[];
  generation: Record<string, unknown>;
}

export interface AIServiceProposal<T = unknown> {
  kind: string;
  payload: T;
}

export interface AIServiceDiagnostic {
  source: string;
  message: string;
  kind?: 'provider_output' | 'provider_request' | 'configuration' | 'contract';
  attempt?: number;
  recovered?: boolean;
  outcome?: 'normalized_locally' | 'repaired_locally' | 'recovered_by_retry' | 'retry_requested' | 'rejected';
  rawOutput?: string;
  classification?: 'output_nonconforming' | 'output_invalid' | 'truncated' | 'transient' | 'rate_limited' | 'authentication' | 'configuration' | 'provider_unavailable' | 'contract';
  recoveryAction?: 'none' | 'extract_local' | 'repair_local' | 'correct_output' | 'retry_transient' | 'increase_budget' | 'reconfigure' | 'human';
  status?: number;
  maxAttempts?: number;
  model?: string;
  protocol?: 'openai_compatible' | 'anthropic';
  latencyMs?: number;
}

export interface AIInteractionResult<T = unknown> {
  proposals: AIServiceProposal<T>[];
  diagnostics: AIServiceDiagnostic[];
  context: AIContextManifest;
}

export interface AIInteractionService {
  execute(request: AIInteractionRequest, signal?: AbortSignal): Promise<AIInteractionResult>;
}

export type AIActivityState = 'running' | 'completed' | 'partial' | 'failed' | 'cancelled' | 'discarded';

export interface AIActivityRecord {
  id: string;
  documentId: string;
  scope: 'document' | 'selection';
  intent: AIInteractionIntent;
  actionId: string;
  actionVersion: number;
  state: AIActivityState;
  runIds: string[];
  createdAt: string;
  completedAt?: string;
}

function sameTarget(left: AICapturedTarget, right: AICapturedTarget): boolean {
  return left.documentId === right.documentId
    && left.sourceRevision === right.sourceRevision
    && left.exactText === right.exactText
    && JSON.stringify(left.target) === JSON.stringify(right.target);
}

/**
 * A service may mark optional context unsent, but it cannot add hidden context,
 * rewrite captured evidence, or omit a required item.
 */
export function validReturnedContext(requested: AIContextManifest, returned: AIContextManifest): boolean {
  if (requested.workspaceRevision !== returned.workspaceRevision
    || requested.forkId !== returned.forkId
    || !sameTarget(requested.target, returned.target)) return false;

  const requestedById = new Map(requested.items.map((item) => [item.id, item]));
  const returnedById = new Map(returned.items.map((item) => [item.id, item]));
  if (returnedById.size !== returned.items.length || requestedById.size !== requested.items.length) return false;

  for (const item of returned.items) {
    const original = requestedById.get(item.id);
    if (!original) return false;
    const stableFieldsMatch = original.sourceType === item.sourceType
      && original.sourceId === item.sourceId
      && original.sourceRevision === item.sourceRevision
      && original.role === item.role
      && original.title === item.title
      && original.content === item.content
      && original.reason === item.reason
      && original.inclusion === item.inclusion;
    if (!stableFieldsMatch) return false;
    if (!item.sent && !item.omissionReason) return false;
    if (item.sent && item.omissionReason) return false;
  }

  for (const item of requested.items) {
    const result = returnedById.get(item.id);
    if (!result || (item.inclusion === 'required' && !result.sent)) return false;
  }
  return true;
}
