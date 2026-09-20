import { collapse, contentHash, dedupeKey, fingerprint } from '../pipeline/dedupe.js';
import { prefilter } from '../pipeline/prefilter.js';
import { greenhouseAdapter } from '../sources/greenhouse.js';
import { leverAdapter } from '../sources/lever.js';
import { ashbyAdapter } from '../sources/ashby.js';
import { workdayAdapter } from '../sources/workday.js';
import { jsonAdapter } from '../sources/json.js';
import type {
  Logger, RawPosting, SearchTerms, SourceAdapter, SourceConfig,
} from '../sources/types.js';
import type { Preferences } from '../types.js';
import { createHttpClient, resolveSourceAuth } from './http.js';
import { Llm, LlmAuthError } from './llm.js';
import type { EnginePlatform } from './ports.js';

/**
 * The scan.
 *
 * Ingest every posting published since the last run, collapse duplicates, drop
 * what the preferences rule out, score what survives, and keep the ones worth
 * the user's attention. This is the engine's pipeline running on the phone —
 * the stages and their order are the same, because they are the same code.
 *
 * `command` is the one adapter that cannot come along: it shells out to an
 * external CLI, and a phone has no shell to give it.
 */

const ADAPTERS: Record<string, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workday: workdayAdapter,
  json: jsonAdapter,
};

export interface CrawlCounts {
  read: number;
  kept: number;
  scored: number;
  cached: number;
  matched: number;
  failed: number;
}

export interface CrawlOutcome {
  counts: CrawlCounts;
  /** Matches created by this run, newest first, for the notification to name. */
  created: Array<{ id: string; score: number; title: string; company: string }>;
  skipped?: string;
}

type Candidate = RawPosting & { source: string; sourcePriority: number; dedupeKey: string };

/** A scan already running; a second one would double-spend the API budget. */
const inFlight = new WeakMap<EnginePlatform, Promise<CrawlOutcome>>();

export function crawlInProgress(platform: EnginePlatform): boolean {
  return inFlight.has(platform);
}

export async function runCrawl(platform: EnginePlatform): Promise<CrawlOutcome> {
  const running = inFlight.get(platform);
  if (running) return running;

  const log = platform.log ?? silentLogger();
  const promise = execute(platform, log).finally(() => { inFlight.delete(platform); });
  inFlight.set(platform, promise);
  return promise;
}

async function execute(platform: EnginePlatform, log: Logger): Promise<CrawlOutcome> {
  const db = platform.store;
  const { settings } = platform;
  const empty: CrawlCounts = { read: 0, kept: 0, scored: 0, cached: 0, matched: 0, failed: 0 };

  // Everything that would make the scan pointless is checked before it starts,
  // so a user with no resume gets told that rather than an empty Today screen.
  const stored = await db.getProfile();
  if (!stored?.resumeText) {
    return { counts: empty, created: [], skipped: 'Upload your resume first — there is nothing to score against yet.' };
  }
  const preferences = await db.getPreferences();
  if (!preferences) {
    return { counts: empty, created: [], skipped: 'Preferences are not set up yet.' };
  }
  const apiKey = await settings.getApiKey();
  if (!apiKey) {
    return { counts: empty, created: [], skipped: 'Add your Anthropic API key in Preferences — scanning needs it to score postings.' };
  }
  const sources = (await settings.getSources()).filter((source) => source.enabled && hasTargets(source));
  if (sources.length === 0) {
    return { counts: empty, created: [], skipped: 'No job sources are configured yet. Add one in Preferences.' };
  }

  const llm = new Llm(apiKey, await settings.getModels(), platform.fetch);
  const feedFloor = await settings.getFeedFloor();
  const counts: CrawlCounts = { ...empty };
  const runId = await db.startCrawlRun();
  const controller = new AbortController();

  try {
    const since = await windowStart(platform);
    log.info('scan started', { since: since.toISOString(), sources: sources.length });

    const search = searchTerms(preferences, stored.profile.titles);
    const candidates = await ingest(
      platform, sources, since, preferences, search, counts, controller.signal, log,
    );
    log.info('ingest complete', { read: counts.read, kept: candidates.length });

    const created = await scoreAndStore(
      platform, candidates, stored.resumeText, preferences, llm, feedFloor, counts, log,
    );

    await db.finishCrawlRun(runId, {
      seen: counts.read, kept: counts.kept, scored: counts.scored, matched: counts.matched,
    });
    log.info('scan finished', { ...counts });
    return { counts, created };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    log.error('scan failed', { error: message });
    await db.finishCrawlRun(runId, {
      seen: counts.read, kept: counts.kept, scored: counts.scored, matched: counts.matched,
    }, message);
    // An unusable key is worth surfacing; a board being down is not.
    if (cause instanceof LlmAuthError) throw cause;
    return { counts, created: [] };
  }
}

// ── Ingest ──────────────────────────────────────────────────────────────────

async function ingest(
  platform: EnginePlatform,
  sources: SourceConfig[],
  since: Date,
  preferences: Preferences,
  search: SearchTerms,
  counts: CrawlCounts,
  signal: AbortSignal,
  log: Logger,
): Promise<Candidate[]> {
  const db = platform.store;
  const kept = new Map<string, Candidate>();

  // Sources are read in parallel: one slow Workday tenant should not hold up a
  // Greenhouse board that answers in 200ms.
  await Promise.all(sources.map(async (source) => {
    const sourceLog = child(log, { source: source.id });
    const adapter = ADAPTERS[source.adapter];
    if (!adapter) {
      sourceLog.warn('no adapter on this device for that source; skipping', { adapter: source.adapter });
      return;
    }

    const http = createHttpClient({
      headers: resolveSourceAuth(source),
      rateLimitPerMinute: source.rateLimitPerMinute,
      log: sourceLog,
      signal,
      fetchImpl: platform.fetch,
    });

    try {
      for await (const posting of adapter.fetch(source, { since, search, log: sourceLog, http, signal })) {
        counts.read++;
        const key = dedupeKey(posting);

        // A posting already carrying a match is not news, however many boards
        // it appears on.
        if (await db.dedupeKeySeen(key)) continue;

        const verdict = prefilter(posting, preferences);
        if (!verdict.keep) continue;

        const candidate: Candidate = {
          ...posting, source: source.id, sourcePriority: source.priority, dedupeKey: key,
        };
        const rival = kept.get(key);
        kept.set(key, rival ? collapse([rival, candidate])[0]! : candidate);
      }
    } catch (cause) {
      // One board being down should not cost the whole scan.
      counts.failed++;
      sourceLog.warn('source failed', { error: cause instanceof Error ? cause.message : String(cause) });
    }
  }));

  counts.kept = kept.size;
  return [...kept.values()];
}

// ── Score ───────────────────────────────────────────────────────────────────

async function scoreAndStore(
  platform: EnginePlatform,
  candidates: Candidate[],
  resumeText: string,
  preferences: Preferences,
  llm: Llm,
  feedFloor: number,
  counts: CrawlCounts,
  log: Logger,
): Promise<CrawlOutcome['created']> {
  const db = platform.store;
  const resumeFingerprint = fingerprint(resumeText);
  const created: CrawlOutcome['created'] = [];

  // Sequential, unlike the engine, which scores four at a time. A phone is on a
  // metered radio and a battery, and a scan that finishes a minute later but
  // does not drain the battery is the better trade here.
  for (const candidate of candidates) {
    const hash = contentHash(candidate, resumeFingerprint);

    let result = await db.getCachedScore(hash);
    if (result) {
      counts.cached++;
    } else {
      try {
        const scored = await llm.score(candidate, resumeText, preferences);
        result = { ...scored, payEstimate: null };
        await db.cacheScore(hash, result, 'score');
        counts.scored++;
      } catch (cause) {
        if (cause instanceof LlmAuthError) throw cause;
        counts.failed++;
        log.warn('scoring failed', {
          title: candidate.title,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        continue;
      }
    }

    // Below the floor is not a match at any threshold, so it is never stored.
    if (result.score < feedFloor) continue;

    const { id: postingId } = await db.upsertPosting(candidate);
    const matchId = await db.insertMatch({
      postingId, score: result.score, why: result.why, gaps: result.gaps,
    });
    await db.appendLog(matchId, 'matched', `Scored ${result.score}`);

    counts.matched++;
    created.push({
      id: matchId, score: result.score, title: candidate.title, company: candidate.company,
    });
  }

  created.sort((a, b) => b.score - a.score);
  return created;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * How far back to look.
 *
 * From the end of the last completed scan, with an hour of overlap because
 * boards backdate postings and a posting that appears late should still be
 * seen. A first run takes three days rather than everything ever published.
 */
async function windowStart(platform: EnginePlatform): Promise<Date> {
  const last = await platform.store.lastCrawlAt();
  if (!last) return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  return new Date(last.getTime() - 60 * 60 * 1000);
}

/** True when a source has somewhere to look; an empty board list fetches nothing. */
/**
 * What to ask a searching source for.
 *
 * The roles the user chose come first, because they said them. Falling back to
 * the titles read from the resume means an aggregator still has something to go
 * on for someone who never filled the roles list in -- the alternative is a
 * source that silently returns nothing, which looks identical to a broken one.
 */
function searchTerms(preferences: Preferences, titles: string[]): SearchTerms {
  const queries = preferences.roles.length > 0 ? preferences.roles : titles.slice(0, 3);
  return {
    queries,
    location: preferences.locations[0] ?? '',
    remote: preferences.remote,
  };
}

function hasTargets(source: SourceConfig): boolean {
  const lists = ['boards', 'sites', 'tenants', 'urls'];
  const hasList = lists.some((key) => {
    const value = source.options[key];
    return Array.isArray(value) && value.length > 0;
  });
  return hasList || typeof source.options.url === 'string';
}

function child(log: Logger, bindings: Record<string, unknown>): Logger {
  const merge = (fields?: Record<string, unknown>): Record<string, unknown> => ({ ...bindings, ...fields });
  return {
    error: (message, fields) => log.error(message, merge(fields)),
    warn: (message, fields) => log.warn(message, merge(fields)),
    info: (message, fields) => log.info(message, merge(fields)),
    debug: (message, fields) => log.debug(message, merge(fields)),
  };
}

/** Used when the platform supplies no logger; the scan is not worth crashing over. */
function silentLogger(): Logger {
  const nothing = (): void => {};
  return { error: nothing, warn: nothing, info: nothing, debug: nothing };
}
