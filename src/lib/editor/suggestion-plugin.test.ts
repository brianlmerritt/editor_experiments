import { describe, expect, it } from 'vitest';
import type { Suggestion } from '$lib/domain';
import { suggestionRange } from './suggestion-plugin';

const suggestion = {
  target: { mode: 'snapshot', targets: [{ type: 'text', nodeId: 'main', start: 10, end: 17 }] },
  anchor: { from: 10, to: 17, text: 'noticed' }
} as Suggestion;

describe('suggestion range resolution', () => {
  it('projects the range owned by the Svelte input target', () => {
    expect(suggestionRange(suggestion)).toEqual({ from: 10, to: 17 });
  });
});
