import type { HttpClient, Logger, SourceConfig } from '@herald/core';

/**
 * The HTTP client the adapters are given.
 *
 * Same contract the engine satisfies, so the adapters cannot tell which one
 * they have. Two things matter more on a phone than on a server: a job board
 * must not be hammered from a mobile IP, and a stalled request must not keep
 * the radio awake, so every request is both rate-limited and timed out.
 */
export function createHttpClient(options: {
  headers?: Record<string, string>;
  rateLimitPerMinute?: number;
  timeoutMs?: number;
  log: Logger;
  signal: AbortSignal;
}): HttpClient {
  const minIntervalMs = 60_000 / Math.max(1, options.rateLimitPerMinute ?? 60);
  const timeoutMs = options.timeoutMs ?? 30_000;
  let nextAllowedAt = 0;

  async function request(url: string, init?: RequestInit): Promise<Response> {
    const wait = Math.max(0, nextAllowedAt - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    nextAllowedAt = Date.now() + minIntervalMs;

    // The caller's signal aborts the whole crawl; this one only this request.
    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(), timeoutMs);
    const onAbort = (): void => timer.abort();
    options.signal.addEventListener('abort', onAbort);

    try {
      const response = await fetch(url, {
        ...init,
        signal: timer.signal,
        headers: { Accept: 'application/json', ...options.headers, ...(init?.headers ?? {}) },
      });
      if (!response.ok) {
        throw new Error(`${init?.method ?? 'GET'} ${url} returned ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timeout);
      options.signal.removeEventListener('abort', onAbort);
    }
  }

  return {
    async json<T>(url: string, init?: RequestInit): Promise<T> {
      return (await request(url, init)).json() as Promise<T>;
    },
    async text(url: string, init?: RequestInit): Promise<string> {
      return (await request(url, init)).text();
    },
  };
}

/**
 * Credentials for a source.
 *
 * The engine reads these from environment variables so tokens never sit in its
 * config file. A phone has no environment, so a source that needs a token
 * carries it in `options.token` and the user types it into the Sources screen;
 * `auth.tokenEnv` is ignored here rather than silently sending nothing.
 */
export function resolveSourceAuth(source: SourceConfig): Record<string, string> {
  const token = typeof source.options.token === 'string' ? source.options.token : '';
  if (!token) return {};

  switch (source.auth.type) {
    case 'bearer':
      return { Authorization: `Bearer ${token}` };
    case 'header':
      return source.auth.headerName ? { [source.auth.headerName]: token } : {};
    case 'basic':
      return { Authorization: `Basic ${token}` };
    default:
      return {};
  }
}
