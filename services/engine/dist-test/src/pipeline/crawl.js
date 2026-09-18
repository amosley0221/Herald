import { randomUUID } from 'node:crypto';
import { routesInstantly } from '@herald/core';
import { resolveSourceAuth } from '../config.js';
import { createHttpClient } from '../http.js';
import { errorFields } from '../log.js';
import { getAdapter } from '../sources/index.js';
import { contentHash, dedupeKey, fingerprint } from './dedupe.js';
import { prefilter } from './prefilter.js';
/** Key under which the end of the last successful crawl window is stored. */
const LAST_CRAWL_KEY = 'crawl.lastCompletedAt';
/**
 * One pass of the pipeline: ingest → dedupe → prefilter → score → route.
 *
 * Runs on the schedule in config and on demand from `POST /crawl`. Only one
 * pass runs at a time; a second request while one is in flight is a no-op
 * rather than a queue, since the next tick would redo the same work anyway.
 */
export class Crawler {
    config;
    repo;
    scorer;
    notifier;
    log;
    running = false;
    abortController = null;
    constructor(config, repo, scorer, notifier, log) {
        this.config = config;
        this.repo = repo;
        this.scorer = scorer;
        this.notifier = notifier;
        this.log = log;
    }
    get isRunning() {
        return this.running;
    }
    /** Aborts an in-flight crawl. Used on shutdown. */
    abort() {
        this.abortController?.abort();
    }
    async run() {
        if (this.running) {
            this.log.info('crawl already in progress; skipping this trigger');
            return null;
        }
        const stored = this.repo.getProfile();
        if (!stored?.resumeText) {
            this.log.warn('no resume uploaded yet; nothing to score against');
            return null;
        }
        const preferences = this.repo.getPreferences();
        if (!preferences) {
            this.log.warn('preferences not initialised; skipping crawl');
            return null;
        }
        if (!this.scorer.available) {
            this.log.error('no LLM credentials; crawl would ingest but never score');
            return null;
        }
        this.running = true;
        this.abortController = new AbortController();
        const runId = randomUUID();
        const startedAt = new Date();
        this.repo.startCrawl(runId);
        const counts = { read: 0, ingested: 0, filtered: 0, scored: 0, cached: 0, matched: 0, failed: 0 };
        const log = this.log.child({ runId });
        try {
            const since = this.windowStart();
            log.info('crawl started', { since: since.toISOString(), sources: this.enabledSources().length });
            const candidates = await this.ingest(since, preferences, counts, log);
            log.info('ingest complete', { read: counts.read, kept: candidates.length, filtered: counts.filtered });
            const resumeFingerprint = fingerprint(stored.resumeText);
            const newMatches = await this.scoreAndStore(candidates, stored.resumeText, stored.profile, preferences, resumeFingerprint, counts, log);
            await this.route(newMatches, preferences, log);
            this.repo.set(LAST_CRAWL_KEY, startedAt.toISOString());
            this.repo.finishCrawl(runId, counts);
            log.info('crawl finished', { ...counts });
            return counts;
        }
        catch (cause) {
            log.error('crawl failed', errorFields(cause));
            this.repo.finishCrawl(runId, counts, cause instanceof Error ? cause.message : String(cause));
            return counts;
        }
        finally {
            this.running = false;
            this.abortController = null;
        }
    }
    // ── Stages ───────────────────────────────────────────────────────────────
    async ingest(since, preferences, counts, log) {
        const signal = this.abortController.signal;
        const kept = new Map();
        // Sources are read in parallel: one slow Workday tenant should not hold up
        // a Greenhouse board that answers in 200ms.
        await Promise.all(this.enabledSources().map(async (source) => {
            const sourceLog = log.child({ source: source.id });
            const http = createHttpClient({
                headers: resolveSourceAuth(source),
                rateLimitPerMinute: source.rateLimitPerMinute,
                log: sourceLog,
                signal,
            });
            try {
                const adapter = getAdapter(source.adapter);
                for await (const posting of adapter.fetch(source, { since, log: sourceLog, http, signal })) {
                    if (signal.aborted)
                        return;
                    counts.read++;
                    const verdict = prefilter(posting, preferences, {
                        maxPostingAgeDays: this.config.matching.maxPostingAgeDays,
                    });
                    if (!verdict.keep) {
                        counts.filtered++;
                        sourceLog.trace('filtered', { title: posting.title, reason: verdict.reason });
                        continue;
                    }
                    const key = dedupeKey(posting);
                    const enriched = { ...posting, source: source.id, sourcePriority: source.priority, dedupeKey: key };
                    // Cross-source collapse: the higher-priority source wins, so a
                    // LinkedIn copy loses to the Greenhouse original it was scraped from.
                    const incumbent = kept.get(key);
                    if (incumbent && incumbent.sourcePriority >= enriched.sourcePriority)
                        continue;
                    kept.set(key, enriched);
                }
            }
            catch (cause) {
                // A broken source is a warning, not a failed crawl.
                counts.failed++;
                sourceLog.error('source failed', errorFields(cause));
            }
        }));
        // Drop anything already stored under this dedupe key from an earlier crawl.
        const fresh = [...kept.values()].filter((posting) => {
            const existing = this.repo.findByDedupeKey(posting.dedupeKey);
            return existing.length === 0;
        });
        // Newest first, so a scoring budget cut takes the oldest postings.
        fresh.sort((a, b) => b.postedAt.localeCompare(a.postedAt));
        return fresh;
    }
    async scoreAndStore(candidates, resumeText, profile, preferences, resumeFingerprint, counts, log) {
        const created = [];
        const floor = this.config.matching.feedFloor;
        const store = (posting, result) => {
            // Below the feed floor the posting is stored but never becomes a match,
            // so a later threshold change cannot resurrect something judged unfit.
            if (result.score < floor)
                return;
            const now = new Date().toISOString();
            const postingId = randomUUID();
            const normalized = {
                id: postingId,
                dedupeKey: posting.dedupeKey,
                title: posting.title,
                company: posting.company,
                location: posting.location,
                remote: posting.remote,
                pay: posting.pay,
                payMin: posting.payMin,
                payMax: posting.payMax,
                payCurrency: posting.payCurrency,
                url: posting.url,
                applyUrl: posting.applyUrl,
                source: posting.source,
                postedAt: posting.postedAt,
                ingestedAt: now,
                description: posting.description,
                sourcePriority: posting.sourcePriority,
                raw: posting.raw,
            };
            const { id, created: isNew } = this.repo.upsertPosting(normalized);
            if (!isNew)
                return;
            counts.ingested++;
            const match = {
                id: randomUUID(),
                postingId: id,
                score: result.score,
                why: result.why,
                gaps: result.gaps,
                status: 'pending',
                decidedAt: null,
                submittedAt: null,
                confirmationImage: null,
                blockedReason: null,
                createdAt: now,
            };
            this.repo.createMatch(match);
            counts.matched++;
            created.push({ ...match, posting: { ...normalized } });
        };
        // Serve anything already scored for this resume from cache before spending
        // a single token — the spec's "never re-score" rule.
        const needsScoring = [];
        for (const posting of candidates) {
            const hash = contentHash(posting, resumeFingerprint);
            const cached = this.repo.getCachedScore(hash);
            if (cached) {
                counts.cached++;
                store(posting, cached);
            }
            else {
                needsScoring.push(posting);
            }
        }
        log.info('scoring', { toScore: needsScoring.length, fromCache: counts.cached });
        const { scored, failed } = await this.scorer.scoreAll(needsScoring, resumeText, profile, preferences, (posting, result) => {
            const enriched = posting;
            this.repo.cacheScore(contentHash(posting, resumeFingerprint), this.config.llm.scoreModel, result);
            store(enriched, result);
        });
        counts.scored = scored;
        counts.failed += failed;
        return created;
    }
    /**
     * Instant push for anything at or above the threshold. Everything else is
     * left for the digest job, which runs at the user's configured hour.
     */
    async route(matches, preferences, log) {
        const instant = matches.filter((m) => routesInstantly(m.score, preferences.threshold));
        if (instant.length === 0) {
            log.info('no matches cleared the threshold this crawl', { threshold: preferences.threshold });
            return;
        }
        log.info('pushing instant matches', { count: instant.length });
        // Highest score first, so the best match is the one on top of the stack.
        for (const match of instant.sort((a, b) => b.score - a.score)) {
            try {
                await this.notifier.notifyInstant(match, preferences);
            }
            catch (cause) {
                log.warn('instant push failed', { matchId: match.id, ...errorFields(cause) });
            }
        }
    }
    // ── Helpers ──────────────────────────────────────────────────────────────
    enabledSources() {
        return this.config.sources.filter((source) => source.enabled);
    }
    /**
     * Start of the window this crawl reads. Picks up where the last one finished,
     * with a small overlap so a posting published mid-crawl is not missed.
     */
    windowStart() {
        const last = this.repo.get(LAST_CRAWL_KEY);
        if (!last) {
            return new Date(Date.now() - this.config.matching.initialLookbackHours * 3_600_000);
        }
        const overlapMs = 15 * 60_000;
        return new Date(new Date(last).getTime() - overlapMs);
    }
}
//# sourceMappingURL=crawl.js.map