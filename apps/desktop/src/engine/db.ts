import Database from '@tauri-apps/plugin-sql';
import {
  randomId,
  type CachedScore, type EngineStore, type LogRow, type Match, type Preferences,
  type Profile, type RawPosting, type StoredPreparation, type TodayStats,
} from '@herald/core';

/**
 * Rows, on the desktop.
 *
 * The same schema the engine and the Android app keep, so the three stay
 * comparable and a database from one could be opened by another. SQLite lives
 * in the app's data directory; `sql:` resolves that without this file needing
 * to know where it is on each platform.
 */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS postings (
    id TEXT PRIMARY KEY, dedupe_key TEXT NOT NULL, title TEXT NOT NULL,
    company TEXT NOT NULL, location TEXT NOT NULL DEFAULT '', remote INTEGER NOT NULL DEFAULT 0,
    pay TEXT, pay_min REAL, pay_max REAL, pay_currency TEXT,
    url TEXT NOT NULL, apply_url TEXT NOT NULL, source TEXT NOT NULL,
    source_priority INTEGER NOT NULL DEFAULT 0, posted_at TEXT NOT NULL,
    ingested_at TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', raw TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_postings_dedupe ON postings(dedupe_key);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_postings_source_url ON postings(source, url);

  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    posting_id TEXT NOT NULL REFERENCES postings(id) ON DELETE CASCADE,
    score INTEGER NOT NULL, why TEXT NOT NULL DEFAULT '[]', gaps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending', decided_at TEXT, submitted_at TEXT,
    confirmation_image TEXT, blocked_reason TEXT, notified_at TEXT,
    digest_sent_at TEXT, created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_posting ON matches(posting_id);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

  CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL,
    resume_path TEXT, resume_text TEXT, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS applications_log (
    id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT, payload TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_log_match ON applications_log(match_id, at DESC);

  CREATE TABLE IF NOT EXISTS prepared_applications (
    match_id TEXT PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    fields TEXT NOT NULL, cover_letter TEXT, degraded INTEGER NOT NULL DEFAULT 0,
    manual_only INTEGER NOT NULL DEFAULT 0, manual_reason TEXT, prepared_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS score_cache (
    posting_hash TEXT PRIMARY KEY, score INTEGER NOT NULL, why TEXT NOT NULL,
    gaps TEXT NOT NULL, pay_estimate TEXT, model TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS crawl_runs (
    id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
    seen INTEGER NOT NULL DEFAULT 0, kept INTEGER NOT NULL DEFAULT 0,
    scored INTEGER NOT NULL DEFAULT 0, matched INTEGER NOT NULL DEFAULT 0, error TEXT
  );
`;

let handle: Promise<Database> | null = null;

async function db(): Promise<Database> {
  if (!handle) {
    handle = (async () => {
      const opened = await Database.load('sqlite:herald.db');
      await opened.execute('PRAGMA foreign_keys = ON;');
      for (const statement of SCHEMA.split(';')) {
        const trimmed = statement.trim();
        if (trimmed) await opened.execute(`${trimmed};`);
      }
      return opened;
    })();
  }
  return handle;
}

interface Row { [key: string]: unknown }

function toMatch(row: Row): Match {
  return {
    id: String(row.match_id),
    postingId: String(row.id),
    score: Number(row.score),
    why: JSON.parse(String(row.why)) as string[],
    gaps: JSON.parse(String(row.gaps)) as string[],
    status: String(row.status) as Match['status'],
    decidedAt: (row.decided_at as string | null) ?? null,
    submittedAt: (row.submitted_at as string | null) ?? null,
    confirmationImage: (row.confirmation_image as string | null) ?? null,
    blockedReason: (row.blocked_reason as string | null) ?? null,
    createdAt: String(row.created_at),
    posting: {
      id: String(row.id),
      dedupeKey: String(row.dedupe_key),
      ingestedAt: String(row.ingested_at),
      title: String(row.title),
      company: String(row.company),
      location: String(row.location ?? ''),
      remote: Number(row.remote) === 1,
      pay: (row.pay as string | null) ?? null,
      payMin: (row.pay_min as number | null) ?? null,
      payMax: (row.pay_max as number | null) ?? null,
      payCurrency: (row.pay_currency as string | null) ?? null,
      url: String(row.url),
      applyUrl: String(row.apply_url),
      source: String(row.source),
      postedAt: String(row.posted_at),
      description: String(row.description ?? ''),
    },
  };
}

const MATCH_SELECT = `
  SELECT matches.id AS match_id, matches.score, matches.why, matches.gaps,
         matches.status, matches.decided_at, matches.submitted_at,
         matches.confirmation_image, matches.blocked_reason, matches.created_at,
         postings.*
    FROM matches JOIN postings ON postings.id = matches.posting_id`;

export const store: EngineStore = {
  async upsertPosting(posting) {
    const connection = await db();
    const existing = await connection.select<Row[]>(
      'SELECT id FROM postings WHERE source = $1 AND url = $2', [posting.source, posting.url],
    );
    if (existing.length > 0) return { id: String(existing[0]!.id), isNew: false };

    const id = randomId();
    await connection.execute(
      `INSERT INTO postings (id, dedupe_key, title, company, location, remote, pay,
         pay_min, pay_max, pay_currency, url, apply_url, source, source_priority,
         posted_at, ingested_at, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, posting.dedupeKey, posting.title, posting.company, posting.location,
       posting.remote ? 1 : 0, posting.pay, posting.payMin, posting.payMax,
       posting.payCurrency, posting.url, posting.applyUrl, posting.source,
       posting.sourcePriority, posting.postedAt, new Date().toISOString(), posting.description],
    );
    return { id, isNew: true };
  },

  async dedupeKeySeen(dedupeKey) {
    const rows = await (await db()).select<Row[]>(
      `SELECT COUNT(*) AS n FROM matches
         JOIN postings ON postings.id = matches.posting_id
        WHERE postings.dedupe_key = $1`, [dedupeKey],
    );
    return Number(rows[0]?.n ?? 0) > 0;
  },

  async insertMatch(match) {
    const id = randomId();
    await (await db()).execute(
      `INSERT INTO matches (id, posting_id, score, why, gaps, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'pending',$6)`,
      [id, match.postingId, match.score, JSON.stringify(match.why),
       JSON.stringify(match.gaps), new Date().toISOString()],
    );
    return id;
  },

  async listMatches(params) {
    const where: string[] = [];
    const args: unknown[] = [];
    if (params.status?.length) {
      where.push(`matches.status IN (${params.status.map((_unused, i) => `$${i + 1}`).join(',')})`);
      args.push(...params.status);
    }
    if (params.since) {
      where.push(`matches.created_at >= $${args.length + 1}`);
      args.push(params.since);
    }
    args.push(params.limit ?? 100);

    const rows = await (await db()).select<Row[]>(
      `${MATCH_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY matches.score DESC, matches.created_at DESC LIMIT $${args.length}`, args,
    );
    return rows.map(toMatch);
  },

  async getMatch(id) {
    const rows = await (await db()).select<Row[]>(`${MATCH_SELECT} WHERE matches.id = $1`, [id]);
    return rows[0] ? toMatch(rows[0]) : null;
  },

  async setMatchStatus(id, status, extra = {}) {
    await (await db()).execute(
      `UPDATE matches SET status = $1, decided_at = $2,
         submitted_at = COALESCE($3, submitted_at), blocked_reason = $4,
         confirmation_image = COALESCE($5, confirmation_image)
       WHERE id = $6`,
      [status, new Date().toISOString(), extra.submittedAt ?? null,
       extra.blockedReason ?? null, extra.confirmationImage ?? null, id],
    );
  },

  async submittedToday() {
    const rows = await (await db()).select<Row[]>(
      'SELECT COUNT(*) AS n FROM matches WHERE submitted_at >= $1', [midnight()],
    );
    return Number(rows[0]?.n ?? 0);
  },

  async getProfile() {
    const rows = await (await db()).select<Row[]>('SELECT data, resume_text FROM profile WHERE id = 1');
    if (!rows[0]) return null;
    return {
      profile: JSON.parse(String(rows[0].data)) as Profile,
      resumeText: (rows[0].resume_text as string | null) ?? null,
    };
  },

  async setProfile(profile: Profile, resumeText) {
    await (await db()).execute(
      `INSERT INTO profile (id, data, resume_text, updated_at) VALUES (1,$1,$2,$3)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data,
         resume_text = COALESCE(excluded.resume_text, profile.resume_text),
         updated_at = excluded.updated_at`,
      [JSON.stringify(profile), resumeText ?? null, new Date().toISOString()],
    );
  },

  async getPreferences() {
    const rows = await (await db()).select<Row[]>('SELECT data FROM preferences WHERE id = 1');
    return rows[0] ? (JSON.parse(String(rows[0].data)) as Preferences) : null;
  },

  async setPreferences(preferences: Preferences) {
    await (await db()).execute(
      `INSERT INTO preferences (id, data, updated_at) VALUES (1,$1,$2)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      [JSON.stringify(preferences), new Date().toISOString()],
    );
  },

  async getCachedScore(postingHash) {
    const rows = await (await db()).select<Row[]>(
      'SELECT score, why, gaps, pay_estimate FROM score_cache WHERE posting_hash = $1', [postingHash],
    );
    if (!rows[0]) return null;
    return {
      score: Number(rows[0].score),
      why: JSON.parse(String(rows[0].why)) as string[],
      gaps: JSON.parse(String(rows[0].gaps)) as string[],
      payEstimate: (rows[0].pay_estimate as string | null) ?? null,
    };
  },

  async cacheScore(postingHash, score: CachedScore, model) {
    await (await db()).execute(
      `INSERT INTO score_cache (posting_hash, score, why, gaps, pay_estimate, model, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(posting_hash) DO NOTHING`,
      [postingHash, score.score, JSON.stringify(score.why), JSON.stringify(score.gaps),
       score.payEstimate, model, new Date().toISOString()],
    );
  },

  async getPreparedApplication(matchId) {
    const rows = await (await db()).select<Row[]>(
      'SELECT * FROM prepared_applications WHERE match_id = $1', [matchId],
    );
    if (!rows[0]) return null;
    return {
      matchId,
      fields: JSON.parse(String(rows[0].fields)) as StoredPreparation['fields'],
      coverLetter: (rows[0].cover_letter as string | null) ?? null,
      degraded: Number(rows[0].degraded) === 1,
      manualOnly: Number(rows[0].manual_only) === 1,
      manualReason: (rows[0].manual_reason as string | null) ?? null,
      preparedAt: String(rows[0].prepared_at),
    };
  },

  async savePreparedApplication(prepared: StoredPreparation) {
    await (await db()).execute(
      `INSERT INTO prepared_applications
         (match_id, fields, cover_letter, degraded, manual_only, manual_reason, prepared_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(match_id) DO UPDATE SET fields = excluded.fields,
         cover_letter = excluded.cover_letter, degraded = excluded.degraded,
         manual_only = excluded.manual_only, manual_reason = excluded.manual_reason,
         prepared_at = excluded.prepared_at`,
      [prepared.matchId, JSON.stringify(prepared.fields), prepared.coverLetter,
       prepared.degraded ? 1 : 0, prepared.manualOnly ? 1 : 0, prepared.manualReason,
       prepared.preparedAt],
    );
  },

  async appendLog(matchId, action, detail, payload) {
    await (await db()).execute(
      'INSERT INTO applications_log (id, match_id, at, action, detail, payload) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomId(), matchId, new Date().toISOString(), action, detail ?? null,
       payload === undefined ? null : JSON.stringify(payload)],
    );
  },

  async listLog(matchId): Promise<LogRow[]> {
    const rows = await (await db()).select<Row[]>(
      'SELECT at, action, detail, payload FROM applications_log WHERE match_id = $1 ORDER BY at DESC',
      [matchId],
    );
    return rows.map((row) => ({
      at: String(row.at),
      action: String(row.action),
      detail: (row.detail as string | null) ?? null,
      payload: row.payload ? (JSON.parse(String(row.payload)) as unknown) : null,
    }));
  },

  async startCrawlRun() {
    const id = randomId();
    await (await db()).execute(
      'INSERT INTO crawl_runs (id, started_at) VALUES ($1,$2)', [id, new Date().toISOString()],
    );
    return id;
  },

  async finishCrawlRun(id, counts, error) {
    await (await db()).execute(
      `UPDATE crawl_runs SET finished_at = $1, seen = $2, kept = $3, scored = $4,
         matched = $5, error = $6 WHERE id = $7`,
      [new Date().toISOString(), counts.seen, counts.kept, counts.scored,
       counts.matched, error ?? null, id],
    );
  },

  async lastCrawlAt() {
    const rows = await (await db()).select<Row[]>(
      'SELECT finished_at FROM crawl_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
    );
    return rows[0] ? new Date(String(rows[0].finished_at)) : null;
  },

  async todayStats(): Promise<TodayStats> {
    const connection = await db();
    const since = midnight();
    const one = async (sql: string, args: unknown[] = []): Promise<number> => {
      const rows = await connection.select<Row[]>(sql, args);
      return Number(rows[0]?.n ?? 0);
    };

    const lastRun = await connection.select<Row[]>(
      'SELECT finished_at, seen FROM crawl_runs WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
    );

    return {
      read: await one('SELECT COALESCE(SUM(seen), 0) AS n FROM crawl_runs WHERE started_at >= $1', [since]),
      matched: await one('SELECT COUNT(*) AS n FROM matches WHERE created_at >= $1', [since]),
      applied: await one('SELECT COUNT(*) AS n FROM matches WHERE submitted_at >= $1', [since]),
      pending: await one("SELECT COUNT(*) AS n FROM matches WHERE status = 'pending'"),
      lastCrawlAt: lastRun[0] ? String(lastRun[0].finished_at) : null,
      lastCrawlRead: Number(lastRun[0]?.seen ?? 0),
    };
  },
};

function midnight(): string {
  const at = new Date();
  at.setHours(0, 0, 0, 0);
  return at.toISOString();
}
