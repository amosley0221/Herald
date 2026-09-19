import type { ApplicationField, Profile } from './types.js';

/**
 * Matching a form's fields to the things Herald knows about you.
 *
 * Shared by the engine, which reads forms with a real browser, and the phone
 * and desktop apps, which read them in a web view. The rules are the same
 * wherever the form is read, which matters most for the ones that deliberately
 * fill nothing in.
 */

export type FieldSource =
  | 'profile.fullName' | 'profile.firstName' | 'profile.lastName' | 'profile.email'
  | 'profile.phone' | 'profile.location' | 'profile.portfolio' | 'profile.linkedin'
  | 'profile.workAuthorization' | 'profile.availability' | 'profile.summary'
  | 'resume.file' | 'coverLetter' | 'literal';

/** One rule tying a form control to a value Herald can supply. */
export interface FieldRule {
  /** Stable key used on the Review screen and in the log. */
  key: string;
  label: string;
  /** Case-insensitive patterns matched against the control's label, name and id. */
  match: string[];
  source: FieldSource;
  /** Used when `source` is `literal`. */
  value?: string;
  kind: ApplicationField['kind'];
  required: boolean;
  /**
   * Controls Herald must never fill, however they are labelled. Demographic and
   * EEO questions, and salary expectations, are the user's to answer or decline.
   */
  skip: boolean;
  /** Higher wins when two rules match the same control. */
  priority: number;
}

function rule(partial: Pick<FieldRule, 'key' | 'label' | 'match' | 'source'> & Partial<FieldRule>): FieldRule {
  return { kind: 'text', required: false, skip: false, priority: 0, ...partial };
}

export const BUILTIN_FIELD_RULES: FieldRule[] = [
  rule({ key: 'fullName', label: 'Name', match: ['^full ?name', '^name$', 'your name'], source: 'profile.fullName', required: true, priority: 10 }),
  rule({ key: 'firstName', label: 'First name', match: ['first ?name', '^given'], source: 'profile.firstName', required: true, priority: 20 }),
  rule({ key: 'lastName', label: 'Last name', match: ['last ?name', 'surname', 'family ?name'], source: 'profile.lastName', required: true, priority: 20 }),
  rule({ key: 'email', label: 'Email', match: ['e-?mail'], source: 'profile.email', kind: 'email', required: true, priority: 10 }),
  rule({ key: 'phone', label: 'Phone', match: ['phone', 'mobile', 'telephone'], source: 'profile.phone', kind: 'tel', priority: 10 }),
  rule({ key: 'location', label: 'Location', match: ['location', 'city', 'where are you based', 'current address'], source: 'profile.location', priority: 5 }),
  rule({ key: 'resume', label: 'Resume', match: ['resume', 'cv', 'upload.*resume'], source: 'resume.file', kind: 'file', required: true, priority: 10 }),
  rule({ key: 'portfolio', label: 'Portfolio', match: ['portfolio', 'website', 'personal site'], source: 'profile.portfolio', kind: 'url', priority: 5 }),
  rule({ key: 'linkedin', label: 'LinkedIn', match: ['linkedin'], source: 'profile.linkedin', kind: 'url', priority: 10 }),
  rule({ key: 'coverLetter', label: 'Cover letter', match: ['cover ?letter', 'why do you want', 'tell us about yourself'], source: 'coverLetter', kind: 'textarea', priority: 10 }),
  rule({ key: 'authorization', label: 'Authorization', match: ['work authorization', 'authori[sz]ed to work', 'legally authori', 'require sponsorship', 'visa'], source: 'profile.workAuthorization', priority: 10 }),
  rule({ key: 'availability', label: 'Availability', match: ['availability', 'start date', 'notice period', 'when can you start'], source: 'profile.availability', priority: 10 }),

  // Never answered automatically. Left blank for the user to handle themselves;
  // these are legally and personally theirs to decide.
  rule({ key: 'eeoGender', label: 'Gender', match: ['gender', '\\bsex\\b'], source: 'literal', skip: true, priority: 100 }),
  rule({ key: 'eeoRace', label: 'Race', match: ['race', 'ethnicity', 'hispanic'], source: 'literal', skip: true, priority: 100 }),
  rule({ key: 'eeoVeteran', label: 'Veteran status', match: ['veteran', 'military'], source: 'literal', skip: true, priority: 100 }),
  rule({ key: 'eeoDisability', label: 'Disability status', match: ['disability', 'disabilit'], source: 'literal', skip: true, priority: 100 }),
  rule({ key: 'salaryExpectation', label: 'Salary expectation', match: ['salary expectation', 'desired (salary|compensation)', 'expected (salary|compensation)'], source: 'literal', skip: true, priority: 100 }),
];

/** Overrides merged over the built-ins by key, so a rules file only describes what it changes. */
export function mergeFieldRules(overrides: FieldRule[]): FieldRule[] {
  const byKey = new Map(BUILTIN_FIELD_RULES.map((builtin) => [builtin.key, builtin]));
  for (const override of overrides) byKey.set(override.key, override);
  return [...byKey.values()];
}

/** A form control discovered on the target page. */
export interface DiscoveredField {
  /** CSS selector that uniquely addresses the control. */
  selector: string;
  label: string;
  name: string;
  id: string;
  kind: ApplicationField['kind'];
  required: boolean;
  options: string[];
}

export interface MappedField extends ApplicationField {
  selector: string | null;
  /** True when a rule deliberately left this blank for the user. */
  skipped: boolean;
}

export interface FieldContext {
  profile: Profile;
  coverLetter: string | null;
  resumeFileName: string | null;
}

/**
 * Matches each discovered control against the rules and fills in a value.
 *
 * Unmatched controls are still returned, with an empty value, so the Review
 * screen shows exactly what the form asks and nothing is filled in behind the
 * user's back.
 */
export function mapFields(
  discovered: DiscoveredField[],
  rules: FieldRule[],
  context: FieldContext,
): MappedField[] {
  const compiled = rules.map((entry) => ({
    rule: entry,
    patterns: entry.match.map((pattern) => new RegExp(pattern, 'i')),
  }));

  return discovered.map((field) => {
    const haystack = `${field.label} ${field.name} ${field.id}`.trim();
    const matched = compiled
      .filter(({ patterns }) => patterns.some((pattern) => pattern.test(haystack)))
      .sort((a, b) => b.rule.priority - a.rule.priority)[0]?.rule;

    if (!matched) {
      return {
        key: field.name || field.id || field.selector,
        label: field.label || field.name || 'Field',
        value: '',
        kind: field.kind,
        required: field.required,
        ...(field.options.length ? { options: field.options } : {}),
        selector: field.selector,
        skipped: false,
      };
    }

    return {
      key: matched.key,
      label: matched.label,
      value: matched.skip ? '' : resolveValue(matched, context),
      kind: matched.kind === 'text' ? field.kind : matched.kind,
      required: field.required || matched.required,
      ...(field.options.length ? { options: field.options } : {}),
      selector: field.selector,
      skipped: matched.skip,
    };
  });
}

/**
 * The fields Herald can offer with no form to read — used when the apply page
 * cannot be loaded, so the Review screen still shows the user their data.
 */
export function fallbackFields(rules: FieldRule[], context: FieldContext): MappedField[] {
  const wanted = ['fullName', 'email', 'phone', 'resume', 'portfolio', 'authorization', 'availability'];
  return wanted
    .map((key) => rules.find((entry) => entry.key === key))
    .filter((entry): entry is FieldRule => entry != null && !entry.skip)
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      value: resolveValue(entry, context),
      kind: entry.kind,
      required: entry.required,
      selector: null,
      skipped: false,
    }));
}

function resolveValue(entry: FieldRule, context: FieldContext): string {
  const { profile, coverLetter, resumeFileName } = context;
  switch (entry.source) {
    case 'profile.fullName': return profile.fullName ?? '';
    case 'profile.firstName': return splitName(profile.fullName).first;
    case 'profile.lastName': return splitName(profile.fullName).last;
    case 'profile.email': return profile.email ?? '';
    case 'profile.phone': return profile.phone ?? '';
    case 'profile.location': return profile.location ?? '';
    case 'profile.portfolio': return profile.portfolio ?? '';
    case 'profile.linkedin': return profile.linkedin ?? '';
    case 'profile.workAuthorization': return profile.workAuthorization ?? '';
    case 'profile.availability': return profile.availability ?? '';
    case 'profile.summary': return profile.summary ?? '';
    case 'resume.file': return resumeFileName ?? '';
    case 'coverLetter': return coverLetter ?? '';
    case 'literal': return entry.value ?? '';
    default: return '';
  }
}

/** Splits a full name on the last space, which handles multi-part given names. */
export function splitName(fullName: string | null): { first: string; last: string } {
  if (!fullName?.trim()) return { first: '', last: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] as string, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] as string };
}

/**
 * Hosts Herald will not automate.
 *
 * Automating LinkedIn's Easy Apply violates their terms, so those postings are
 * routed to the user instead. This is enforced in code rather than left to
 * configuration.
 */
export const DEFAULT_MANUAL_ONLY_HOSTS = ['linkedin.com', 'www.linkedin.com'];

export function isManualOnlyHost(url: string, hosts: string[] = DEFAULT_MANUAL_ONLY_HOSTS): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return hosts.some((entry) => host === entry || host.endsWith(`.${entry}`));
  } catch {
    // An unparseable apply URL is not something to automate either.
    return true;
  }
}
