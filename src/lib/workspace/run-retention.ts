import type { AIContextManifest, AIInteractionRequest } from '$lib/ai/contracts';
import type { CraftRun } from '$lib/domain';
import type { WorkspaceDocument } from './model';

export type AIContextSnapshots = Record<string, AIContextManifest>;

function interruptedOnly(run: CraftRun): boolean {
  return run.errors.length > 0 && run.errors.every((error) => error.classification === 'interrupted');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function contextFingerprint(context: AIContextManifest): string {
  const text = canonicalJson(context);
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(36)}${(right >>> 0).toString(36)}`;
}

export function storeContextSnapshot(
  snapshots: AIContextSnapshots,
  context: AIContextManifest
): { id: string; snapshots: AIContextSnapshots } {
  const baseId = `context_${contextFingerprint(context)}`;
  const serialized = canonicalJson(context);
  let id = baseId;
  let collision = 1;
  while (snapshots[id] && canonicalJson(snapshots[id]) !== serialized) {
    collision += 1;
    id = `${baseId}_${collision}`;
  }
  if (snapshots[id]) return { id, snapshots };
  return { id, snapshots: { ...snapshots, [id]: context } };
}

export function resolveRunContext(run: CraftRun, snapshots: AIContextSnapshots): AIContextManifest | undefined {
  return run.contextManifest
    ?? run.requestedContextManifest
    ?? run.request?.context
    ?? (run.contextSnapshotId ? snapshots[run.contextSnapshotId] : undefined);
}

export function resolveRunRequest(run: CraftRun, snapshots: AIContextSnapshots): AIInteractionRequest | null {
  if (!run.request) return null;
  const context = run.request.context ?? resolveRunContext(run, snapshots);
  return context ? { ...run.request, context } : null;
}

/**
 * Store immutable Writing Context once per document and retain only its ID on
 * each run. A provider request is expanded again only when retry/recovery needs
 * it. Interrupted runs without provider output retain diagnostics, not payload.
 */
export function compactRunHistory(
  runs: CraftRun[],
  existingSnapshots: AIContextSnapshots = {}
): { runs: CraftRun[]; contextSnapshots: AIContextSnapshots } {
  let contextSnapshots: AIContextSnapshots = {};
  const compactedRuns = runs.map((run) => {
    const interrupted = interruptedOnly(run) && run.state !== 'queued' && run.state !== 'running';
    const context = interrupted ? undefined : resolveRunContext(run, existingSnapshots);
    let contextSnapshotId: string | undefined;
    if (context) {
      const registered = storeContextSnapshot(contextSnapshots, context);
      contextSnapshots = registered.snapshots;
      contextSnapshotId = registered.id;
    }

    const keepRequest = !interrupted
      && (run.state === 'queued' || run.state === 'running' || run.state === 'failed' || run.state === 'partial');
    const request = keepRequest && run.request
      ? (({ context: _context, ...requestWithoutContext }) => requestWithoutContext)(run.request)
      : undefined;
    const {
      requestedContextManifest: _requestedContextManifest,
      contextManifest: _contextManifest,
      contextSnapshotId: _previousContextSnapshotId,
      request: _request,
      ...summary
    } = run;
    return {
      ...summary,
      ...(contextSnapshotId ? { contextSnapshotId } : {}),
      ...(request ? { request } : {})
    };
  });
  return { runs: compactedRuns, contextSnapshots };
}

export function compactDocumentRunPayloads(document: WorkspaceDocument): WorkspaceDocument {
  const marginNote = document.extensions.margin_note;
  if (!marginNote || typeof marginNote !== 'object' || Array.isArray(marginNote) || !Array.isArray(marginNote.runs)) return document;
  const existingSnapshots = marginNote.contextSnapshots && typeof marginNote.contextSnapshots === 'object' && !Array.isArray(marginNote.contextSnapshots)
    ? marginNote.contextSnapshots as unknown as AIContextSnapshots
    : {};
  const compacted = compactRunHistory(marginNote.runs as unknown as CraftRun[], existingSnapshots);
  return {
    ...document,
    extensions: {
      ...document.extensions,
      margin_note: {
        ...marginNote,
        runs: compacted.runs,
        contextSnapshots: compacted.contextSnapshots
      } as unknown as WorkspaceDocument['extensions']['margin_note']
    }
  };
}
