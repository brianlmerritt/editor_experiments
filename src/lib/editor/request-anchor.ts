import type { Suggestion } from '$lib/domain';

export interface TrackedRequestRange {
  from: number;
  to: number;
  text: string;
  start?: Record<string, unknown>;
  end?: Record<string, unknown>;
}

export interface ResolvedRequestRange {
  from: number;
  to: number;
  text: string;
}

/**
 * Translate a provider response from its original request coordinates into the
 * current document. A response is usable only while the requested passage is
 * unchanged; edits elsewhere may move it safely.
 */
export function rebaseResponseRange(
  suggestion: Suggestion,
  requested: TrackedRequestRange,
  resolved: ResolvedRequestRange,
  currentText: (from: number, to: number) => string
): { from: number; to: number } | null {
  if (resolved.text !== requested.text) return null;
  const localFrom = suggestion.anchor.from - requested.from;
  const localTo = suggestion.anchor.to - requested.from;
  if (localFrom < 0 || localTo < localFrom || localTo > requested.text.length) return null;
  const from = resolved.from + localFrom;
  const to = resolved.from + localTo;
  if (to > resolved.to || currentText(from, to) !== suggestion.anchor.text) return null;
  return { from, to };
}
