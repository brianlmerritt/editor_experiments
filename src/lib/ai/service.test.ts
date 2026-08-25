import { describe, expect, it, vi } from 'vitest';
import type { WritingBrief } from '$lib/domain';
import { textTarget } from '$lib/workspace/attachments';
import type { WorkspaceFacade } from '$lib/workspace/facade';
import type { AIInteractionRequest } from './contracts';
import { FacadeAIInteractionService } from './service';

const brief: WritingBrief = { version: 1, form: 'fiction', pov: 'third', tense: 'past', distance: 'close', canon: '' };

function request(): AIInteractionRequest {
  const target = { documentId: 'main', sourceRevision: 7, target: textTarget('main', 4, 11, 'noticed'), exactText: 'noticed' };
  return {
    activityId: 'activity-1', runId: 'run-1', sessionId: 'session', projectId: 'project', documentId: 'main',
    intent: 'revise',
    action: { id: 'heighten', name: 'Heighten', version: 2, intent: 'revise', instruction: 'Use a stronger verb.' },
    target,
    context: {
      workspaceRevision: 7,
      forkId: 'main',
      target,
      items: [
        {
          id: 'action', sourceType: 'action', sourceId: 'heighten', sourceRevision: 2, role: 'protocol',
          title: 'Heighten', content: 'Use a stronger verb.', reason: 'Selected action', inclusion: 'required', sent: true
        },
        {
          id: 'spine', sourceType: 'spine', sourceId: 'spine', sourceRevision: 3, role: 'constraint',
          title: 'Spine', content: 'Keep Mara in close third.', reason: 'Project Spine', inclusion: 'resolved', sent: true
        },
        {
          id: 'omitted', sourceType: 'material', sourceId: 'research', sourceRevision: 1, role: 'reference',
          title: 'Research', content: 'Unused detail', reason: 'Optional research', inclusion: 'resolved', sent: false,
          omissionReason: 'writer_excluded'
        }
      ]
    },
    permittedProposalKinds: ['craft_input'],
    sources: [{ sourceId: 'openrouter', participation: 'visible', model: 'test/model' }],
    generation: { brief, mode: 'revising' }
  };
}

describe('Facade AI interaction service', () => {
  it('translates only captured and sent evidence for the existing craft transport', async () => {
    const requestInputs = vi.fn(async () => ({ proposals: [], errors: [] }));
    const facade = { requestInputs } as unknown as WorkspaceFacade;
    const domainRequest = request();

    const result = await new FacadeAIInteractionService(facade).execute(domainRequest);

    expect(requestInputs).toHaveBeenCalledWith(expect.objectContaining({
      text: 'noticed',
      from: 4,
      to: 11,
      prompt: { id: 'heighten', name: 'Heighten', version: 2, instruction: 'Use a stronger verb.' },
      sourceStates: { openrouter: 'visible' },
      context: [{ title: 'Spine', role: 'constraint', scope: 'project', content: 'Keep Mara in close third.', revision: 3 }]
    }), undefined);
    expect(result.context).toBe(domainRequest.context);
  });

  it('does not call transport when the action cannot return craft Inputs', async () => {
    const requestInputs = vi.fn();
    const facade = { requestInputs } as unknown as WorkspaceFacade;
    const domainRequest = { ...request(), permittedProposalKinds: ['project_change'] };

    const result = await new FacadeAIInteractionService(facade).execute(domainRequest);

    expect(requestInputs).not.toHaveBeenCalled();
    expect(result.diagnostics[0]).toMatchObject({ kind: 'contract' });
  });
});
