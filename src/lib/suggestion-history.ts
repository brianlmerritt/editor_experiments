import { coalesceDuplicateSuggestions, type LedgerEvent, type Suggestion, type SuggestionState } from '$lib/domain';

const stateEvents = new Map<LedgerEvent['type'], SuggestionState>([
  ['accepted_via_tick', 'accepted'],
  ['accepted_via_keyboard', 'accepted'],
  ['accepted_then_edited', 'accepted'],
  ['rejected', 'rejected'],
  ['dismissed_via_drag', 'rejected'],
  ['dismiss_undone', 'pending'],
  ['stale_on_arrival', 'stale'],
  ['stale_after_edit', 'stale'],
  ['expired_on_brief_change', 'stale'],
  ['duplicate_suppressed', 'superseded']
]);

/** Rebuilds the latest suggestion state from the append-only ledger. */
export function restoreSuggestions(events: Required<LedgerEvent>[]): Suggestion[] {
  const states = new Map<string, SuggestionState>();
  const suggestions = new Map<string, Suggestion>();

  for (const event of events) {
    if (!event.suggestionId) continue;
    const nextState = stateEvents.get(event.type);
    if (nextState && !states.has(event.suggestionId)) states.set(event.suggestionId, nextState);
    if (event.type !== 'suggestion_generated' && event.type !== 'generated_hidden') continue;
    if (suggestions.has(event.suggestionId)) continue;
    const suggestion = (event.payload as { suggestion?: Suggestion }).suggestion;
    if (!suggestion) continue;
    suggestions.set(event.suggestionId, {
      ...suggestion,
      state: states.get(event.suggestionId) ?? suggestion.state
    });
  }

  const restored = [...suggestions.values()].sort((left, right) => left.order - right.order);
  return coalesceDuplicateSuggestions(restored).suggestions;
}
