import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Branch, LedgerEvent, WritingBrief, TaskPrompt, Suggestion, JudgmentPair } from '$lib/domain';

const databasePath = process.env.LEDGER_PATH ?? resolve('data/writing-ledger.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });

const database = new Database(databasePath);
database.pragma('journal_mode = WAL');
database.pragma('foreign_keys = ON');
database.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    branch_id TEXT NOT NULL,
    suggestion_id TEXT,
    payload TEXT NOT NULL CHECK(json_valid(payload))
  );
  CREATE INDEX IF NOT EXISTS events_type_idx ON events(type, id DESC);
  CREATE INDEX IF NOT EXISTS events_branch_idx ON events(branch_id, id DESC);
  CREATE INDEX IF NOT EXISTS events_suggestion_idx ON events(suggestion_id, id DESC);
`);

interface EventRow {
  id: number;
  timestamp: string;
  type: LedgerEvent['type'];
  session_id: string;
  branch_id: string;
  suggestion_id: string | null;
  payload: string;
}

function hydrate(row: EventRow): Required<LedgerEvent> {
  return {
    id: row.id,
    timestamp: row.timestamp,
    type: row.type,
    sessionId: row.session_id,
    branchId: row.branch_id,
    suggestionId: row.suggestion_id ?? '',
    payload: JSON.parse(row.payload) as Record<string, unknown>
  };
}

export function appendEvent<T>(event: LedgerEvent<T>): Required<LedgerEvent<T>> {
  const result = database.prepare(`
    INSERT INTO events (type, session_id, branch_id, suggestion_id, payload)
    VALUES (@type, @sessionId, @branchId, @suggestionId, json(@payload))
  `).run({
    type: event.type,
    sessionId: event.sessionId,
    branchId: event.branchId,
    suggestionId: event.suggestionId ?? null,
    payload: JSON.stringify(event.payload ?? {})
  });
  return hydrate(database.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid) as EventRow) as Required<LedgerEvent<T>>;
}

export function appendEvents(events: LedgerEvent[]): Required<LedgerEvent>[] {
  return database.transaction((items: LedgerEvent[]) => items.map((event) => appendEvent(event)))(events);
}

export function tailEvents(limit = 40, branchId?: string): Required<LedgerEvent>[] {
  const safeLimit = Math.max(1, Math.min(limit, 250));
  const rows = branchId
    ? database.prepare('SELECT * FROM events WHERE branch_id = ? ORDER BY id DESC LIMIT ?').all(branchId, safeLimit)
    : database.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(safeLimit);
  return (rows as EventRow[]).map(hydrate);
}

function latestPayload<T>(type: LedgerEvent['type']): T | null {
  const row = database.prepare('SELECT payload FROM events WHERE type = ? ORDER BY id DESC LIMIT 1').get(type) as { payload: string } | undefined;
  return row ? (JSON.parse(row.payload) as T) : null;
}

export function getBrief(): WritingBrief {
  return latestPayload<WritingBrief>('brief_updated') ?? {
    version: 1,
    form: 'fiction',
    pov: 'close third person',
    tense: 'past',
    distance: 'close, embodied, minimal narrator intrusion',
    canon: ''
  };
}

export function getPrompts(): TaskPrompt[] {
  const rows = database.prepare(`
    SELECT e.payload FROM events e
    INNER JOIN (
      SELECT json_extract(payload, '$.id') prompt_id, MAX(id) max_id
      FROM events WHERE type = 'prompt_updated' GROUP BY prompt_id
    ) latest ON latest.max_id = e.id
    ORDER BY e.id
  `).all() as { payload: string }[];
  if (rows.length) return rows.map((row) => JSON.parse(row.payload) as TaskPrompt);
  return [
    { id: 'sentinel', name: 'Craft sentinel', version: 1, instruction: 'Flag POV, tense, canon, cadence, diction, and distance issues. Prefer precise observations over rewrites.' },
    { id: 'heighten', name: 'Heighten', version: 1, instruction: 'Heighten the selected passage without adding unsupported facts.' },
    { id: 'cadence', name: 'Vary cadence', version: 1, instruction: 'Offer alternatives with more varied sentence rhythm.' }
  ];
}

export function getBranches(): Branch[] {
  const forkRows = database.prepare("SELECT branch_id, payload, timestamp FROM events WHERE type = 'branch_forked' ORDER BY id").all() as Pick<EventRow, 'branch_id' | 'payload' | 'timestamp'>[];
  const seen = new Map<string, Branch>();
  seen.set('main', { id: 'main', name: 'Main draft', createdAt: forkRows[0]?.timestamp ?? new Date().toISOString(), wordCount: 0, lastEdited: new Date().toISOString() });
  for (const row of forkRows) {
    const payload = JSON.parse(row.payload) as Partial<Branch> & { parentId?: string };
    seen.set(row.branch_id, {
      id: row.branch_id,
      name: payload.name ?? 'Untitled branch',
      parentId: payload.parentId,
      createdAt: row.timestamp,
      wordCount: payload.wordCount ?? 0,
      lastEdited: row.timestamp
    });
  }
  const editRows = database.prepare("SELECT branch_id, payload, timestamp FROM events WHERE type = 'human_edit_session' ORDER BY id").all() as Pick<EventRow, 'branch_id' | 'payload' | 'timestamp'>[];
  for (const row of editRows) {
    const branch = seen.get(row.branch_id);
    if (branch) {
      const payload = JSON.parse(row.payload) as { wordCount?: number };
      branch.wordCount = payload.wordCount ?? branch.wordCount;
      branch.lastEdited = row.timestamp;
    }
  }
  return [...seen.values()];
}

export function reviewPairs(): JudgmentPair[] {
  const generated = database.prepare("SELECT suggestion_id, payload FROM events WHERE type IN ('suggestion_generated', 'generated_hidden') ORDER BY id DESC").all() as Pick<EventRow, 'suggestion_id' | 'payload'>[];
  const pairs: JudgmentPair[] = [];
  for (const row of generated) {
    const suggestion = (JSON.parse(row.payload) as { suggestion?: Suggestion }).suggestion;
    if (!suggestion || !row.suggestion_id) continue;
    const candidates = suggestion.variants.length ? suggestion.variants : suggestion.payload.text ? [{ id: `${suggestion.id}_primary`, text: suggestion.payload.text }] : [];
    if (!candidates.length) continue;
    pairs.push({
      id: `pair_${row.suggestion_id}`,
      suggestionId: row.suggestion_id,
      category: suggestion.category,
      brief: getBrief(),
      left: { id: 'original', text: suggestion.anchor.text },
      right: { id: candidates[0].id, text: candidates[0].text }
    });
  }
  return pairs.slice(0, 50);
}

export function ledgerStats() {
  const events = (database.prepare('SELECT COUNT(*) total FROM events').get() as { total: number }).total;
  const cost = database.prepare(`
    SELECT COALESCE(SUM(CAST(json_extract(payload, '$.suggestion.provenance.costUsd') AS REAL)), 0) cost
    FROM events WHERE type IN ('suggestion_generated', 'generated_hidden')
  `).get() as { cost: number };
  return { events, costUsd: cost.cost };
}
