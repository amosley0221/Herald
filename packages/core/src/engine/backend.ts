import { BUILTIN_FIELD_RULES, fallbackFields, isManualOnlyHost } from '../apply.js';
import type {
  ApplicationLogEntry, Match, MatchStatus, PreparedApplication, Preferences,
  Profile, ReleaseIndex, ResumeParseResult,
} from '../types.js';
import type { HeraldBackend } from '../backend.js';
import type { ResumeUpload } from '../client.js';
import { runCrawl } from './crawl.js';
import { Llm } from './llm.js';
import type { EnginePlatform } from './ports.js';

/**
 * The engine, on the device.
 *
 * Implements the same interface `HeraldClient` does, so every screen works
 * against either without knowing which it has. That is what makes running with
 * no server cost no UI changes, and what keeps pairing with a hosted engine
 * available for anyone who would rather their phone sat idle.
 */
export class LocalBackend implements HeraldBackend {
  constructor(private readonly platform: EnginePlatform) {}

  private get db() { return this.platform.store; }
  private get settings() { return this.platform.settings; }

  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(): Promise<Profile> {
    const stored = await this.db.getProfile();
    if (!stored) throw new Error('No resume has been uploaded yet.');
    return stored.profile;
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const stored = await this.db.getProfile();
    const updated: Profile = {
      ...(stored?.profile ?? emptyProfile()),
      ...patch,
    };
    await this.db.setProfile(updated);
    return updated;
  }

  async uploadResume(file: ResumeUpload): Promise<ResumeParseResult> {
    const apiKey = await this.settings.getApiKey();
    if (!apiKey) {
      throw new Error('Add your Anthropic API key in Preferences before uploading a resume.');
    }

    const base64 = await readAsBase64(file);
    const llm = new Llm(apiKey, await this.settings.getModels(), this.platform.fetch);
    const parsed = await llm.parseResume({
      base64, mimeType: file.mimeType, name: file.name,
    });

    const existing = await this.db.getProfile();
    // Parsed values fill gaps; anything already corrected by hand is kept, since
    // the user editing a field is a stronger signal than the model re-reading it.
    const profile: Profile = {
      ...emptyProfile(),
      ...parsed.profile,
      ...stripEmpty(existing?.profile ?? {}),
      resumeFileName: file.name,
      resumeUpdatedAt: new Date().toISOString(),
    };

    await this.db.setProfile(profile, parsed.text);
    return { profile, warnings: parsed.warnings };
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  async getPreferences(): Promise<Preferences> {
    const stored = await this.db.getPreferences();
    if (stored) return stored;
    const defaults = defaultPreferences();
    await this.db.setPreferences(defaults);
    return defaults;
  }

  async updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const updated = { ...(await this.getPreferences()), ...patch };
    await this.db.setPreferences(updated);
    return updated;
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  async listMatches(params: {
    status?: MatchStatus | MatchStatus[]; limit?: number; since?: string;
  } = {}): Promise<Match[]> {
    const status = params.status === undefined
      ? undefined
      : Array.isArray(params.status) ? params.status : [params.status];
    return this.db.listMatches({ status, limit: params.limit, since: params.since });
  }

  async getMatch(id: string): Promise<Match> {
    const match = await this.db.getMatch(id);
    if (!match) throw new Error('That match is no longer available.');
    return match;
  }

  /**
   * Prepares an application.
   *
   * Approving never sends anything: it drafts a cover letter and lays out the
   * fields so the Review screen can show exactly what would be submitted. It is
   * idempotent — approving twice returns the stored preparation rather than
   * paying for a second cover letter.
   */
  async approve(id: string): Promise<PreparedApplication> {
    const existing = await this.db.getPreparedApplication(id);
    if (existing) return existing;

    const match = await this.getMatch(id);
    const stored = await this.db.getProfile();
    if (!stored?.resumeText) throw new Error('Upload your resume before applying.');

    const manualOnly = isManualOnlyHost(match.posting.applyUrl);
    let coverLetter: string | null = null;
    let degraded = true;

    if (!manualOnly) {
      const preferences = await this.getPreferences();
      if (preferences.tailorLetter) {
        const apiKey = await this.settings.getApiKey();
        if (apiKey) {
          try {
            const llm = new Llm(apiKey, await this.settings.getModels(), this.platform.fetch);
            coverLetter = await llm.coverLetter(
              { ...match.posting, externalId: match.posting.id, raw: null },
              stored.profile,
              match.why[0],
            );
          } catch {
            // A missing letter is worth far less than a blocked application;
            // the Review screen lets the user write their own.
            coverLetter = null;
          }
        }
      }
    }

    // The form itself is read in the web view at submit time, so what is laid
    // out here comes from the profile alone — which is what `degraded` says.
    const fields = fallbackFields(BUILTIN_FIELD_RULES, {
      profile: stored.profile,
      coverLetter,
      resumeFileName: stored.profile.resumeFileName,
    });

    const prepared: PreparedApplication = {
      matchId: id,
      fields,
      coverLetter,
      degraded,
      manualOnly,
      manualReason: manualOnly
        ? 'Automating LinkedIn Easy Apply breaks their terms, so this one is yours to submit.'
        : null,
      preparedAt: new Date().toISOString(),
    };

    await this.db.savePreparedApplication(prepared);
    if (match.status === 'pending') await this.db.setMatchStatus(id, 'approved');
    await this.db.appendLog(id, 'approved', manualOnly ? 'Manual only' : 'Prepared');
    return prepared;
  }

  /**
   * Records a submission.
   *
   * Nothing reaches a company from here: the web view sends the form, and this
   * is what the Review screen calls once the user has tapped Submit there. The
   * daily cap is enforced before anything is recorded.
   */
  async submit(
    id: string, fields?: Record<string, string>, coverLetter?: string,
  ): Promise<Match> {
    const preferences = await this.getPreferences();
    const sentToday = await this.db.submittedToday();
    if (preferences.dailySubmitCap > 0 && sentToday >= preferences.dailySubmitCap) {
      throw new Error(
        `That is the ${preferences.dailySubmitCap} applications you allowed for today. The cap is in Preferences.`,
      );
    }

    const now = new Date().toISOString();
    await this.db.setMatchStatus(id, 'applied', { submittedAt: now });
    await this.db.appendLog(id, 'submitted', 'Submitted', { fields, coverLetter });
    return this.getMatch(id);
  }

  async skip(id: string): Promise<Match> {
    await this.db.setMatchStatus(id, 'skipped');
    await this.db.appendLog(id, 'skipped', 'Skipped');
    return this.getMatch(id);
  }

  async log(id: string): Promise<ApplicationLogEntry[]> {
    const rows = await this.db.listLog(id);
    return rows.map((row, index) => ({
      id: `${id}-${index}`,
      matchId: id,
      at: row.at,
      action: row.action,
      detail: row.detail,
      payload: row.payload,
    })) as ApplicationLogEntry[];
  }

  // ── Today ─────────────────────────────────────────────────────────────────

  async todayStats(): Promise<TodayStatsShape> {
    return this.db.todayStats();
  }

  async runCrawl(): Promise<{ started: true }> {
    // Deliberately not awaited: the Today screen shows progress and the scan can
    // outlive the tap that started it.
    void runCrawl(this.platform);
    return { started: true };
  }

  /**
   * The release feed, read directly.
   *
   * Paired with an engine there is something to proxy and cache this; standalone
   * there is not, and without it the in-app updater has nothing to check.
   */
  async releases(): Promise<ReleaseIndex> {
    const url = await this.settings.getReleasesIndexUrl();
    if (!url) {
      throw new Error(
        'No release feed is configured, so Herald cannot check for updates.',
      );
    }
    const response = await this.platform.fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`The release feed returned ${response.status}.`);

    const index = (await response.json()) as ReleaseIndex;
    if (!index?.latest || !Array.isArray(index.releases)) {
      throw new Error('That URL did not return a Herald release feed.');
    }
    return index;
  }
}

type TodayStatsShape = Awaited<ReturnType<HeraldBackend['todayStats']>>;

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptyProfile(): Profile {
  return {
    fullName: null, email: null, phone: null, location: null, portfolio: null,
    linkedin: null, summary: null, workAuthorization: null, availability: null,
    years: null, resumeFileName: null, resumeUpdatedAt: null, skills: [], titles: [],
  };
}

/** Drops null and empty values so a patch never blanks a field it has nothing for. */
function stripEmpty<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null || entry === undefined) continue;
    if (typeof entry === 'string' && entry.trim() === '') continue;
    if (Array.isArray(entry) && entry.length === 0) continue;
    out[key] = entry;
  }
  return out as Partial<T>;
}

function defaultPreferences(): Preferences {
  return {
    roles: [], locations: [], remote: true, minSalary: null, threshold: 85,
    instant: true, digest: true, digestHour: 7, tailorLetter: true,
    dailySubmitCap: 15, timezone: 'UTC', seniority: [], excludeKeywords: [], includeElsewhere: false,
  };
}

/**
 * Reads an upload into base64.
 *
 * Only the string and Blob shapes are handled here; a platform that hands back
 * a file URI resolves it in its own adapter, since reading one needs a
 * filesystem this layer deliberately does not know about.
 */
async function readAsBase64(file: ResumeUpload): Promise<string> {
  if (typeof file.data === 'string') return file.data;
  if (file.data instanceof Blob) {
    const buffer = await file.data.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  }
  throw new Error(
    'That file could not be read here — pass the resume as base64 or a Blob.',
  );
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes to base64, without Buffer or btoa. */
function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const value = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(value >> 18) & 63];
    out += B64[(value >> 12) & 63];
    out += b === undefined ? '=' : B64[(value >> 6) & 63];
    out += c === undefined ? '=' : B64[value & 63];
  }
  return out;
}
