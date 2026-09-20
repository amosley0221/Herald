import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_PROMPTS, renderPrompt } from '../prompts.js';
import { base64ToBytes, base64ToUtf8, parseModelJson } from '../base64.js';
import { docxToText, looksLikeZip } from '../docx.js';
import { thousands } from '../format.js';
import type { Preferences, Profile } from '../types.js';
import type { RawPosting } from '../sources/types.js';
import { DEFAULT_MODELS, type ModelConfig } from './ports.js';

/**
 * Talks to Claude from the phone.
 *
 * The engine does this server-side with the same prompts; this is the same
 * conversation held from the device, so a score means the same thing either
 * way. The key is the user's own, kept in the Android keystore and sent only
 * to api.anthropic.com.
 */

export interface ScoreResult {
  score: number;
  why: string[];
  gaps: string[];
}

/** Long enough to say something, short enough that nobody skims past it. */
const COVER_LETTER_MAX_WORDS = 180;

/** Thrown when the key is missing or rejected, so the UI can say which. */
export class LlmAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmAuthError';
  }
}

export class Llm {
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly models: ModelConfig = DEFAULT_MODELS,
    /**
     * A browser context cannot call api.anthropic.com directly, so the desktop
     * app passes Tauri's native fetch here. React Native passes nothing and
     * gets the global one.
     */
    fetchImpl?: typeof globalThis.fetch,
  ) {
    if (!apiKey.trim()) {
      throw new LlmAuthError('No Anthropic API key is set. Add one in Preferences.');
    }
    this.client = new Anthropic({
      apiKey,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  /**
   * Scores one posting against the resume.
   *
   * Temperature is zero and the reply is JSON: this is a judgement that should
   * not wander between runs, and the same posting scored twice should land in
   * the same place.
   */
  async score(
    // `source` is attached by the crawl, not by the adapter, so it rides
    // alongside RawPosting rather than inside it.
    posting: RawPosting & { source?: string },
    resumeText: string,
    preferences: Preferences,
  ): Promise<ScoreResult> {
    const prompt = renderPrompt(DEFAULT_PROMPTS.score, {
      resume: resumeText,
      roles: preferences.roles.join(', ') || 'not specified',
      locations: preferences.locations.join(', ') || 'not specified',
      remote: preferences.remote ? 'yes' : 'no',
      locationPolicy: locationPolicy(preferences),
      minSalary: preferences.minSalary != null ? `$${thousands(preferences.minSalary)}` : 'not specified',
      seniority: preferences.seniority.join(', ') || 'not specified',
      title: posting.title,
      company: posting.company,
      location: posting.location || 'not specified',
      postingRemote: posting.remote ? 'yes' : 'no',
      pay: posting.pay ?? 'not published',
      source: posting.source ?? 'unknown',
      postedAt: posting.postedAt,
      description: posting.description,
    });

    const raw = await this.json<{ score: number; why: string[]; gaps: string[] }>(
      this.models.scoreModel, prompt, 1024,
    );

    // The prompt asks for three reasons and one or two gaps, but a model can
    // drift. Clamp rather than reject: a usable score with two reasons beats no
    // score at all, and this matches what the engine does.
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(raw.score)))),
      why: asStrings(raw.why).slice(0, 3),
      gaps: asStrings(raw.gaps).slice(0, 2),
    };
  }

  /**
   * Drafts a cover letter. The user edits it on the Review screen before
   * anything is sent.
   *
   * `topReason` is the first of the reasons scoring gave for the match, so the
   * letter leads with the same thing the user was shown as the reason to look.
   */
  async coverLetter(
    posting: RawPosting,
    profile: Profile,
    topReason?: string,
  ): Promise<string> {
    const prompt = renderPrompt(DEFAULT_PROMPTS['cover-letter'], {
      profile: describeProfile(profile),
      title: posting.title,
      company: posting.company,
      location: posting.location || 'not stated',
      // The prompt only needs enough of the posting to write against; the rest
      // is boilerplate that costs tokens on every application.
      description: posting.description.slice(0, 6_000),
      topReason: topReason ?? 'Your background lines up with what this role asks for.',
      maxWords: COVER_LETTER_MAX_WORDS,
    });
    return (await this.text(this.models.writeModel, prompt, this.models.maxOutputTokens)).trim();
  }

  /**
   * Reads a resume.
   *
   * A PDF goes to the model as a document, since Claude reads those natively
   * and no library is needed. A .docx cannot: it is a ZIP archive, and sending
   * its bytes as text produces lone surrogates that are not valid JSON — the
   * API rejects the request before ever seeing the resume. So its text is
   * extracted here first. Anything else is treated as plain text, and checked
   * before it is sent rather than being allowed to fail as a puzzle.
   */
  async parseResume(
    file: { base64: string; mimeType: string; name: string },
  ): Promise<{ profile: Partial<Profile>; text: string; warnings: string[] }> {
    const prompt = DEFAULT_PROMPTS['resume-parse'];
    const name = file.name.toLowerCase();
    const isPdf = file.mimeType === 'application/pdf' || name.endsWith('.pdf');

    const content: Anthropic.ContentBlockParam[] = isPdf
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } },
          { type: 'text', text: prompt },
        ]
      : [{ type: 'text', text: `${prompt}\n\n${resumeText(file, name)}` }];

    const message = await this.client.messages.create({
      model: this.models.writeModel,
      max_tokens: 4096,
      // No `temperature`: current models reject sampling parameters outright
      // (`400 \`temperature\` is deprecated for this model`), and the model is
      // configurable, so sending it would work only on older ones.
      messages: [{ role: 'user', content }],
    });

    const reply = firstText(message);
    const parsed = parseModelJson<{
      profile?: Partial<Profile>; text?: string; warnings?: string[];
    }>(reply);

    return {
      profile: parsed.profile ?? {},
      text: parsed.text ?? reply,
      warnings: asStrings(parsed.warnings),
    };
  }

  // ── Transport ─────────────────────────────────────────────────────────────

  private async text(model: string, prompt: string, maxTokens: number): Promise<string> {
    try {
      const message = await this.client.messages.create({
        // See parseResume: sampling parameters are rejected by current models.
        model, max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      return firstText(message);
    } catch (cause) {
      throw translate(cause);
    }
  }

  private async json<T>(model: string, prompt: string, maxTokens: number): Promise<T> {
    return parseModelJson<T>(await this.text(model, prompt, maxTokens));
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The resume as text, whatever was handed over.
 *
 * The check for a ZIP is by content rather than by name, because a file saved
 * without an extension, or with the wrong one, is still whatever it is.
 */
function resumeText(file: { base64: string; mimeType: string }, name: string): string {
  const bytes = base64ToBytes(file.base64);

  if (
    name.endsWith('.docx')
    || file.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || looksLikeZip(bytes)
  ) {
    return docxToText(bytes);
  }

  if (name.endsWith('.doc') || file.mimeType === 'application/msword') {
    throw new Error(
      'That is an old-format .doc, which Herald cannot read. Save it as .docx or PDF and try again.',
    );
  }

  const text = base64ToUtf8(file.base64);
  // A lone surrogate means these were never UTF-8 text, and sending them would
  // fail as an unexplained 400 from the API rather than as something to act on.
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) {
    throw new Error('Herald could not read that file as text. Try a PDF or a .docx.');
  }
  if (!text.trim()) throw new Error('That file appears to be empty.');
  return text;
}

/**
 * What to tell scoring about roles outside the preferred locations.
 *
 * Rather than adjusting the score afterwards — which would be putting a thumb
 * on the model's judgement — the preference is stated and the model weighs it
 * like any other requirement.
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

/** The profile as the prompt wants it: plain lines, nothing empty. */
function describeProfile(profile: Profile): string {
  return [
    profile.fullName && `Name: ${profile.fullName}`,
    profile.location && `Location: ${profile.location}`,
    profile.years != null && `Years of experience: ${profile.years}`,
    profile.titles.length > 0 && `Titles held: ${profile.titles.join(', ')}`,
    profile.skills.length > 0 && `Skills: ${profile.skills.join(', ')}`,
    profile.summary && `Summary: ${profile.summary}`,
  ].filter((line): line is string => typeof line === 'string').join('\n');
}

function firstText(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

/** Turns an SDK error into something the UI can show without leaking the key. */
function translate(cause: unknown): Error {
  if (cause instanceof Anthropic.AuthenticationError) {
    return new LlmAuthError('That Anthropic API key was rejected. Check it in Preferences.');
  }
  if (cause instanceof Anthropic.RateLimitError) {
    return new Error('Anthropic rate limit reached. The next scan will pick up where this one stopped.');
  }
  if (cause instanceof Anthropic.APIError) {
    return new Error(`Anthropic returned ${cause.status}: ${cause.message}`);
  }
  return cause instanceof Error ? cause : new Error(String(cause));
}
