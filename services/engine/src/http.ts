import type { HttpClient } from './sources/types.js';
import type { Logger } from './log.js';

export interface HttpOptions {
  headers?: Record<string, string>;
  /** Requests per minute this client will issue. */
  rateLimitPerMinute?: number;
  timeoutMs?: number;
  retries?: number;
  userAgent?: string;
  log?: Logger;
  signal?: AbortSignal;
}

/**
 * Small HTTP client with per-source rate limiting and retry-with-backoff.
 *
 * Sources are third-party services being read on a schedule, so being a polite
 * client is not optional: every adapter goes through one of these, configured
 * from that source's `rateLimitPerMinute`.
 */
export function createHttpClient(options: HttpOptions = {}): HttpClient {
  const {
    headers = {},
    rateLimitPerMinute = 60,
    timeoutMs = 30_000,
    retries = 3,
    userAgent = 'Herald/1.0 (+https://github.com/amosley0221/herald)',
    log,
    signal,
  } = options;

  const minIntervalMs = 60_000 / Math.max(1, rateLimitPerMinute);
  let nextSlot = 0;

  async function takeSlot(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + minIntervalMs;
    if (wait > 0) await sleep(wait);
  }

  async function send(url: string, init: RequestInit = {}): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      await takeSlot();
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          ...init,
          headers: { 'User-Agent': userAgent, ...headers, ...(init.headers as Record<string, string> | undefined) },
          signal: controller.signal,
        });
        // 429 and 5xx are worth another try; everything else is the answer.
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          const delay = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : backoffMs(attempt);
          if (attempt < retries) {
            log?.debug('http retry', { url, status: res.status, attempt, delay });
            await sleep(delay);
            continue;
          }
        }
        return res;
      } catch (cause) {
        lastError = cause;
        if (signal?.aborted) throw cause;
        if (attempt < retries) {
          await sleep(backoffMs(attempt));
          continue;
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
    throw new Error(`Request failed after ${retries + 1} attempts: ${url}`, { cause: lastError });
  }

  return {
    async json<T>(url: string, init?: RequestInit): Promise<T> {
      const res = await send(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers as Record<string, string> | undefined) } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
      return (await res.json()) as T;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      const res = await send(url, init);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`);
      return res.text();
    },
  };
}

function backoffMs(attempt: number): number {
  // 1s, 2s, 4s … with jitter so parallel sources do not retry in lockstep.
  return Math.round(2 ** attempt * 1000 * (0.75 + Math.random() * 0.5));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
