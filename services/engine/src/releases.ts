import type { ReleaseIndex } from '@herald/core';
import type { LoadedConfig } from './config.js';
import { errorFields, type Logger } from './log.js';

/**
 * Proxies the published release feed.
 *
 * The apps could fetch GitHub Pages directly, but going through the engine
 * means the phone talks to exactly one origin, the feed is cached in one place,
 * and a client behind a restrictive network still gets its "What's new".
 */
export class ReleaseFeed {
  private cached: { value: ReleaseIndex; fetchedAt: number } | null = null;

  constructor(
    private readonly config: LoadedConfig,
    private readonly log: Logger,
  ) {}

  async get(): Promise<ReleaseIndex | null> {
    const url = this.config.releases.indexUrl;
    if (!url) return null;

    const ttlMs = this.config.releases.cacheMinutes * 60_000;
    if (this.cached && Date.now() - this.cached.fetchedAt < ttlMs) return this.cached.value;

    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const value = (await res.json()) as ReleaseIndex;
      this.cached = { value, fetchedAt: Date.now() };
      return value;
    } catch (cause) {
      this.log.warn('could not fetch the release feed', { url, ...errorFields(cause) });
      // A stale feed beats none: an updater that goes quiet for an hour is
      // better than one that reports "no updates" when it simply could not ask.
      return this.cached?.value ?? null;
    }
  }
}
