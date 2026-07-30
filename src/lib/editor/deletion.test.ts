import { describe, expect, it } from 'vitest';
import { planDeletionBoundaries } from './deletion';

function deleteToken(source: string, token: string): string {
  const from = source.indexOf(token);
  if (from < 0) throw new Error(`Token not found: ${token}`);
  const to = from + token.length;
  const before = source.slice(0, from);
  const after = source.slice(to);
  const plan = planDeletionBoundaries(before, after);
  return `${before.slice(0, before.length - plan.removeBefore)}${plan.insert}${after.slice(plan.removeAfter)}`;
}

describe('contextual deletion', () => {
  it('capitalizes a newly exposed sentence-initial word', () => {
    expect(deleteToken('Slowly, he opened the door.', 'Slowly')).toBe('He opened the door.');
    expect(deleteToken('He stopped. Slowly the door opened.', 'Slowly')).toBe('He stopped. The door opened.');
  });

  it('removes separator punctuation attached to the deleted phrase', () => {
    expect(deleteToken('He ran, slowly, toward home.', 'slowly')).toBe('He ran toward home.');
    expect(deleteToken('He ran slowly; then stopped.', 'slowly')).toBe('He ran then stopped.');
    expect(deleteToken('Red, blue and green.', 'blue')).toBe('Red and green.');
  });

  it('preserves sentence punctuation that still separates sentences', () => {
    expect(deleteToken('He ran slowly. Then stopped.', 'slowly')).toBe('He ran. Then stopped.');
    expect(deleteToken('He ran, slowly.', 'slowly')).toBe('He ran.');
  });

  it('removes empty paired punctuation around a deleted phrase', () => {
    expect(deleteToken('He moved (slowly) toward home.', 'slowly')).toBe('He moved toward home.');
    expect(deleteToken('He said “slowly”.', 'slowly')).toBe('He said.');
  });

  it('removes an orphan terminal when the deleted word was the whole sentence', () => {
    expect(deleteToken('Slowly. he waited.', 'Slowly')).toBe('He waited.');
  });
});
