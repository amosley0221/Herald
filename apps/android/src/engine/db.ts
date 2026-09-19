import * as SQLite from 'expo-sqlite';
import type {
  Match, Preferences, PreparedApplication, Profile, RawPosting, TodayStats,
} from '@herald/core';
import { randomId } from '@herald/core';

/**
 * On-device storage.
 *
 * The same schema the engine keeps in SQLite, minus the `devices` table, which
 * only exists so a server can push to a phone — a phone doing its own work
 * schedules a local notification instead. Keeping the shapes identical means
 * the pipeline reads and writes the same rows wherever it runs, and a database
 * exported from one could be opened by the other.
 */

const MIGRATIONS: Array<{ id: string; sql: string }> = [
  {
    id: '001-initial',
    sql: `
      CREATE TABLE postings (
        id           TEXT PRIMARY KEY,
        dedupe_key   TEXT NOT NULL,
        title        TEXT NOT NULL,
        company      TEXT NOT NULL,
        location     TEXT NOT NULL DEFAULT '',
        remote       INTEGER NOT NULL DEFAULT 0,
        pay          TEXT,
        pay_min      REAL,
        pay_max      REAL,
        pay_currency TEXT,
        url          TEXT NOT NULL,
        apply_url    TEXT NOT NULL,
        source       TEXT NOT NULL,
        source_priority INTEGER NOT NULL DEFAULT 0,
        posted_at    TEXT NOT NULL,
        ingested_at  TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        raw          TEXT
      );
      CREATE INDEX idx_postings_dedupe ON postings(dedupe_key);
      CREATE INDEX idx_postings_posted ON postings(posted_at DESC);
      CREATE UNIQUE INDEX idx_postings_source_url ON postings(source, url);

      CREATE TABLE matches (
        id                 TEXT PRIMARY KEY,
        posting_id         TEXT NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
        score              INTEGER NOT NULL,
        why                TEXT NOT NULL DEFAULT '[]',
        gaps               TEXT NOT NULL DEFAULT '[]',
        status             TEXT NOT NULL DEFAULT 'pending',
        decided_at         TEXT,
        submitted_at       TEXT,
        confirmation_image TEXT,
        blocked_reason     TEXT,
        notified_at        TEXT,
        digest_sent_at     TEXT,
        created_at         TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_matches_posting ON matches(posting_id);
      CREATE INDEX idx_matches_status ON matches(status);
      CREATE INDEX idx_matches_score ON matches(score DESC);

      CREATE TABLE profile (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        data        TEXT NOT NULL,
        resume_path TEXT,
        resume_text TEXT,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE preferences (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE applications_log (
        id       TEXT PRIMARY KEY,
        match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        at       TEXT NOT NULL,
        action   TEXT NOT NULL,
        detail   TEXT,
        payload  TEXT
      );
      CREATE INDEX idx_log_match ON applications_log(match_id, at DESC);

      CREATE TABLE prepared_applications (
        match_id      TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
        fields        TEXT NOT NULL,
        cover_letter  TEXT,
        degraded      INTEGER NOT NULL DEFAULT 0,
        manual_only   INTEGER NOT NULL DEFAULT 0,
        manual_reason TEXT,
        prepared_at   TEXT NOT NULL
      );

      CREATE TABLE score_cache (
        posting_hash TEXT PRIMARY KEY,
        score        INTEGER NOT NULL,
        why          TEXT NOT NULL,
        gaps         TEXT NOT NULL,
        pay_estimate TEXT,
        model        TEXT NOT NULL,
        created_at   TEXT NOT NULL
      );

      CREATE TABLE crawl_runs (
        id           TEXT PRIMARY KEY,
        started_at   TEXT NOT NULL,
        finished_at  TEXT,
        seen         INTEGER NOT NULL DEFAULT 0,
        kept         INTEGER NOT NULL DEFAULT 0,
        scored       INTEGER NOT NULL DEFAULT 0,
        matched      INTEGER NOT NULL DEFAULT 0,
        error        TEXT
      );
    `,
  },
];

export interface PostingRow {
  id: string; dedupe_key: string; title: string; company: string; location: string;
  remote: number; pay: string | null; pay_min: number | null; pay_max: number | null;
  pay_currency: string | null; url: string; apply_url: string; source: string;
  source_priority: number; posted_at: string; ingested_at: string; description: string;
}

interface MatchRow {
  id: string; posting_id: string; score: number; why: string; gaps: string;
  status: string; decided_at: string | null; submitted_at: string | null;
  confirmation_image: string | null; blocked_reason: string | null; created_at: string;
}

let handle: SQLite.SQLiteDatabase | null = null;

/** Opens the database, applying any migrations it has not seen. */
export async function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return handle;

  const db = await SQLite.openDatabaseAsync('herald.db');
  // Write-ahead logging keeps a background scan from blocking the UI's reads.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await db.execAsync(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);',
  );

  for (const migration of MIGRATIONS) {
    const done = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM schema_migrations WHERE id = ?', migration.id,
    );
    if (done) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
      await db.runAsync(
        'INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)',
        migration.id, new Date().toISOString(),
      );
    });
  }

  handle = db;
  return db;
}

/** Closes and forgets the handle. Only tests need this. */
export async function closeDb(): Promise<void> {
  await handle?.closeAsync();
  handle = null;
}

// ── Postings ────────────────────────────────────────────────────────────────

/**
 * Stores a posting, or returns the id of the one already held for this source
 * and url. Ingest runs repeatedly over overlapping windows, so re-seeing a
 * posting is the normal case rather than an error.
 */
export async function upsertPosting(
  posting: RawPosting & { dedupeKey: string; source: string; sourcePriority: number },
): Promise<{ id: string; isNew: boolean }> {
  const db = await openDb();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM postings WHERE source = ? AND url = ?', posting.source, posting.url,
  );
  if (existing) return { id: existing.id, isNew: false };

  const id = randomId();
  await db.runAsync(
    `INSERT INTO postings (
       id, dedupe_key, title, company, location, remote, pay, pay_min, pay_max,
       pay_currency, url, apply_url, source, source_priority, posted_at,
       ingested_at, description
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, posting.dedupeKey, posting.title, posting.company, posting.location,
    posting.remote ? 1 : 0, posting.pay ?? null, posting.payMin ?? null,
    posting.payMax ?? null, posting.payCurrency ?? null, posting.url,
    posting.applyUrl, posting.source, posting.sourcePriority, posting.postedAt,
    new Date().toISOString(), posting.description,
  );
  return { id, isNew: true };
}

/** True when some posting with this dedupe key already has a match. */
export async function dedupeKeySeen(dedupeKey: string): Promise<boolean> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM matches
       JOIN postings ON postings.id = matches.posting_id
      WHERE postings.dedupe_key = ?`, dedupeKey,
  );
  return (row?.n ?? 0) > 0;
}

export async function getPosting(id: string): Promise<PostingRow | null> {
  const db = await openDb();
  return (await db.getFirstAsync<PostingRow>('SELECT * FROM postings WHERE id = ?', id)) ?? null;
}

// ── Matches ─────────────────────────────────────────────────────────────────

export async function insertMatch(match: {
  postingId: string; score: number; why: string[]; gaps: string[];
}): Promise<string> {
  const db = await openDb();
  const id = randomId();
  await db.runAsync(
    `INSERT INTO matches (id, posting_id, score, why, gaps, status, created_at)
     VALUES (?,?,?,?,?,'pending',?)`,
    id, match.postingId, match.score, JSON.stringify(match.why),
    JSON.stringify(match.gaps), new Date().toISOString(),
  );
  return id;
}

function toMatch(row: MatchRow & PostingRow & { match_id: string }): Match {
  return {
    id: row.match_id,
    postingId: row.id,
    score: row.score,
    why: JSON.parse(row.why) as string[],
    gaps: JSON.parse(row.gaps) as string[],
    status: row.status as Match['status'],
    decidedAt: row.decided_at,
    submittedAt: row.submitted_at,
    confirmationImage: row.confirmation_image,
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    posting: {
      id: row.id,
      dedupeKey: row.dedupe_key,
      ingestedAt: row.ingested_at,
      title: row.title,
      company: row.company,
      location: row.location,
      remote: row.remote === 1,
      pay: row.pay,
      payMin: row.pay_min,
      payMax: row.pay_max,
      payCurrency: row.pay_currency,
      url: row.url,
      applyUrl: row.apply_url,
      source: row.source,
      postedAt: row.posted_at,
      description: row.description,
    },
  };
}

const MATCH_SELECT = `
  SELECT matches.id AS match_id, matches.score, matches.why, matches.gaps,
         matches.status, matches.decided_at, matches.submitted_at,
         matches.confirmation_image, matches.blocked_reason, matches.created_at,
         postings.*
    FROM matches JOIN postings ON postings.id = matches.posting_id`;

export async function listMatches(params: {
  status?: string[]; limit?: number; since?: string;
} = {}): Promise<Match[]> {
  const db = await openDb();
  const where: string[] = [];
  const args: Array<string | number> = [];

  if (params.status?.length) {
    where.push(`matches.status IN (${params.status.map(() => '?').join(',')})`);
    args.push(...params.status);
  }
  if (params.since) {
    where.push('matches.created_at >= ?');
    args.push(params.since);
  }

  const sql = `${MATCH_SELECT}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY matches.score DESC, matches.created_at DESC
    LIMIT ?`;
  args.push(params.limit ?? 100);

  const rows = await db.getAllAsync<MatchRow & PostingRow & { match_id: string }>(sql, ...args);
  return rows.map(toMatch);
}

export async function getMatch(id: string): Promise<Match | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<MatchRow & PostingRow & { match_id: string }>(
    `${MATCH_SELECT} WHERE matches.id = ?`, id,
  );
  return row ? toMatch(row) : null;
}

export async function setMatchStatus(
  id: string,
  status: string,
  extra: { submittedAt?: string; blockedReason?: string | null; confirmationImage?: string | null } = {},
): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `UPDATE matches
        SET status = ?, decided_at = ?, submitted_at = COALESCE(?, submitted_at),
            blocked_reason = ?, confirmation_image = COALESCE(?, confirmation_image)
      WHERE id = ?`,
    status, new Date().toISOString(), extra.submittedAt ?? null,
    extra.blockedReason ?? null, extra.confirmationImage ?? null, id,
  );
}

/** How many applications were actually sent today, for the daily cap. */
export async function submittedToday(): Promise<number> {
  const db = await openDb();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM matches WHERE submitted_at >= ?', midnight.toISOString(),
  );
  return row?.n ?? 0;
}

// ── Single-row tables ───────────────────────────────────────────────────────

export async function getProfile(): Promise<{ profile: Profile; resumeText: string | null } | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ data: string; resume_text: string | null }>(
    'SELECT data, resume_text FROM profile WHERE id = 1',
  );
  return row ? { profile: JSON.parse(row.data) as Profile, resumeText: row.resume_text } : null;
}

export async function setProfile(profile: Profile, resumeText?: string | null): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO profile (id, data, resume_text, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data,
       resume_text = COALESCE(excluded.resume_text, profile.resume_text),
       updated_at = excluded.updated_at`,
    JSON.stringify(profile), resumeText ?? null, new Date().toISOString(),
  );
}

export async function getPreferences(): Promise<Preferences | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ data: string }>('SELECT data FROM preferences WHERE id = 1');
  return row ? (JSON.parse(row.data) as Preferences) : null;
}

export async function setPreferences(preferences: Preferences): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    JSON.stringify(preferences), new Date().toISOString(),
  );
}

// ── Score cache ─────────────────────────────────────────────────────────────

export interface CachedScore {
  score: number; why: string[]; gaps: string[]; payEstimate: string | null;
}

export async function getCachedScore(postingHash: string): Promise<CachedScore | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{
    score: number; why: string; gaps: string; pay_estimate: string | null;
  }>('SELECT score, why, gaps, pay_estimate FROM score_cache WHERE posting_hash = ?', postingHash);
  if (!row) return null;
  return {
    score: row.score,
    why: JSON.parse(row.why) as string[],
    gaps: JSON.parse(row.gaps) as string[],
    payEstimate: row.pay_estimate,
  };
}

export async function cacheScore(
  postingHash: string, score: CachedScore, model: string,
): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO score_cache (posting_hash, score, why, gaps, pay_estimate, model, created_at)
     VALUES (?,?,?,?,?,?,?) ON CONFLICT(posting_hash) DO NOTHING`,
    postingHash, score.score, JSON.stringify(score.why), JSON.stringify(score.gaps),
    score.payEstimate ?? null, model, new Date().toISOString(),
  );
}

// ── Log ─────────────────────────────────────────────────────────────────────

export async function appendLog(
  matchId: string, action: string, detail?: string, payload?: unknown,
): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    'INSERT INTO applications_log (id, match_id, at, action, detail, payload) VALUES (?,?,?,?,?,?)',
    randomId(), matchId, new Date().toISOString(), action, detail ?? null,
    payload === undefined ? null : JSON.stringify(payload),
  );
}

export async function listLog(matchId: string): Promise<Array<{
  at: string; action: string; detail: string | null; payload: unknown;
}>> {
  const db = await openDb();
  const rows = await db.getAllAsync<{
    at: string; action: string; detail: string | null; payload: string | null;
  }>('SELECT at, action, detail, payload FROM applications_log WHERE match_id = ? ORDER BY at DESC', matchId);
  return rows.map((row) => ({
    at: row.at,
    action: row.action,
    detail: row.detail,
    payload: row.payload ? (JSON.parse(row.payload) as unknown) : null,
  }));
}

// ── Crawl runs ──────────────────────────────────────────────────────────────

export async function startCrawlRun(): Promise<string> {
  const db = await openDb();
  const id = randomId();
  await db.runAsync('INSERT INTO crawl_runs (id, started_at) VALUES (?, ?)', id, new Date().toISOString());
  return id;
}

export async function finishCrawlRun(
  id: string, counts: { seen: number; kept: number; scored: number; matched: number }, error?: string,
): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `UPDATE crawl_runs SET finished_at = ?, seen = ?, kept = ?, scored = ?, matched = ?, error = ?
      WHERE id = ?`,
    new Date().toISOString(), counts.seen, counts.kept, counts.scored, counts.matched,
    error ?? null, id,
  );
}

/** When the last scan finished, so the next one only asks for what is newer. */
export async function lastCrawlAt(): Promise<Date | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ finished_at: string }>(
    'SELECT finished_at FROM crawl_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
  );
  return row ? new Date(row.finished_at) : null;
}

// ── Prepared applications ───────────────────────────────────────────────────

export async function getPreparedApplication(matchId: string): Promise<PreparedApplication | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{
    fields: string; cover_letter: string | null; degraded: number;
    manual_only: number; manual_reason: string | null; prepared_at: string;
  }>('SELECT * FROM prepared_applications WHERE match_id = ?', matchId);
  if (!row) return null;

  return {
    matchId,
    fields: JSON.parse(row.fields) as PreparedApplication['fields'],
    coverLetter: row.cover_letter,
    degraded: row.degraded === 1,
    manualOnly: row.manual_only === 1,
    manualReason: row.manual_reason,
    preparedAt: row.prepared_at,
  };
}

export async function savePreparedApplication(prepared: PreparedApplication): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO prepared_applications
       (match_id, fields, cover_letter, degraded, manual_only, manual_reason, prepared_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(match_id) DO UPDATE SET
       fields = excluded.fields, cover_letter = excluded.cover_letter,
       degraded = excluded.degraded, manual_only = excluded.manual_only,
       manual_reason = excluded.manual_reason, prepared_at = excluded.prepared_at`,
    prepared.matchId, JSON.stringify(prepared.fields), prepared.coverLetter,
    prepared.degraded ? 1 : 0, prepared.manualOnly ? 1 : 0, prepared.manualReason,
    prepared.preparedAt,
  );
}

// ── Today ───────────────────────────────────────────────────────────────────

/** The counts behind the Today screen. */
export async function todayStats(): Promise<TodayStats> {
  const db = await openDb();
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const since = midnight.toISOString();

  const matched = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM matches WHERE created_at >= ?', since,
  );
  const applied = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM matches WHERE submitted_at >= ?', since,
  );
  const pending = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM matches WHERE status = 'pending'",
  );
  const lastRun = await db.getFirstAsync<{ finished_at: string; seen: number }>(
    'SELECT finished_at, seen FROM crawl_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
  );
  const readToday = await db.getFirstAsync<{ n: number }>(
    'SELECT COALESCE(SUM(seen), 0) AS n FROM crawl_runs WHERE started_at >= ?', since,
  );

  return {
    read: readToday?.n ?? 0,
    matched: matched?.n ?? 0,
    applied: applied?.n ?? 0,
    pending: pending?.n ?? 0,
    lastCrawlAt: lastRun?.finished_at ?? null,
    lastCrawlRead: lastRun?.seen ?? 0,
  };
}
