import type { HeraldBackend } from './backend.js';
import type {
  ApplicationLogEntry,
  DeviceRegistration,
  Match,
  MatchStatus,
  PreparedApplication,
  Preferences,
  Profile,
  ReleaseIndex,
  ResumeParseResult,
  TodayStats,
} from './types.js';

export interface HeraldClientConfig {
  /** Engine base URL, e.g. `https://herald.example.com` or `http://127.0.0.1:8787`. */
  baseUrl: string;
  /** Bearer token generated at engine setup. */
  token: string;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
  /** Injected so React Native, Node and the browser can each supply their own. */
  fetch?: typeof globalThis.fetch;
}

export class HeraldError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = 'error',
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'HeraldError';
  }

  /** True when retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/** A resume file, described in a way all three runtimes can produce. */
export interface ResumeUpload {
  name: string;
  mimeType: string;
  /** Either the bytes, or a platform URI that the caller's fetch understands. */
  data: Blob | ArrayBuffer | { uri: string };
}

export class HeraldClient implements HeraldBackend {
  private readonly baseUrl: string;
  private token: string;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof globalThis.fetch;

  constructor(config: HeraldClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 20_000;
    const f = config.fetch ?? globalThis.fetch;
    if (!f) throw new Error('No fetch implementation available; pass one in HeraldClientConfig.');
    this.doFetch = f.bind(globalThis);
  }

  setToken(token: string): void {
    this.token = token;
  }

  /** Cheap liveness probe used by the pairing screen before storing credentials. */
  async health(): Promise<{ ok: true; version: string }> {
    return this.request('GET', '/health');
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async getProfile(): Promise<Profile> {
    return this.request('GET', '/profile');
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    return this.request('PUT', '/profile', { body: patch });
  }

  /** Uploads the resume and returns the parsed profile. */
  async uploadResume(file: ResumeUpload): Promise<ResumeParseResult> {
    const form = new FormData();
    if (isUriFile(file.data)) {
      // React Native accepts this shape directly on FormData.
      form.append('resume', { uri: file.data.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    } else {
      const blob = file.data instanceof ArrayBuffer ? new Blob([file.data], { type: file.mimeType }) : file.data;
      form.append('resume', blob, file.name);
    }
    return this.request('POST', '/resume', { body: form, raw: true });
  }

  /** Streams parse progress over SSE. Falls back to a single terminal event. */
  async *resumeProgress(signal?: AbortSignal): AsyncGenerator<import('./types.js').ResumeParseProgress> {
    const res = await this.doFetch(`${this.baseUrl}/resume/progress`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'text/event-stream' },
      signal,
    });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        yield JSON.parse(line.slice(5).trim());
      }
    }
  }

  // ── Preferences ──────────────────────────────────────────────────────────

  async getPreferences(): Promise<Preferences> {
    return this.request('GET', '/preferences');
  }

  async updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    return this.request('PUT', '/preferences', { body: patch });
  }

  // ── Matches ──────────────────────────────────────────────────────────────

  async listMatches(params: { status?: MatchStatus | MatchStatus[]; limit?: number; since?: string } = {}): Promise<Match[]> {
    const query = new URLSearchParams();
    if (params.status) {
      for (const s of Array.isArray(params.status) ? params.status : [params.status]) query.append('status', s);
    }
    if (params.limit != null) query.set('limit', String(params.limit));
    if (params.since) query.set('since', params.since);
    const suffix = query.toString() ? `?${query}` : '';
    return this.request('GET', `/matches${suffix}`);
  }

  async getMatch(id: string): Promise<Match> {
    return this.request('GET', `/matches/${encodeURIComponent(id)}`);
  }

  /** Prepares the application and returns the filled form for the Review screen. */
  async approve(id: string): Promise<PreparedApplication> {
    return this.request('POST', `/matches/${encodeURIComponent(id)}/approve`);
  }

  /** Submits the reviewed form. Only ever called from an explicit Submit tap. */
  async submit(id: string, fields?: Record<string, string>, coverLetter?: string): Promise<Match> {
    return this.request('POST', `/matches/${encodeURIComponent(id)}/submit`, {
      body: { fields, coverLetter },
    });
  }

  async skip(id: string): Promise<Match> {
    return this.request('POST', `/matches/${encodeURIComponent(id)}/skip`);
  }

  async log(id: string): Promise<ApplicationLogEntry[]> {
    return this.request('GET', `/matches/${encodeURIComponent(id)}/log`);
  }

  // ── Stats, devices, releases ─────────────────────────────────────────────

  async todayStats(): Promise<TodayStats> {
    return this.request('GET', '/stats/today');
  }

  async registerDevice(device: DeviceRegistration): Promise<{ ok: true }> {
    return this.request('POST', '/devices', { body: device });
  }

  async unregisterDevice(token: string): Promise<{ ok: true }> {
    return this.request('DELETE', `/devices/${encodeURIComponent(token)}`);
  }

  /** Triggers an out-of-band crawl. The scheduler runs this hourly on its own. */
  async runCrawl(): Promise<{ started: true }> {
    return this.request('POST', '/crawl');
  }

  /** Release feed, proxied by the engine so the phone works behind one origin. */
  async releases(): Promise<ReleaseIndex> {
    return this.request('GET', '/releases');
  }

  // ── Transport ────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; raw?: boolean } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      };
      let body: BodyInit | undefined;
      if (opts.body !== undefined) {
        if (opts.raw) {
          body = opts.body as BodyInit;
        } else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify(opts.body);
        }
      }
      const res = await this.doFetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      const payload = await readJson(res);
      if (!res.ok) {
        const err = payload as { message?: string; code?: string } | null;
        throw new HeraldError(err?.message ?? res.statusText, res.status, err?.code ?? 'error', payload);
      }
      return payload as T;
    } catch (cause) {
      if (cause instanceof HeraldError) throw cause;
      const message = cause instanceof Error ? cause.message : String(cause);
      throw new HeraldError(message, 0, 'network', cause);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function isUriFile(data: ResumeUpload['data']): data is { uri: string } {
  return typeof data === 'object' && data !== null && 'uri' in data;
}
