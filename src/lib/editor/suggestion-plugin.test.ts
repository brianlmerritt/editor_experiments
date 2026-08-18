import { describe, expect, it } from 'vitest';
import type { Suggestion } from '$lib/domain';
import { preferredSuggestionRange } from './suggestion-plugin';

const suggestion = {
  target: { mode: 'snapshot', targets: [{ type: 'text', nodeId: 'main', start: 10, end: 17 }] },
  anchor: { from: 10, to: 17, text: 'noticed' }
} as Suggestion;

describe('suggestion range resolution', () => {
  it('prefers a live relative range over stale numeric target coordinates', () => {
    expect(preferredSuggestionRange(suggestion, { from: 24, to: 31 })).toEqual({ from: 24, to: 31 });
  });

  it('falls back to the domain target when no relative range is available', () => {
    expect(preferredSuggestionRange(suggestion, null)).toEqual({ from: 10, to: 17 });
  });
});
