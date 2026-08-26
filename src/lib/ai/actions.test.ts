import { describe, expect, it } from 'vitest';
import { cloneDefaultAIActions, normalizedAIActions } from './actions';

describe('project AI action definitions', () => {
  it('provides the four initial response contracts without project-change authority', () => {
    const actions = cloneDefaultAIActions();
    expect(actions.map((action) => action.responseContract)).toEqual([
      'commentary', 'annotated_findings', 'revision_options', 'alternative_draft'
    ]);
    expect(actions.every((action) => action.intent !== ('propose_project_change' as never))).toBe(true);
    expect(actions.filter((action) => action.responseContract === 'revision_options' || action.responseContract === 'alternative_draft')
      .every((action) => action.requiresSelection && action.allowedTargets.length === 1)).toBe(true);
  });

  it('normalizes imported settings and bounds provider-facing values', () => {
    const [action] = normalizedAIActions([{
      ...cloneDefaultAIActions()[0],
      optionCount: 99,
      maxOutputTokens: 90000,
      temperature: 9
    }]);
    expect(action).toMatchObject({ optionCount: 5, maxOutputTokens: 50000, temperature: 2 });
  });
});
