/**
 * Herald domain contracts.
 *
 * These types are the wire format between the engine and every client. The
 * engine validates each payload against the matching zod schema before it
 * leaves the process, so anything typed here is what a client actually sees.
 */

/** Lifecycle of a single match. Transitions are enforced by `status.ts`. */
export type MatchStatus =
  | 'pending'
  | 'approved'
  | 'applied'
  | 'interview'
  | 'rejected'
  | 'skipped'
  /** The engine tried to submit and hit a CAPTCHA, login wall, or ToS block. */
  | 'needs_you';

/** Visual weight a status carries in the UI. Mirrors the design-system Badge tones. */
export type BadgeTone = 'solid' | 'gold' | 'success' | 'danger' | 'muted';

/** Where a posting came from. Not an enum: sources are defined in engine config. */
export type SourceId = string;

export interface Posting {
  id: string;
  /** Stable hash of (company, normalized title, location) used for dedupe. */
  dedupeKey: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  /** Raw compensation text as published, when the source provides one. */
  pay: string | null;
  payMin: number | null;
  payMax: number | null;
  payCurrency: string | null;
  url: string;
  applyUrl: string;
  source: SourceId;
  /** ISO 8601. When the source published the posting. */
  postedAt: string;
  /** ISO 8601. When Herald first saw it. */
  ingestedAt: string;
  description: string;
}

export interface Match {
  id: string;
  postingId: string;
  score: number;
  /** Ordered strongest-first. `why[0]` is what a notification shows alone. */
  why: string[];
  gaps: string[];
  status: MatchStatus;
  /** ISO 8601, set when the user approved/skipped. */
  decidedAt: string | null;
  submittedAt: string | null;
  /** Relative path to the stored confirmation screenshot, if one was captured. */
  confirmationImage: string | null;
  /** Why a submission failed or was routed to the user. */
  blockedReason: string | null;
  createdAt: string;
  posting: Posting;
}

export interface Profile {
  /** Fields parsed out of the resume; every one may be null on a thin resume. */
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  portfolio: string | null;
  linkedin: string | null;
  summary: string | null;
  skills: string[];
  titles: string[];
  years: number | null;
  /** Free-form extras the user fills in that no resume carries. */
  workAuthorization: string | null;
  availability: string | null;
  resumeFileName: string | null;
  resumeUpdatedAt: string | null;
}

export interface Preferences {
  roles: string[];
  locations: string[];
  remote: boolean;
  minSalary: number | null;
  /** 60–99. At or above this score a match pushes instantly. */
  threshold: number;
  instant: boolean;
  digest: boolean;
  /** Local hour 0–23 for the digest push. */
  digestHour: number;
  tailorLetter: boolean;
  /** Hard ceiling on automated submissions per calendar day. */
  dailySubmitCap: number;
  /** IANA zone, e.g. "America/New_York". Drives digest timing and "today". */
  timezone: string;
  /** Seniority words to keep; empty means no seniority filter. */
  seniority: string[];
  /** Postings whose title or company match any of these are dropped pre-scoring. */
  excludeKeywords: string[];
  /**
   * Whether roles outside `locations` are worth seeing.
   *
   * Off, a posting somewhere else is dropped before it is ever scored, so it
   * cannot appear at any threshold. On, it is scored — but scoring is told the
   * preferred locations and that elsewhere has to be clearly worth moving for,
   * so local roles win a tie on their own merits rather than by a thumb on the
   * scale.
   */
  includeElsewhere: boolean;
}

export interface TodayStats {
  read: number;
  matched: number;
  applied: number;
  pending: number;
  /** ISO 8601 of the last completed crawl, or null before the first run. */
  lastCrawlAt: string | null;
  /** Postings read in that last crawl. */
  lastCrawlRead: number;
}

/** One key/value row on the Review screen. */
export interface ApplicationField {
  key: string;
  label: string;
  value: string;
  /** Which form control the target site uses, so the review screen can hint. */
  kind: 'text' | 'email' | 'tel' | 'url' | 'file' | 'select' | 'textarea' | 'boolean';
  required: boolean;
  /** Options when `kind` is 'select'. */
  options?: string[];
}

/** What `POST /matches/:id/approve` returns — the filled form awaiting review. */
export interface PreparedApplication {
  matchId: string;
  fields: ApplicationField[];
  coverLetter: string | null;
  /** True when the engine could not read the form and filled from profile alone. */
  degraded: boolean;
  /** Set when the apply flow cannot be automated at all (e.g. LinkedIn Easy Apply). */
  manualOnly: boolean;
  manualReason: string | null;
  preparedAt: string;
}

export interface ApplicationLogEntry {
  id: string;
  matchId: string;
  at: string;
  action: 'prepared' | 'submitted' | 'failed' | 'skipped' | 'needs_you';
  detail: string | null;
  /** Exact payload sent to the target site, kept so the user can audit it. */
  payload: Record<string, string> | null;
}

export interface ReleaseEntry {
  version: string;
  date: string;
  notesMarkdown: string;
  androidVersionCode: number;
  minSupported: string;
  /**
   * Where this version's APK can be downloaded, filled in by CI once the build
   * exists. Null until then — the in-app updater shows the notes instead of
   * offering an install it cannot complete.
   */
  androidApkUrl?: string | null;
  /** Code-push patches shipped on top of this version, newest first. */
  patches?: ReleasePatch[];
}

export interface ReleasePatch {
  number: number;
  date: string;
  notesMarkdown: string;
}

export interface ReleaseIndex {
  latest: string;
  androidVersionCode: number;
  minSupported: string;
  releases: ReleaseEntry[];
}

/** Device registration for push. */
export interface DeviceRegistration {
  token: string;
  platform: 'android' | 'ios' | 'desktop';
  /** App version the device is running, so the engine can stop pushing to stale builds. */
  appVersion: string;
}

export interface ResumeParseResult {
  profile: Profile;
  /** Non-fatal notes, e.g. "no phone number found". Shown as hints, not errors. */
  warnings: string[];
}

/** Progress ticks streamed while a resume is parsed. */
export interface ResumeParseProgress {
  step: number;
  totalSteps: number;
  percent: number;
  label: string;
  done: boolean;
}

export interface PairingPayload {
  /** Base URL the phone should talk to. */
  baseUrl: string;
  token: string;
}
