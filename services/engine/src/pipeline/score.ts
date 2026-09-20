import { z } from 'zod';
import type { Preferences, Profile } from '@herald/core';
import type { LoadedConfig } from '../config.js';
import type { LlmClient } from '../llm/client.js';
import type { PromptLibrary } from '../llm/prompts.js';
import type { Logger } from '../log.js';
import type { RawPosting } from '../sources/types.js';

/** What the scoring prompt is contracted to return. */
const ScoreSchema = z.object({
  score: z.number().min(0).max(100),
  why: z.array(z.string()).min(1),
  gaps: z.array(z.string()),
  pay_estimate: z.string().nullable().optional(),
});

export interface ScoreResult {
  score: number;
  why: string[];
  gaps: string[];
  payEstimate: string | null;
}

/**
 * How much of a posting description to send. Long postings are mostly boilerplate
 * about benefits and EEO statements; the requirements are near the top.
 */
const MAX_DESCRIPTION_CHARS = 8_000;
const MAX_RESUME_CHARS = 12_000;

export class Scorer {
  constructor(
    private readonly config: LoadedConfig,
    private readonly llm: LlmClient,
    private readonly prompts: PromptLibrary,
    private readonly log: Logger,
  ) {}

  get available(): boolean {
    return this.llm.available;
  }

  async score(
    posting: RawPosting & { source?: string },
    resumeText: string,
    profile: Profile,
    preferences: Preferences,
  ): Promise<ScoreResult> {
    const prompt = this.prompts.render('score', {
      resume: truncate(resumeText, MAX_RESUME_CHARS),
      roles: preferences.roles.length ? preferences.roles.join(', ') : 'not specified',
      locations: preferences.locations.length ? preferences.locations.join(', ') : 'not specified',
      remote: preferences.remote ? 'yes' : 'no',
      locationPolicy: locationPolicy(preferences),
      minSalary: preferences.minSalary != null ? String(preferences.minSalary) : 'not specified',
      seniority: preferences.seniority.length ? preferences.seniority.join(', ') : 'not specified',
      title: posting.title,
      company: posting.company,
      location: posting.location || 'not specified',
      postingRemote: posting.remote ? 'yes' : 'no',
      pay: posting.pay ?? formatRange(posting) ?? 'not published',
      source: posting.source ?? 'unknown',
      postedAt: posting.postedAt,
      description: truncate(posting.description, MAX_DESCRIPTION_CHARS),
    });

    const raw = await this.llm.completeJson(
      { model: this.config.llm.scoreModel, prompt, maxTokens: 1024 },
      (value) => ScoreSchema.parse(value),
    );

    // The prompt asks for exactly three reasons and one or two gaps, but a model
    // can drift. Clamp rather than reject: a usable score with two reasons beats
    // discarding the call we already paid for.
    return {
      score: Math.round(raw.score),
      why: raw.why.map(clean).filter(Boolean).slice(0, 3),
      gaps: raw.gaps.map(clean).filter(Boolean).slice(0, 2),
      payEstimate: raw.pay_estimate?.trim() || null,
    };
  }

  /**
   * Scores a batch, letting `llm.concurrency` govern parallelism. A failure on
   * one posting is logged and skipped so a single malformed description cannot
   * abort the crawl.
   */
  async scoreAll(
    postings: Array<RawPosting & { source: string }>,
    resumeText: string,
    profile: Profile,
    preferences: Preferences,
    onResult: (posting: RawPosting, result: ScoreResult) => void | Promise<void>,
  ): Promise<{ scored: number; failed: number }> {
    let scored = 0;
    let failed = 0;
    const budget = this.config.llm.maxScoresPerCrawl;
    const queue = postings.slice(0, budget);
    if (postings.length > budget) {
      // Postings arrive newest-first, so the ones dropped here are the oldest
      // in the batch and will be reconsidered on the next crawl.
      this.log.warn('scoring budget reached; deferring the remainder', {
        budget,
        deferred: postings.length - budget,
      });
    }

    const workers = Array.from({ length: this.config.llm.concurrency }, async () => {
      for (;;) {
        const posting = queue.shift();
        if (!posting) return;
        try {
          const result = await this.score(posting, resumeText, profile, preferences);
          scored++;
          await onResult(posting, result);
        } catch (cause) {
          failed++;
          this.log.warn('scoring failed', { title: posting.title, company: posting.company, err: String(cause) });
        }
      }
    });

    await Promise.all(workers);
    return { scored, failed };
  }
}

function clean(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated]`;
}

function formatRange(posting: RawPosting): string | null {
  if (posting.payMin == null && posting.payMax == null) return null;
  const currency = posting.payCurrency ?? 'USD';
  if (posting.payMin != null && posting.payMax != null) {
    return `${posting.payMin}-${posting.payMax} ${currency}`;
  }
  return `${posting.payMin ?? posting.payMax} ${currency}`;
}

/**
 * What to tell scoring about roles outside the preferred locations. Shared
 * wording with the apps, so a score means the same thing either way.
 */
function locationPolicy(preferences: Preferences): string {
  if (preferences.locations.length === 0) {
    return 'No location preference; judge the role on its merits wherever it is.';
  }
  if (!preferences.includeElsewhere) {
    return 'Not acceptable. Only the locations above, or remote.';
  }
  return 'Acceptable, but the candidate would have to move, so a role elsewhere '
    + 'should score well below an equivalent one nearby or remote. Score it high '
    + 'only if it is clearly worth relocating for.';
}
