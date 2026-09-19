import { readFileSync, existsSync } from 'node:fs';
import { z } from 'zod';
import { BUILTIN_FIELD_RULES, mergeFieldRules, type FieldRule } from '@herald/core';

/**
 * Field rules moved to @herald/core so the phone and desktop apps map a form
 * the same way this does — most importantly, so the fields Herald refuses to
 * answer are refused everywhere. This keeps the zod validation of a user's
 * rules file, which core has no schema library for.
 */
export type { FieldRule, DiscoveredField, MappedField } from '@herald/core';
export { mapFields, fallbackFields, splitName } from '@herald/core';

const FieldRuleSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  match: z.array(z.string()).min(1),
  source: z.enum([
    'profile.fullName', 'profile.firstName', 'profile.lastName', 'profile.email',
    'profile.phone', 'profile.location', 'profile.portfolio', 'profile.linkedin',
    'profile.workAuthorization', 'profile.availability', 'profile.summary',
    'resume.file', 'coverLetter', 'literal',
  ]),
  value: z.string().optional(),
  kind: z.enum(['text', 'email', 'tel', 'url', 'file', 'select', 'textarea', 'boolean']).default('text'),
  required: z.boolean().default(false),
  skip: z.boolean().default(false),
  priority: z.number().int().default(0),
});

const FieldRulesSchema = z.object({ rules: z.array(FieldRuleSchema) });

/** Reads `config/field-rules.json`, falling back to the built-ins. */
export function loadFieldRules(path: string): FieldRule[] {
  if (!existsSync(path)) return BUILTIN_FIELD_RULES;
  try {
    const parsed = FieldRulesSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return mergeFieldRules(parsed.rules as FieldRule[]);
  } catch (cause) {
    throw new Error(`Could not read field rules at ${path}: ${(cause as Error).message}`);
  }
}
