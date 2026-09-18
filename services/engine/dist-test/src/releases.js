import { errorFields } from './log.js';
/**
 * Proxies the published release feed.
 *
 * The apps could fetch GitHub Pages directly, but going through the engine
 * means the phone talks to exactly one origin, the feed is cached in one place,
 * and a client behind a restrictive network still gets its "What's new".
 */
export class ReleaseFeed {
    config;
    log;
    cached = null;
    constructor(config, log) {
        this.config = config;
        this.log = log;
    }
    async get() {
        const url = this.config.releases.indexUrl;
        if (!url)
            return null;
        const ttlMs = this.config.releases.cacheMinutes * 60_000;
        if (this.cached && Date.now() - this.cached.fetchedAt < ttlMs)
            return this.cached.value;
        try {
            const res = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!res.ok)
                throw new Error(`${res.status} ${res.statusText}`);
            const value = (await res.json());
            this.cached = { value, fetchedAt: Date.now() };
            return value;
        }
        catch (cause) {
            this.log.warn('could not fetch the release feed', { url, ...errorFields(cause) });
            // A stale feed beats none: an updater that goes quiet for an hour is
            // better than one that reports "no updates" when it simply could not ask.
            return this.cached?.value ?? null;
        }
    }
}
//# sourceMappingURL=releases.js.map