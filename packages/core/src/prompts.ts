/**
 * The default prompt templates, embedded.
 *
 * The engine keeps these as files under `config/prompts/` so wording can be
 * tuned without a rebuild, and it still prefers a file when one is present.
 * A phone has no such directory, so the same text lives here as the fallback —
 * which means a score computed on the phone and a score computed on the engine
 * were asked the same question.
 *
 * `{{name}}` placeholders are filled by `renderPrompt`.
 */

export type PromptName = 'score' | 'cover-letter' | 'resume-parse' | 'classify-reply';

const SCORE_PROMPT = `You are scoring a single job posting against one candidate's resume and stated
preferences. You are not writing a cover letter and not being encouraging — you
are deciding whether this posting is worth the candidate's attention today.

## The candidate's resume

{{resume}}

## The candidate's stated preferences

Roles of interest: {{roles}}
Locations: {{locations}}
Open to remote: {{remote}}
On roles outside those locations: {{locationPolicy}}
Minimum acceptable salary: {{minSalary}}
Seniority to favour: {{seniority}}

## The posting

Title: {{title}}
Company: {{company}}
Location: {{location}}
Remote: {{postingRemote}}
Compensation as published: {{pay}}
Source: {{source}}
Posted: {{postedAt}}

{{description}}

## How to score

Return a score from 0 to 100 for how well this posting fits this candidate.

- 90–100 — the candidate is an obvious fit; the posting's leading requirements
  are things their resume leads with.
- 80–89 — a strong fit with one meaningful gap or mismatch.
- 70–79 — plausible; they could compete but are not the obvious hire.
- 60–69 — adjacent; real overlap, real distance.
- Below 60 — not worth their time.

Judge against the resume in front of you. Do not credit skills the candidate has
not evidenced, and do not penalise a posting for wanting something the resume
shows under a different name. Weigh the requirements the posting lists first
more heavily than the ones it lists last. A salary below the stated minimum, a
location the candidate did not ask for, or a seniority step down are all real
deductions — say so in the gaps rather than quietly ignoring them.

## Reply format

Reply with a single JSON object and nothing else:

{
  "score": <integer 0-100>,
  "why": [<exactly 3 strings>],
  "gaps": [<1 or 2 strings>],
  "pay_estimate": <string or null>
}

- \`why[0]\` is the single strongest reason this posting fits, written so it
  stands alone in a phone notification. Name the specific thing in the resume
  that matches the specific thing in the posting.
- Every \`why\` and \`gap\` is one sentence, under 140 characters, written in plain
  second person about the candidate ("your six years leading a design system",
  not "the candidate has six years").
- \`pay_estimate\` is your read of the annual range when the posting does not
  publish one, or null when you cannot tell. Never invent a number the posting
  does not support.
`;

const COVER_LETTER_PROMPT = `Write the body of a cover letter for this application.

## The candidate

{{profile}}

## The posting

{{title}} at {{company}} — {{location}}

{{description}}

## The strongest reason this is a fit

{{topReason}}

## How to write it

- At most {{maxWords}} words. Shorter is better than padded.
- Open with the specific thing that makes this candidate right for this role.
  Never open with "I am writing to apply" or "I am excited to".
- Work in the strongest reason above, in your own words, as the second or third
  sentence. Do not quote it verbatim.
- Every claim must be something the candidate's background above actually
  supports. Do not invent employers, dates, metrics, or credentials.
- Plain, direct sentences. No superlatives about the company, no "passionate",
  no "thrilled", no "fast-paced environment".
- Close with one sentence offering to talk. No "Sincerely" and no signature —
  the form adds those.

Reply with the letter body only. No preamble, no salutation, no sign-off.
`;

const RESUME_PARSE_PROMPT = `Extract a structured profile from this resume. The text below was pulled out of
a PDF, DOCX or plain-text file, so spacing and column order may be mangled.

## Resume text

{{resume}}

## Reply format

Reply with a single JSON object and nothing else:

{
  "fullName": <string or null>,
  "email": <string or null>,
  "phone": <string or null>,
  "location": <string or null>,
  "portfolio": <string or null>,
  "linkedin": <string or null>,
  "summary": <string or null>,
  "skills": [<strings>],
  "titles": [<strings>],
  "years": <number or null>
}

- Use null for anything the resume does not state. Never guess an email address,
  a phone number, or a name.
- \`skills\` are the concrete, nameable ones — tools, languages, frameworks,
  methods, domains. At most 12, ordered by how prominent they are in the resume.
  Skip generic filler like "communication" or "team player".
- \`titles\` are the job titles this person has actually held, most recent first.
- \`years\` is total professional experience, rounded to the nearest whole year,
  inferred from the employment dates. Null if the dates are not legible.
- \`summary\` is one sentence, under 120 characters, in the style
  "Six years · Product design · Design systems · Charlotte, NC" — the throughline
  of this person's career, not a pitch.
`;

const CLASSIFY_REPLY_PROMPT = `Classify this email, which arrived in reply to a job application.

## The application

Role: {{title}}
Company: {{company}}
Applied on: {{appliedAt}}

## The email

From: {{from}}
Subject: {{subject}}

{{body}}

## Reply format

Reply with a single JSON object and nothing else:

{
  "classification": "interview" | "rejected" | "acknowledgement" | "unrelated",
  "confidence": <number 0-1>,
  "reason": <string, one sentence>
}

- \`interview\` — they are proposing a conversation, a screen, an assessment, or
  asking for availability.
- \`rejected\` — they are declining, closing the role, or moving on with others.
- \`acknowledgement\` — an automated "we received your application" with no
  decision in it.
- \`unrelated\` — anything that is not about this application.

When the email is ambiguous, prefer \`acknowledgement\` and a low confidence over
guessing. A wrong \`rejected\` deletes a live opportunity from the candidate's
tracker.
`;

export const DEFAULT_PROMPTS: Record<PromptName, string> = {
  'score': SCORE_PROMPT,
  'cover-letter': COVER_LETTER_PROMPT,
  'resume-parse': RESUME_PARSE_PROMPT,
  'classify-reply': CLASSIFY_REPLY_PROMPT,
};

/**
 * Fills `{{name}}` placeholders.
 *
 * An unknown placeholder throws rather than rendering empty: a half-filled
 * prompt produces a confidently wrong score, which is worse than no score.
 */
export function renderPrompt(
  template: string,
  variables: Record<string, string | number>,
): string {
  const missing: string[] = [];
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in variables)) {
      missing.push(key);
      return '';
    }
    return String(variables[key]);
  });
  if (missing.length > 0) {
    throw new Error(`Prompt expects variables not provided: ${missing.join(', ')}`);
  }
  return rendered;
}
