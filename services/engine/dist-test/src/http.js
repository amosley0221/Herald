/**
 * Small HTTP client with per-source rate limiting and retry-with-backoff.
 *
 * Sources are third-party services being read on a schedule, so being a polite
 * client is not optional: every adapter goes through one of these, configured
 * from that source's `rateLimitPerMinute`.
 */
export function createHttpClient(options = {}) {
    const { headers = {}, rateLimitPerMinute = 60, timeoutMs = 30_000, retries = 3, userAgent = 'Herald/1.0 (+https://github.com/amosley0221/herald)', log, signal, } = options;
    const minIntervalMs = 60_000 / Math.max(1, rateLimitPerMinute);
    let nextSlot = 0;
    async function takeSlot() {
        const now = Date.now();
        const wait = Math.max(0, nextSlot - now);
        nextSlot = Math.max(now, nextSlot) + minIntervalMs;
        if (wait > 0)
            await sleep(wait);
    }
    async function send(url, init = {}) {
        let lastError;
        for (let attempt = 0; attempt <= retries; attempt++) {
            await takeSlot();
            const controller = new AbortController();
            const onAbort = () => controller.abort();
            signal?.addEventListener('abort', onAbort, { once: true });
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, {
                    ...init,
                    headers: { 'User-Agent': userAgent, ...headers, ...init.headers },
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
            }
            catch (cause) {
                lastError = cause;
                if (signal?.aborted)
                    throw cause;
                if (attempt < retries) {
                    await sleep(backoffMs(attempt));
                    continue;
                }
            }
            finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
            }
        }
        throw new Error(`Request failed after ${retries + 1} attempts: ${url}`, { cause: lastError });
    }
    return {
        async json(url, init) {
            const res = await send(url, { ...init, headers: { Accept: 'application/json', ...init?.headers } });
            if (!res.ok)
                throw new Error(`${res.status} ${res.statusText} from ${url}`);
            return (await res.json());
        },
        async text(url, init) {
            const res = await send(url, init);
            if (!res.ok)
                throw new Error(`${res.status} ${res.statusText} from ${url}`);
            return res.text();
        },
    };
}
function backoffMs(attempt) {
    // 1s, 2s, 4s … with jitter so parallel sources do not retry in lockstep.
    return Math.round(2 ** attempt * 1000 * (0.75 + Math.random() * 0.5));
}
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=http.js.map