import {
  BUILTIN_FIELD_RULES, fallbackFields, isManualOnlyHost,
  type ApplicationLogEntry, type HeraldBackend, type Match, type MatchStatus,
  type PreparedApplication, type Preferences, type Profile, type ReleaseIndex,
  type ResumeParseResult, type ResumeUpload,
} from '@herald/core';
import * as db from './db';
import { runCrawl } from './crawl';
import { Llm } from './llm';
import { getApiKey, getModels } from './settings';

/**
 * The engine, on the device.
 *
 * Implements the same interface `HeraldClient` does, so every screen works
 * against either without knowing which it has. That is what makes running with
 * no server cost no UI changes, and what keeps pairing with a hosted engine
 * available for anyone who would rather their phone sat idle.
 */
export class LocalBackend implements HeraldBackend {
  // ── Profile ───────────────────────────────────────────────────────────────

  async getProfile(): Promise<Profile> {
    const stored = await db.getProfile();
    if (!stored) throw new Error('No resume has been uploaded yet.');
    return stored.profile;
  }

  async updateProfile(patch: Partial<Profile>): Promise<Profile> {
    const stored = await db.getProfile();
    const updated: Profile = {
      ...(stored?.profile ?? emptyProfile()),
      ...patch,
    };
    await db.setProfile(updated);
    return updated;
  }

  async uploadResume(file: ResumeUpload): Promise<ResumeParseResult> {
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('Add your Anthropic API key in Preferences before uploading a resume.');
    }

    const base64 = await readAsBase64(file);
    const llm = new Llm(apiKey, await getModels());
    const parsed = await llm.parseResume({
      base64, mimeType: file.mimeType, name: file.name,
    });

    const existing = await db.getProfile();
    // Parsed values fill gaps; anything already corrected by hand is kept, since
    // the user editing a field is a stronger signal than the model re-reading it.
    const profile: Profile = {
      ...emptyProfile(),
      ...parsed.profile,
      ...stripEmpty(existing?.profile ?? {}),
      resumeFileName: file.name,
      resumeUpdatedAt: new Date().toISOString(),
    };

    await db.setProfile(profile, parsed.text);
    return { profile, warnings: parsed.warnings };
  }

  // ── Preferences ───────────────────────────────────────────────────────────

  async getPreferences(): Promise<Preferences> {
    const stored = await db.getPreferences();
    if (stored) return stored;
    const defaults = defaultPreferences();
    await db.setPreferences(defaults);
    return defaults;
  }

  async updatePreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const updated = { ...(await this.getPreferences()), ...patch };
    await db.setPreferences(updated);
    return updated;
  }

  // ── Matches ───────────────────────────────────────────────────────────────

  async listMatches(params: {
    status?: MatchStatus | MatchStatus[]; limit?: number; since?: string;
  } = {}): Promise<Match[]> {
    const status = params.status === undefined
      ? undefined
      : Array.isArray(params.status) ? params.status : [params.status];
    return db.listMatches({ status, limit: params.limit, since: params.since });
  }

  async getMatch(id: string): Promise<Match> {
    const match = await db.getMatch(id);
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
    const existing = await db.getPreparedApplication(id);
    if (existing) return existing;

    const match = await this.getMatch(id);
    const stored = await db.getProfile();
    if (!stored?.resumeText) throw new Error('Upload your resume before applying.');

    const manualOnly = isManualOnlyHost(match.posting.applyUrl);
    let coverLetter: string | null = null;
    let degraded = true;

    if (!manualOnly) {
      const preferences = await this.getPreferences();
      if (preferences.tailorLetter) {
        const apiKey = await getApiKey();
        if (apiKey) {
          try {
            const llm = new Llm(apiKey, await getModels());
            coverLetter = await llm.coverLetter(
              { ...match.posting, externalId: match.posting.id, raw: null },
              stored.resumeText, stored.profile,
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

    await db.savePreparedApplication(prepared);
    if (match.status === 'pending') await db.setMatchStatus(id, 'approved');
    await db.appendLog(id, 'approved', manualOnly ? 'Manual only' : 'Prepared');
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
    const sentToday = await db.submittedToday();
    if (preferences.dailySubmitCap > 0 && sentToday >= preferences.dailySubmitCap) {
      throw new Error(
        `That is the ${preferences.dailySubmitCap} applications you allowed for today. The cap is in Preferences.`,
      );
    }

    const now = new Date().toISOString();
    await db.setMatchStatus(id, 'applied', { submittedAt: now });
    await db.appendLog(id, 'submitted', 'Submitted', { fields, coverLetter });
    return this.getMatch(id);
  }

  async skip(id: string): Promise<Match> {
    await db.setMatchStatus(id, 'skipped');
    await db.appendLog(id, 'skipped', 'Skipped');
    return this.getMatch(id);
  }

  async log(id: string): Promise<ApplicationLogEntry[]> {
    const rows = await db.listLog(id);
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
    return db.todayStats();
  }

  async runCrawl(): Promise<{ started: true }> {
    // Deliberately not awaited: the Today screen shows progress and the scan can
    // outlive the tap that started it.
    void runCrawl();
    return { started: true };
  }

  async releases(): Promise<ReleaseIndex> {
    const { fetchReleaseIndex } = await import('./releases');
    return fetchReleaseIndex();
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
    dailySubmitCap: 15, timezone: 'UTC', seniority: [], excludeKeywords: [],
  };
}

/** Reads an upload into base64, whichever shape the picker handed us. */
async function readAsBase64(file: ResumeUpload): Promise<string> {
  if (typeof file.data === 'string') return file.data;
  if ('uri' in file.data) {
    const FileSystem = await import('expo-file-system/legacy');
    return FileSystem.readAsStringAsync(file.data.uri, { encoding: 'base64' });
  }
  throw new Error('That file could not be read.');
}
