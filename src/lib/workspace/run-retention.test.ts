import { describe, expect, it } from 'vitest';
import type { CraftRun } from '$lib/domain';
import { textTarget } from './attachments';
import { compactRunHistory, resolveRunContext, resolveRunRequest } from './run-retention';

function run(state: CraftRun['state']): CraftRun {
  const context = {
    workspaceRevision: 1,
    forkId: 'document',
    target: { documentId: 'document', sourceRevision: 1, target: textTarget('document', 1, 5, 'Text'), exactText: 'Text' },
    items: []
  };
  return {
    id: 'run-1', documentId: 'document', sourceRevision: 1, target: textTarget('document', 1, 5, 'Text'),
    originalText: 'Text', promptId: 'review', promptVersion: 1, sourceStates: { provider: 'visible' },
    state, proposalIds: [], errors: [], createdAt: '2026-08-29T00:00:00Z',
    request: {
      activityId: 'activity-1', runId: 'run-1', sessionId: 'session', projectId: 'project', documentId: 'document',
      intent: 'review', action: { id: 'review', name: 'Review', version: 1, intent: 'review', instruction: 'Review.' },
      target: context.target, context, permittedProposalKinds: ['craft_input'], sources: [], generation: {}
    },
    requestedContextManifest: context,
    contextManifest: context
  };
}

describe('durable AI run retention', () => {
  it('stores identical context once and reuses its snapshot ID', () => {
    const compact = compactRunHistory([run('completed'), { ...run('completed'), id: 'run-2' }]);
    expect(Object.keys(compact.contextSnapshots)).toHaveLength(1);
    expect(compact.runs[0].contextSnapshotId).toBe(compact.runs[1].contextSnapshotId);
  });

  it('keeps completed run metadata while replacing embedded context with a reference', () => {
    const result = compactRunHistory([run('completed')]);
    const compact = result.runs[0];
    expect(compact.request).toBeUndefined();
    expect(compact.requestedContextManifest).toBeUndefined();
    expect(compact.contextManifest).toBeUndefined();
    expect(resolveRunContext(compact, result.contextSnapshots)?.workspaceRevision).toBe(1);
  });

  it('reduces interrupted runs without provider output to diagnostic metadata', () => {
    const interrupted = run('failed');
    interrupted.errors = [{
      source: 'provider', kind: 'provider_request', classification: 'interrupted', recoveryAction: 'retry_transient',
      recovered: false, message: 'Session ended.'
    }];
    const result = compactRunHistory([interrupted]);
    const compact = result.runs[0];
    expect(compact.request).toBeUndefined();
    expect(compact.requestedContextManifest).toBeUndefined();
    expect(compact.contextManifest).toBeUndefined();
    expect(compact.contextSnapshotId).toBeUndefined();
    expect(result.contextSnapshots).toEqual({});
    expect(compact.errors).toHaveLength(1);
  });

  it('rehydrates a failed request from its shared snapshot', () => {
    const result = compactRunHistory([run('failed')]);
    expect(result.runs[0].request?.context).toBeUndefined();
    expect(resolveRunRequest(result.runs[0], result.contextSnapshots)?.context.workspaceRevision).toBe(1);
  });
});
