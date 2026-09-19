import type {
  ApplicationLogEntry, Match, MatchStatus, PreparedApplication, Preferences,
  Profile, ReleaseIndex, ResumeParseResult, TodayStats,
} from './types.js';
import type { ResumeUpload } from './client.js';

/**
 * Everything the apps need from whatever is doing the work.
 *
 * There are two implementations: `HeraldClient`, which forwards to a hosted
 * engine over HTTP, and the Android app's on-device engine, which does the work
 * itself against local storage and the Anthropic API. The screens are written
 * against this interface and cannot tell which one they have, so running
 * without a server costs no UI changes and keeps the hosted path available for
 * anyone who wants their phone to stay idle.
 *
 * Device registration is deliberately absent: it exists for a server that has
 * to push to a phone, and a phone doing its own work just schedules a local
 * notification instead.
 */
export interface HeraldBackend {
  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<Profile>): Promise<Profile>;
  uploadResume(file: ResumeUpload): Promise<ResumeParseResult>;

  getPreferences(): Promise<Preferences>;
  updatePreferences(patch: Partial<Preferences>): Promise<Preferences>;

  listMatches(params?: {
    status?: MatchStatus | MatchStatus[];
    limit?: number;
    since?: string;
  }): Promise<Match[]>;
  getMatch(id: string): Promise<Match>;
  approve(id: string): Promise<PreparedApplication>;
  submit(id: string, fields?: Record<string, string>, coverLetter?: string): Promise<Match>;
  skip(id: string): Promise<Match>;
  log(id: string): Promise<ApplicationLogEntry[]>;

  todayStats(): Promise<TodayStats>;
  /** Kicks off a scan. On a phone this runs in the foreground; on an engine it is queued. */
  runCrawl(): Promise<{ started: true }>;
  releases(): Promise<ReleaseIndex>;
}
