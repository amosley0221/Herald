import type {
  ApplicationField, Match, Preferences, Profile, RawPosting, SourceConfig, TodayStats,
} from '../index.js';

/**
 * What the engine needs from whatever it is running on.
 *
 * The pipeline, the scoring and the backend that sits on top of them are the
 * same on a phone, on a desktop and on a server; what differs is where rows are
 * kept, how HTTP is made, and where a secret lives. Those are the three ports
 * below. Everything else is shared, so a fix to how a duplicate is collapsed or
 * a posting is scored lands everywhere at once instead of being ported twice
 * and drifting.
 */

export interface ModelConfig {
  /** Scoring runs once per surviving posting, so cheap and fast matters here. */
  scoreModel: string;
  /** Cover letters and reading resumes. */
  writeModel: string;
  maxOutputTokens: number;
}

export const DEFAULT_MODELS: ModelConfig = {
  scoreModel: 'claude-sonnet-5',
  writeModel: 'claude-sonnet-5',
  maxOutputTokens: 2048,
};

/** Scores below this never become matches at all. */
export const DEFAULT_FEED_FLOOR = 60;

export interface CachedScore {
  score: number;
  why: string[];
  gaps: string[];
  payEstimate: string | null;
}

export interface StoredPreparation {
  matchId: string;
  fields: ApplicationField[];
  coverLetter: string | null;
  degraded: boolean;
  manualOnly: boolean;
  manualReason: string | null;
  preparedAt: string;
}

export interface LogRow {
  at: string;
  action: string;
  detail: string | null;
  payload: unknown;
}

/** Rows, wherever they are kept. */
export interface EngineStore {
  upsertPosting(
    posting: RawPosting & { dedupeKey: string; source: string; sourcePriority: number },
  ): Promise<{ id: string; isNew: boolean }>;
  /** True when some posting with this dedupe key already has a match. */
  dedupeKeySeen(dedupeKey: string): Promise<boolean>;

  insertMatch(match: {
    postingId: string; score: number; why: string[]; gaps: string[];
  }): Promise<string>;
  listMatches(params: { status?: string[]; limit?: number; since?: string }): Promise<Match[]>;
  getMatch(id: string): Promise<Match | null>;
  setMatchStatus(
    id: string, status: string,
    extra?: { submittedAt?: string; blockedReason?: string | null; confirmationImage?: string | null },
  ): Promise<void>;
  submittedToday(): Promise<number>;

  getProfile(): Promise<{ profile: Profile; resumeText: string | null } | null>;
  setProfile(profile: Profile, resumeText?: string | null): Promise<void>;
  getPreferences(): Promise<Preferences | null>;
  setPreferences(preferences: Preferences): Promise<void>;

  getCachedScore(postingHash: string): Promise<CachedScore | null>;
  cacheScore(postingHash: string, score: CachedScore, model: string): Promise<void>;

  getPreparedApplication(matchId: string): Promise<StoredPreparation | null>;
  savePreparedApplication(prepared: StoredPreparation): Promise<void>;

  appendLog(matchId: string, action: string, detail?: string, payload?: unknown): Promise<void>;
  listLog(matchId: string): Promise<LogRow[]>;

  startCrawlRun(): Promise<string>;
  finishCrawlRun(
    id: string,
    counts: { seen: number; kept: number; scored: number; matched: number },
    error?: string,
  ): Promise<void>;
  lastCrawlAt(): Promise<Date | null>;
  todayStats(): Promise<TodayStats>;
}

/** Settings that are not rows: the key, the boards, the models, the floor. */
export interface EngineSettings {
  getApiKey(): Promise<string | null>;
  getSources(): Promise<SourceConfig[]>;
  getModels(): Promise<ModelConfig>;
  getFeedFloor(): Promise<number>;
  getReleasesIndexUrl(): Promise<string | null>;
}

/**
 * The platform.
 *
 * `fetch` is a port because a browser context cannot reach a job board
 * directly — no ATS sends CORS headers — so the desktop app has to route
 * through Tauri's native HTTP while React Native uses the global one.
 */
export interface EnginePlatform {
  store: EngineStore;
  settings: EngineSettings;
  fetch: typeof globalThis.fetch;
  /** Somewhere to put a line about what happened. Defaults to nothing. */
  log?: {
    error(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    debug(message: string, fields?: Record<string, unknown>): void;
  };
}
