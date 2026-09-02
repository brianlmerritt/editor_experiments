import { describe, expect, it } from 'vitest';
import { aiActionDefaultsVersion, aiTellAuditActionId, cloneDefaultAIActions, migrateAIActions, normalizedAIActions, prosePatternAuditActionId } from './actions';

describe('project AI action definitions', () => {
  it('provides separate AI and prose pattern audits without project-change authority', () => {
    const actions = cloneDefaultAIActions();
    expect(actions.map((action) => action.responseContract)).toEqual([
      'commentary', 'annotated_findings', 'revision_options', 'alternative_draft', 'annotated_findings', 'annotated_findings'
    ]);
    expect(actions.every((action) => action.intent !== ('propose_project_change' as never))).toBe(true);
    expect(actions.filter((action) => action.responseContract === 'revision_options' || action.responseContract === 'alternative_draft')
      .every((action) => action.requiresSelection && action.allowedTargets.length === 1)).toBe(true);
    const aiPattern = actions.find((action) => action.id === aiTellAuditActionId);
    const prosePattern = actions.find((action) => action.id === prosePatternAuditActionId);
    expect(aiPattern).toMatchObject({ name: 'AI pattern audit', version: 4, defaultTarget: 'document', inputCategory: 'ai_tell' });
    expect(aiPattern?.instruction).toContain('Do not turn this into a general document review');
    expect(aiPattern?.instruction).toContain('faster, smarter, and more effective');
    expect(aiPattern?.instruction).toContain('Do not flag ordinary emotion labels');
    expect(prosePattern).toMatchObject({ name: 'Prose pattern audit', version: 1, defaultTarget: 'document', inputCategory: 'prose_pattern' });
    expect(prosePattern?.instruction).toContain('Cadence monoculture');
    expect(prosePattern?.instruction).toContain('Voice convergence');
    expect(prosePattern?.instruction).toContain('not a general document review');
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

  it('adds both audits once to older project actions without resurrecting them after migration', () => {
    const olderActions = cloneDefaultAIActions().filter((action) =>
      action.id !== aiTellAuditActionId && action.id !== prosePatternAuditActionId);
    const migrated = migrateAIActions(olderActions, 1);
    expect(migrated.migrated).toBe(true);
    expect(migrated.actions.filter((action) => action.id === aiTellAuditActionId)).toHaveLength(1);
    expect(migrated.actions.filter((action) => action.id === prosePatternAuditActionId)).toHaveLength(1);

    const staleDetector = cloneDefaultAIActions().map((action) => action.id === aiTellAuditActionId
      ? { ...action, version: 2, instruction: 'Old defensive instruction.' }
      : action);
    const updated = migrateAIActions(staleDetector, 3);
    expect(updated.actions.find((action) => action.id === aiTellAuditActionId)).toMatchObject({
      version: 4,
      instruction: expect.stringContaining('narrow, high-precision audit')
    });

    const intentionallyRemoved = migrateAIActions(olderActions, aiActionDefaultsVersion);
    expect(intentionallyRemoved.migrated).toBe(false);
    expect(intentionallyRemoved.actions.some((action) => action.id === aiTellAuditActionId)).toBe(false);
    expect(intentionallyRemoved.actions.some((action) => action.id === prosePatternAuditActionId)).toBe(false);
  });
});
