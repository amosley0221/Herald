import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import type { ApplicationField, Profile } from '@herald/core';

/**
 * A rule matching one form field on a target site to one value Herald can
 * supply. Rules live in `config/field-rules.json` so a new ATS quirk is a
 * config edit, not a release.
 */
const FieldRuleSchema = z.object({
  /** Stable key used on the Review screen and in the log. */
  key: z.string().min(1),
  /** Label shown on the Review screen. */
  label: z.string().min(1),
  /** Regex (case-insensitive) matched against the field's label, name and id. */
  match: z.array(z.string()).min(1),
  /** Where the value comes from. */
  source: z.enum([
    'profile.fullName', 'profile.firstName', 'profile.lastName', 'profile.email',
    'profile.phone', 'profile.location', 'profile.portfolio', 'profile.linkedin',
    'profile.workAuthorization', 'profile.availability', 'profile.summary',
    'resume.file', 'coverLetter', 'literal',
  ]),
  /** Used when `source` is `literal`. */
  value: z.string().optional(),
  kind: z.enum(['text', 'email', 'tel', 'url', 'file', 'select', 'textarea', 'boolean']).default('text'),
  required: z.boolean().default(false),
  /**
   * Fields Herald must never fill, however they are labelled. Demographic and
   * EEO questions are the user's to answer or decline, not the engine's.
   */
  skip: z.boolean().default(false),
  /** Higher wins when two rules match the same field. */
  priority: z.number().int().default(0),
});

const FieldRulesSchema = z.object({
  rules: z.array(FieldRuleSchema),
});

export type FieldRule = z.infer<typeof FieldRuleSchema>;

/** Used when no rules file is present, so the engine still does something sane. */
const BUILTIN_RULES: FieldRule[] = FieldRulesSchema.parse({
  rules: [
    { key: 'fullName', label: 'Name', match: ['^full ?name', '^name$', 'your name'], source: 'profile.fullName', required: true, priority: 10 },
    { key: 'firstName', label: 'First name', match: ['first ?name', '^given'], source: 'profile.firstName', required: true, priority: 20 },
    { key: 'lastName', label: 'Last name', match: ['last ?name', 'surname', 'family ?name'], source: 'profile.lastName', required: true, priority: 20 },
    { key: 'email', label: 'Email', match: ['e-?mail'], source: 'profile.email', kind: 'email', required: true, priority: 10 },
    { key: 'phone', label: 'Phone', match: ['phone', 'mobile', 'telephone'], source: 'profile.phone', kind: 'tel', priority: 10 },
    { key: 'location', label: 'Location', match: ['location', 'city', 'where are you based', 'current address'], source: 'profile.location', priority: 5 },
    { key: 'resume', label: 'Resume', match: ['resume', 'cv', 'upload.*resume'], source: 'resume.file', kind: 'file', required: true, priority: 10 },
    { key: 'portfolio', label: 'Portfolio', match: ['portfolio', 'website', 'personal site'], source: 'profile.portfolio', kind: 'url', priority: 5 },
    { key: 'linkedin', label: 'LinkedIn', match: ['linkedin'], source: 'profile.linkedin', kind: 'url', priority: 10 },
    { key: 'coverLetter', label: 'Cover letter', match: ['cover ?letter', 'why do you want', 'tell us about yourself'], source: 'coverLetter', kind: 'textarea', priority: 10 },
    { key: 'authorization', label: 'Authorization', match: ['work authorization', 'authori[sz]ed to work', 'legally authori', 'require sponsorship', 'visa'], source: 'profile.workAuthorization', priority: 10 },
    { key: 'availability', label: 'Availability', match: ['availability', 'start date', 'notice period', 'when can you start'], source: 'profile.availability', priority: 10 },

    // Never answered automatically. Left blank for the user to handle on the
    // site itself; these are legally and personally theirs to decide.
    { key: 'eeoGender', label: 'Gender', match: ['gender', '\\bsex\\b'], source: 'literal', skip: true, priority: 100 },
    { key: 'eeoRace', label: 'Race', match: ['race', 'ethnicity', 'hispanic'], source: 'literal', skip: true, priority: 100 },
    { key: 'eeoVeteran', label: 'Veteran status', match: ['veteran', 'military'], source: 'literal', skip: true, priority: 100 },
    { key: 'eeoDisability', label: 'Disability status', match: ['disability', 'disabilit'], source: 'literal', skip: true, priority: 100 },
    { key: 'salaryExpectation', label: 'Salary expectation', match: ['salary expectation', 'desired (salary|compensation)', 'expected (salary|compensation)'], source: 'literal', skip: true, priority: 100 },
  ],
}).rules;

export function loadFieldRules(path: string): FieldRule[] {
  if (!existsSync(path)) return BUILTIN_RULES;
  try {
    const parsed = FieldRulesSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    // User rules are merged over the built-ins by key, so a rules file only has
    // to describe what it wants to change.
    const byKey = new Map(BUILTIN_RULES.map((rule) => [rule.key, rule]));
    for (const rule of parsed.rules) byKey.set(rule.key, rule);
    return [...byKey.values()];
  } catch (cause) {
    throw new Error(`Could not read field rules at ${path}: ${(cause as Error).message}`);
  }
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

/**
 * Matches each discovered control against the rules and fills in a value.
 *
 * Unmatched controls are still returned, with an empty value, so the Review
 * screen shows the user exactly what the form asks and nothing is filled in
 * behind their back.
 */
export function mapFields(
  discovered: DiscoveredField[],
  rules: FieldRule[],
  context: { profile: Profile; coverLetter: string | null; resumeFileName: string | null },
): MappedField[] {
  const compiled = rules.map((rule) => ({
    rule,
    patterns: rule.match.map((pattern) => new RegExp(pattern, 'i')),
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

    const value = matched.skip ? '' : resolveValue(matched, context);
    return {
      key: matched.key,
      label: matched.label,
      value,
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
export function fallbackFields(
  rules: FieldRule[],
  context: { profile: Profile; coverLetter: string | null; resumeFileName: string | null },
): MappedField[] {
  const wanted = ['fullName', 'email', 'phone', 'resume', 'portfolio', 'authorization', 'availability'];
  return wanted
    .map((key) => rules.find((rule) => rule.key === key))
    .filter((rule): rule is FieldRule => rule != null && !rule.skip)
    .map((rule) => ({
      key: rule.key,
      label: rule.label,
      value: resolveValue(rule, context),
      kind: rule.kind,
      required: rule.required,
      selector: null,
      skipped: false,
    }));
}

function resolveValue(
  rule: FieldRule,
  context: { profile: Profile; coverLetter: string | null; resumeFileName: string | null },
): string {
  const { profile, coverLetter, resumeFileName } = context;
  switch (rule.source) {
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
    case 'literal': return rule.value ?? '';
    default: return '';
  }
}

/** Splits a full name on the last space, which handles multi-part given names. */
export function splitName(fullName: string | null): { first: string; last: string } {
  if (!fullName?.trim()) return { first: '', last: '' };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0]!, last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1]! };
}
