import type { JudgmentPair, LedgerEvent, Suggestion, WritingBrief } from '$lib/domain';

const resolvedTypes = new Set<LedgerEvent['type']>([
  'accepted_via_tick',
  'accepted_via_keyboard',
  'accepted_then_edited',
  'rejected',
  'dismissed_via_drag',
  'stale_on_arrival',
  'stale_after_edit',
  'expired_on_brief_change',
  'duplicate_suppressed'
]);

export function buildReviewQueue(events: Required<LedgerEvent>[], brief: WritingBrief, limit = 50): JudgmentPair[] {
  const latestStart = events.findIndex((event) => event.type === 'session_started');
  const currentEvents = latestStart < 0 ? events : events.slice(0, latestStart);
  const resolved = new Set(currentEvents.filter((event) => resolvedTypes.has(event.type)).map((event) => event.suggestionId).filter(Boolean));
  const judgments = currentEvents.filter((event) => event.type === 'judgment_recorded');
  const judgedPairs = new Set(judgments.map((event) => String(event.payload.pairId ?? '')));
  const judgedSuggestions = new Set(judgments
    .filter((event) => event.payload.pairId === `pair_${event.suggestionId}`)
    .map((event) => event.suggestionId));
  const seen = new Set<string>();
  const pairs: JudgmentPair[] = [];

  for (const event of currentEvents) {
    if (event.type !== 'suggestion_generated' && event.type !== 'generated_hidden') continue;
    if (!event.suggestionId || resolved.has(event.suggestionId) || judgedSuggestions.has(event.suggestionId) || seen.has(event.suggestionId)) continue;
    const suggestion = (event.payload as { suggestion?: Suggestion }).suggestion;
    if (!suggestion) continue;
    seen.add(event.suggestionId);
    const candidates = (suggestion.variants.length
      ? suggestion.variants
      : suggestion.payload.text !== undefined
        ? [{ id: `${suggestion.id}_primary`, text: suggestion.payload.text }]
        : [])
      .filter((candidate) => candidate.text !== suggestion.anchor.text);

    for (const candidate of candidates) {
      const pairId = `pair_${event.suggestionId}_${candidate.id}`;
      if (judgedPairs.has(pairId)) continue;
      pairs.push({
        id: pairId,
        suggestionId: event.suggestionId,
        category: suggestion.category,
        brief,
        left: { id: 'original', text: suggestion.anchor.text },
        right: { id: candidate.id, text: candidate.text }
      });
      if (pairs.length >= limit) return pairs;
    }
  }
  return pairs;
}
