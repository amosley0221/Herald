import { z } from 'zod';
import type { Profile, ResumeParseResult } from '@herald/core';
import type { LoadedConfig } from '../config.js';
import type { LlmClient } from '../llm/client.js';
import type { PromptLibrary } from '../llm/prompts.js';
import { errorFields, type Logger } from '../log.js';

const ParsedSchema = z.object({
  fullName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  portfolio: z.string().nullable(),
  linkedin: z.string().nullable(),
  summary: z.string().nullable(),
  skills: z.array(z.string()),
  titles: z.array(z.string()),
  years: z.number().nullable(),
});

export class ResumeParseError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ResumeParseError';
  }
}

/** File types the upload endpoint accepts, per the onboarding screen's copy. */
export const ACCEPTED_TYPES: Record<string, 'pdf' | 'docx' | 'txt'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'txt',
};

export function detectType(mimeType: string, fileName: string): 'pdf' | 'docx' | 'txt' | null {
  const byMime = ACCEPTED_TYPES[mimeType.split(';')[0]!.trim().toLowerCase()];
  if (byMime) return byMime;
  const extension = fileName.toLowerCase().split('.').pop();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'docx';
  if (extension === 'txt' || extension === 'md') return 'txt';
  return null;
}

/** Pulls plain text out of the uploaded file. */
export async function extractText(buffer: Buffer, type: 'pdf' | 'docx' | 'txt'): Promise<string> {
  switch (type) {
    case 'txt':
      return buffer.toString('utf8');
    case 'docx': {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      return value;
    }
    case 'pdf': {
      const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf');
      const document = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractPdfText(document, { mergePages: true });
      return Array.isArray(text) ? text.join('\n') : text;
    }
  }
}

/**
 * Turns a resume file into a structured profile.
 *
 * Extraction is deterministic; interpretation is the model's. Where the two
 * disagree — an email the model did not spot, say — the regex-extracted value
 * wins, because a contact detail copied wrong is worse than one left blank.
 */
export class ResumeParser {
  constructor(
    private readonly config: LoadedConfig,
    private readonly llm: LlmClient,
    private readonly prompts: PromptLibrary,
    private readonly log: Logger,
  ) {}

  async parse(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    existing?: Profile | null,
  ): Promise<{ result: ResumeParseResult; text: string }> {
    const type = detectType(mimeType, fileName);
    if (!type) {
      throw new ResumeParseError('Herald reads PDF, DOCX and TXT files.', 'unsupported_type');
    }

    let text: string;
    try {
      text = (await extractText(buffer, type)).replace(/\r\n/g, '\n').trim();
    } catch (cause) {
      this.log.warn('text extraction failed', errorFields(cause));
      throw new ResumeParseError('That file could not be read.', 'extraction_failed');
    }

    if (text.length < 100) {
      // A scanned resume gives a near-empty extraction; say so plainly rather
      // than handing the model a blank page and reporting whatever it invents.
      throw new ResumeParseError(
        'Almost no text could be read from that file. If it is a scan, export a text-based PDF and try again.',
        'too_little_text',
      );
    }

    const warnings: string[] = [];
    const deterministic = extractContactDetails(text);

    let modelProfile: z.infer<typeof ParsedSchema> | null = null;
    if (this.llm.available) {
      try {
        modelProfile = await this.llm.completeJson(
          {
            model: this.config.llm.writeModel,
            prompt: this.prompts.render('resume-parse', { resume: text.slice(0, 20_000) }),
            maxTokens: 1500,
            temperature: 0,
          },
          (value) => ParsedSchema.parse(value),
        );
      } catch (cause) {
        this.log.warn('resume interpretation failed; falling back to extraction only', errorFields(cause));
        warnings.push('Herald could not interpret the resume fully. Check your profile before the first crawl.');
      }
    } else {
      warnings.push('No model credentials are configured, so only contact details were extracted.');
    }

    const profile: Profile = {
      // Deterministic extraction wins for anything that must be exactly right.
      fullName: modelProfile?.fullName ?? deterministic.fullName ?? existing?.fullName ?? null,
      email: deterministic.email ?? modelProfile?.email ?? existing?.email ?? null,
      phone: deterministic.phone ?? modelProfile?.phone ?? existing?.phone ?? null,
      location: modelProfile?.location ?? existing?.location ?? null,
      portfolio: deterministic.portfolio ?? modelProfile?.portfolio ?? existing?.portfolio ?? null,
      linkedin: deterministic.linkedin ?? modelProfile?.linkedin ?? existing?.linkedin ?? null,
      summary: modelProfile?.summary ?? existing?.summary ?? null,
      skills: dedupeStrings(modelProfile?.skills ?? []),
      titles: dedupeStrings(modelProfile?.titles ?? []),
      years: modelProfile?.years ?? existing?.years ?? null,
      // These are never on a resume; carry forward whatever the user has set.
      workAuthorization: existing?.workAuthorization ?? null,
      availability: existing?.availability ?? null,
      resumeFileName: fileName,
      resumeUpdatedAt: new Date().toISOString(),
    };

    if (!profile.email) warnings.push('No email address was found. Add one in Preferences before applying.');
    if (!profile.phone) warnings.push('No phone number was found.');
    if (profile.skills.length === 0) warnings.push('No skills could be identified.');
    if (!profile.workAuthorization) {
      warnings.push('Set your work authorization in Preferences — most forms ask for it.');
    }

    return { result: { profile, warnings }, text };
  }
}

/** Regex extraction for the fields that must be character-exact. */
export function extractContactDetails(text: string): {
  fullName: string | null; email: string | null; phone: string | null;
  portfolio: string | null; linkedin: string | null;
} {
  const email = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.exec(text)?.[0] ?? null;

  // Deliberately conservative: a run of digits that is not clearly a phone
  // number is better left out than guessed at.
  const phoneMatch = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/.exec(text);
  const phone = phoneMatch?.[0]?.trim() ?? null;

  const linkedin = /\b(?:https?:\/\/)?(?:[\w-]+\.)?linkedin\.com\/in\/[\w-]+\/?/i.exec(text)?.[0] ?? null;

  // The lookbehind keeps the domain half of an email address from being read
  // as a personal site: "ada@example.com" must not yield "example.com".
  const urls = text.match(/(?<![\w@.])(?:https?:\/\/)?(?:www\.)?[\w-]+\.[a-z]{2,}(?:\/[\w\-./?%&=]*)?/gi) ?? [];
  const emailDomain = email?.split('@')[1]?.toLowerCase() ?? null;
  const portfolio = urls.find((url) => {
    const lowered = url.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
    if (emailDomain && lowered.startsWith(emailDomain)) return false;
    return !lowered.includes('linkedin.')
      && !lowered.includes('github.com/orgs')
      && !/\.(png|jpe?g|pdf)$/.test(lowered);
  }) ?? null;

  // The name is usually the first non-empty line, before any contact block.
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const looksLikeName = /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}$/.test(firstLine)
    && !firstLine.includes('@') && firstLine.length < 60;

  return {
    fullName: looksLikeName ? firstLine : null,
    email,
    phone,
    portfolio,
    linkedin,
  };
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
