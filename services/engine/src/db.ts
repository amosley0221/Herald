import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ApplicationLogEntry,
  Match,
  MatchStatus,
  Posting,
  Preferences,
  Profile,
} from '@herald/core';

export type DB = Database.Database;

/**
 * Schema migrations, applied in order and recorded in `schema_migrations`.
 * Append new statements; never edit one that has shipped.
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

      -- Single-row tables. The id column keeps them that way.
      CREATE TABLE profile (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        data               TEXT NOT NULL,
        resume_path        TEXT,
        resume_text        TEXT,
        updated_at         TEXT NOT NULL
      );

      CREATE TABLE preferences (
        id         INTEGER PRIMARY KEY CHECK (id = 1),
        data       TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE devices (
        token       TEXT PRIMARY KEY,
        platform    TEXT NOT NULL,
        app_version TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL
      );

      CREATE TABLE applications_log (
        id        TEXT PRIMARY KEY,
        match_id  TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
        at        TEXT NOT NULL,
        action    TEXT NOT NULL,
        detail    TEXT,
        payload   TEXT
      );
      CREATE INDEX idx_log_match ON applications_log(match_id, at DESC);

      CREATE TABLE prepared_applications (
        match_id     TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
        fields       TEXT NOT NULL,
        cover_letter TEXT,
        degraded     INTEGER NOT NULL DEFAULT 0,
        manual_only  INTEGER NOT NULL DEFAULT 0,
        manual_reason TEXT,
        prepared_at  TEXT NOT NULL
      );

      -- Scores are expensive; never compute one twice for the same posting.
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
        id          TEXT PRIMARY KEY,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        read        INTEGER NOT NULL DEFAULT 0,
        ingested    INTEGER NOT NULL DEFAULT 0,
        scored      INTEGER NOT NULL DEFAULT 0,
        matched     INTEGER NOT NULL DEFAULT 0,
        error       TEXT
      );
      CREATE INDEX idx_crawl_started ON crawl_runs(started_at DESC);

      CREATE TABLE kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
];

export function openDatabase(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: string }).id),
  );
  const record = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.id, new Date().toISOString());
    })();
  }
}

// ── Row mapping ────────────────────────────────────────────────────────────

interface PostingRow {
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

export function rowToPosting(row: PostingRow): Posting {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
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
    ingestedAt: row.ingested_at,
    description: row.description,
  };
}

export function rowToMatch(row: MatchRow & PostingRow extends never ? never : Record<string, unknown>): Match {
  const r = row as unknown as MatchRow & { posting: PostingRow };
  return {
    id: r.id,
    postingId: r.posting_id,
    score: r.score,
    why: JSON.parse(r.why) as string[],
    gaps: JSON.parse(r.gaps) as string[],
    status: r.status as MatchStatus,
    decidedAt: r.decided_at,
    submittedAt: r.submitted_at,
    confirmationImage: r.confirmation_image,
    blockedReason: r.blocked_reason,
    createdAt: r.created_at,
    posting: rowToPosting(r.posting),
  };
}

/** Joined select used everywhere a Match is returned, so shapes never drift. */
const MATCH_SELECT = `
  SELECT m.*,
         p.id AS p_id, p.dedupe_key AS p_dedupe_key, p.title AS p_title,
         p.company AS p_company, p.location AS p_location, p.remote AS p_remote,
         p.pay AS p_pay, p.pay_min AS p_pay_min, p.pay_max AS p_pay_max,
         p.pay_currency AS p_pay_currency, p.url AS p_url, p.apply_url AS p_apply_url,
         p.source AS p_source, p.source_priority AS p_source_priority,
         p.posted_at AS p_posted_at, p.ingested_at AS p_ingested_at,
         p.description AS p_description
  FROM matches m
  JOIN postings p ON p.id = m.posting_id
`;

function joinedRowToMatch(row: Record<string, unknown>): Match {
  const posting: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('p_')) posting[key.slice(2)] = value;
  }
  return rowToMatch({ ...row, posting } as Record<string, unknown>);
}

// ── Repository ─────────────────────────────────────────────────────────────

export class Repository {
  constructor(private readonly db: DB) {}

  get raw(): DB {
    return this.db;
  }

  // Postings -----------------------------------------------------------------

  /** Inserts a posting, or returns the existing id when the URL is already known. */
  upsertPosting(posting: Posting & { sourcePriority: number; raw?: unknown }): { id: string; created: boolean } {
    const existing = this.db
      .prepare('SELECT id FROM postings WHERE source = ? AND url = ?')
      .get(posting.source, posting.url) as { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };

    this.db.prepare(`
      INSERT INTO postings (id, dedupe_key, title, company, location, remote, pay, pay_min,
                            pay_max, pay_currency, url, apply_url, source, source_priority,
                            posted_at, ingested_at, description, raw)
      VALUES (@id, @dedupeKey, @title, @company, @location, @remote, @pay, @payMin,
              @payMax, @payCurrency, @url, @applyUrl, @source, @sourcePriority,
              @postedAt, @ingestedAt, @description, @raw)
    `).run({
      ...posting,
      remote: posting.remote ? 1 : 0,
      raw: posting.raw ? JSON.stringify(posting.raw) : null,
    });
    return { id: posting.id, created: true };
  }

  /** Any posting already stored under the same dedupe key, cross-source. */
  findByDedupeKey(dedupeKey: string): Array<{ id: string; source: string; sourcePriority: number }> {
    return this.db
      .prepare('SELECT id, source, source_priority AS sourcePriority FROM postings WHERE dedupe_key = ?')
      .all(dedupeKey) as Array<{ id: string; source: string; sourcePriority: number }>;
  }

  getPosting(id: string): Posting | null {
    const row = this.db.prepare('SELECT * FROM postings WHERE id = ?').get(id) as PostingRow | undefined;
    return row ? rowToPosting(row) : null;
  }

  // Matches ------------------------------------------------------------------

  createMatch(match: Omit<Match, 'posting'>): void {
    this.db.prepare(`
      INSERT INTO matches (id, posting_id, score, why, gaps, status, decided_at,
                           submitted_at, confirmation_image, blocked_reason, created_at)
      VALUES (@id, @postingId, @score, @why, @gaps, @status, @decidedAt,
              @submittedAt, @confirmationImage, @blockedReason, @createdAt)
      ON CONFLICT(posting_id) DO NOTHING
    `).run({
      ...match,
      why: JSON.stringify(match.why),
      gaps: JSON.stringify(match.gaps),
    });
  }

  getMatch(id: string): Match | null {
    const row = this.db.prepare(`${MATCH_SELECT} WHERE m.id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? joinedRowToMatch(row) : null;
  }

  listMatches(opts: { status?: MatchStatus[]; minScore?: number; limit?: number; since?: string } = {}): Match[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.status?.length) {
      where.push(`m.status IN (${opts.status.map(() => '?').join(',')})`);
      params.push(...opts.status);
    }
    if (opts.minScore != null) {
      where.push('m.score >= ?');
      params.push(opts.minScore);
    }
    if (opts.since) {
      where.push('m.created_at >= ?');
      params.push(opts.since);
    }
    const sql = `${MATCH_SELECT}
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.score DESC, m.created_at DESC
      ${opts.limit != null ? 'LIMIT ?' : ''}`;
    if (opts.limit != null) params.push(opts.limit);
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(joinedRowToMatch);
  }

  updateMatchStatus(
    id: string,
    status: MatchStatus,
    extra: { decidedAt?: string; submittedAt?: string; confirmationImage?: string; blockedReason?: string | null } = {},
  ): void {
    const sets = ['status = ?'];
    const params: unknown[] = [status];
    for (const [column, value] of [
      ['decided_at', extra.decidedAt],
      ['submitted_at', extra.submittedAt],
      ['confirmation_image', extra.confirmationImage],
    ] as const) {
      if (value !== undefined) { sets.push(`${column} = ?`); params.push(value); }
    }
    if (extra.blockedReason !== undefined) { sets.push('blocked_reason = ?'); params.push(extra.blockedReason); }
    params.push(id);
    this.db.prepare(`UPDATE matches SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  markNotified(id: string, kind: 'instant' | 'digest'): void {
    const column = kind === 'instant' ? 'notified_at' : 'digest_sent_at';
    this.db.prepare(`UPDATE matches SET ${column} = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  /** Pending matches below the threshold that have not been in a digest yet. */
  pendingForDigest(threshold: number, feedFloor: number): Match[] {
    const rows = this.db.prepare(`${MATCH_SELECT}
      WHERE m.status = 'pending' AND m.score < ? AND m.score >= ? AND m.digest_sent_at IS NULL
      ORDER BY m.score DESC`).all(threshold, feedFloor) as Array<Record<string, unknown>>;
    return rows.map(joinedRowToMatch);
  }

  /** Submissions made since the start of the given ISO day boundary. */
  submissionsSince(sinceIso: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM matches WHERE submitted_at IS NOT NULL AND submitted_at >= ?")
      .get(sinceIso) as { n: number };
    return row.n;
  }

  // Prepared applications ----------------------------------------------------

  savePrepared(matchId: string, prepared: {
    fields: unknown; coverLetter: string | null; degraded: boolean;
    manualOnly: boolean; manualReason: string | null; preparedAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO prepared_applications (match_id, fields, cover_letter, degraded, manual_only, manual_reason, prepared_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id) DO UPDATE SET
        fields = excluded.fields, cover_letter = excluded.cover_letter,
        degraded = excluded.degraded, manual_only = excluded.manual_only,
        manual_reason = excluded.manual_reason, prepared_at = excluded.prepared_at
    `).run(
      matchId, JSON.stringify(prepared.fields), prepared.coverLetter,
      prepared.degraded ? 1 : 0, prepared.manualOnly ? 1 : 0, prepared.manualReason, prepared.preparedAt,
    );
  }

  getPrepared(matchId: string): {
    fields: unknown; coverLetter: string | null; degraded: boolean;
    manualOnly: boolean; manualReason: string | null; preparedAt: string;
  } | null {
    const row = this.db.prepare('SELECT * FROM prepared_applications WHERE match_id = ?').get(matchId) as
      | { fields: string; cover_letter: string | null; degraded: number; manual_only: number; manual_reason: string | null; prepared_at: string }
      | undefined;
    if (!row) return null;
    return {
      fields: JSON.parse(row.fields),
      coverLetter: row.cover_letter,
      degraded: row.degraded === 1,
      manualOnly: row.manual_only === 1,
      manualReason: row.manual_reason,
      preparedAt: row.prepared_at,
    };
  }

  // Profile & preferences ----------------------------------------------------

  getProfile(): { profile: Profile; resumePath: string | null; resumeText: string | null } | null {
    const row = this.db.prepare('SELECT * FROM profile WHERE id = 1').get() as
      | { data: string; resume_path: string | null; resume_text: string | null }
      | undefined;
    if (!row) return null;
    return {
      profile: JSON.parse(row.data) as Profile,
      resumePath: row.resume_path,
      resumeText: row.resume_text,
    };
  }

  saveProfile(profile: Profile, resumePath?: string | null, resumeText?: string | null): void {
    const existing = this.getProfile();
    this.db.prepare(`
      INSERT INTO profile (id, data, resume_path, resume_text, updated_at)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data,
        resume_path = excluded.resume_path, resume_text = excluded.resume_text,
        updated_at = excluded.updated_at
    `).run(
      JSON.stringify(profile),
      resumePath !== undefined ? resumePath : existing?.resumePath ?? null,
      resumeText !== undefined ? resumeText : existing?.resumeText ?? null,
      new Date().toISOString(),
    );
  }

  getPreferences(): Preferences | null {
    const row = this.db.prepare('SELECT data FROM preferences WHERE id = 1').get() as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Preferences) : null;
  }

  savePreferences(preferences: Preferences): void {
    this.db.prepare(`
      INSERT INTO preferences (id, data, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(JSON.stringify(preferences), new Date().toISOString());
  }

  // Devices ------------------------------------------------------------------

  registerDevice(token: string, platform: string, appVersion: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO devices (token, platform, app_version, registered_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token) DO UPDATE SET app_version = excluded.app_version, last_seen_at = excluded.last_seen_at
    `).run(token, platform, appVersion, now, now);
  }

  removeDevice(token: string): void {
    this.db.prepare('DELETE FROM devices WHERE token = ?').run(token);
  }

  listDevices(): Array<{ token: string; platform: string; appVersion: string }> {
    return this.db
      .prepare('SELECT token, platform, app_version AS appVersion FROM devices')
      .all() as Array<{ token: string; platform: string; appVersion: string }>;
  }

  // Score cache --------------------------------------------------------------

  getCachedScore(hash: string): { score: number; why: string[]; gaps: string[]; payEstimate: string | null } | null {
    const row = this.db.prepare('SELECT * FROM score_cache WHERE posting_hash = ?').get(hash) as
      | { score: number; why: string; gaps: string; pay_estimate: string | null }
      | undefined;
    if (!row) return null;
    return {
      score: row.score,
      why: JSON.parse(row.why) as string[],
      gaps: JSON.parse(row.gaps) as string[],
      payEstimate: row.pay_estimate,
    };
  }

  cacheScore(hash: string, model: string, result: { score: number; why: string[]; gaps: string[]; payEstimate?: string | null }): void {
    this.db.prepare(`
      INSERT INTO score_cache (posting_hash, score, why, gaps, pay_estimate, model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(posting_hash) DO NOTHING
    `).run(hash, result.score, JSON.stringify(result.why), JSON.stringify(result.gaps),
      result.payEstimate ?? null, model, new Date().toISOString());
  }

  // Log ----------------------------------------------------------------------

  appendLog(entry: Omit<ApplicationLogEntry, 'id'> & { id?: string }): void {
    this.db.prepare(`
      INSERT INTO applications_log (id, match_id, at, action, detail, payload)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      entry.id ?? crypto.randomUUID(), entry.matchId, entry.at, entry.action,
      entry.detail, entry.payload ? JSON.stringify(entry.payload) : null,
    );
  }

  listLog(matchId: string): ApplicationLogEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM applications_log WHERE match_id = ? ORDER BY at DESC')
      .all(matchId) as Array<{ id: string; match_id: string; at: string; action: string; detail: string | null; payload: string | null }>;
    return rows.map((r) => ({
      id: r.id,
      matchId: r.match_id,
      at: r.at,
      action: r.action as ApplicationLogEntry['action'],
      detail: r.detail,
      payload: r.payload ? (JSON.parse(r.payload) as Record<string, string>) : null,
    }));
  }

  // Crawl runs ---------------------------------------------------------------

  startCrawl(id: string): void {
    this.db.prepare('INSERT INTO crawl_runs (id, started_at) VALUES (?, ?)').run(id, new Date().toISOString());
  }

  finishCrawl(id: string, counts: { read: number; ingested: number; scored: number; matched: number }, error?: string): void {
    this.db.prepare(`
      UPDATE crawl_runs SET finished_at = ?, read = ?, ingested = ?, scored = ?, matched = ?, error = ?
      WHERE id = ?
    `).run(new Date().toISOString(), counts.read, counts.ingested, counts.scored, counts.matched, error ?? null, id);
  }

  lastCrawl(): { startedAt: string; finishedAt: string | null; read: number; matched: number } | null {
    const row = this.db.prepare(`
      SELECT started_at AS startedAt, finished_at AS finishedAt, read, matched
      FROM crawl_runs WHERE finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1
    `).get() as { startedAt: string; finishedAt: string | null; read: number; matched: number } | undefined;
    return row ?? null;
  }

  /** Total postings read across crawls that started at or after `sinceIso`. */
  readSince(sinceIso: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(read), 0) AS n FROM crawl_runs WHERE started_at >= ?')
      .get(sinceIso) as { n: number };
    return row.n;
  }

  // Key/value ----------------------------------------------------------------

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}
