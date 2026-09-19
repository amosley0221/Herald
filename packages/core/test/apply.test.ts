import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  BUILTIN_FIELD_RULES, fallbackFields, isManualOnlyHost, mapFields, mergeFieldRules, splitName,
} from '../dist/index.js';
import type { DiscoveredField, FieldContext, Profile } from '../dist/index.js';

/**
 * The guardrails, as tests.
 *
 * Herald promises three things it will not do, and two of them live here:
 * demographic and salary questions are never answered, and LinkedIn is never
 * automated. These are meant to be enforced in code rather than left to
 * configuration, which is only true if something checks.
 */

const profile: Profile = {
  fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '+1 704 555 0100',
  location: 'Charlotte, NC', portfolio: 'https://ada.example', linkedin: null,
  summary: 'Engineer', workAuthorization: 'US citizen', availability: 'Two weeks',
  resumeFileName: 'ada.pdf', skills: [], titles: [], updatedAt: new Date().toISOString(),
};

const context: FieldContext = { profile, coverLetter: 'Dear team', resumeFileName: 'ada.pdf' };

function field(partial: Partial<DiscoveredField> & { label: string }): DiscoveredField {
  return {
    selector: `#${partial.label.replace(/\W+/g, '')}`, name: partial.label, id: '',
    kind: 'text', required: false, options: [], ...partial,
  };
}

test('demographic and salary questions are never given a value', () => {
  const sensitive = [
    'Gender', 'What is your sex?', 'Race', 'Ethnicity', 'Are you Hispanic or Latino?',
    'Veteran status', 'Military service', 'Disability status',
    'Salary expectation', 'Desired compensation', 'Expected salary',
  ];

  for (const label of sensitive) {
    const [mapped] = mapFields([field({ label })], BUILTIN_FIELD_RULES, context);
    assert.equal(mapped?.value, '', `"${label}" must be left blank`);
    assert.equal(mapped?.skipped, true, `"${label}" must be marked skipped`);
  }
});

test('ordinary fields are filled from the profile', () => {
  const cases: Array<[string, string]> = [
    ['Full name', 'Ada Lovelace'],
    ['Email', 'ada@example.com'],
    ['Phone', '+1 704 555 0100'],
    ['Work authorization', 'US citizen'],
    ['Portfolio', 'https://ada.example'],
  ];
  for (const [label, expected] of cases) {
    const [mapped] = mapFields([field({ label })], BUILTIN_FIELD_RULES, context);
    assert.equal(mapped?.value, expected, `"${label}" should be filled`);
    assert.equal(mapped?.skipped, false);
  }
});

test('an unrecognised field is shown but left empty', () => {
  const [mapped] = mapFields([field({ label: 'What is your favourite colour?' })], BUILTIN_FIELD_RULES, context);
  assert.equal(mapped?.value, '', 'nothing is invented for a field Herald does not understand');
  assert.equal(mapped?.skipped, false, 'it is not a deliberate skip, just unknown');
  assert.equal(mapped?.label, 'What is your favourite colour?', 'the form\'s own wording is shown');
});

test('a higher-priority rule wins when two match', () => {
  // "First name" matches both the generic name rule and the first-name rule.
  const [mapped] = mapFields([field({ label: 'First name' })], BUILTIN_FIELD_RULES, context);
  assert.equal(mapped?.key, 'firstName');
  assert.equal(mapped?.value, 'Ada');
});

test('a skip rule cannot be overridden into filling a value by accident', () => {
  // Someone adding a rule for a differently-worded gender question must still
  // opt in explicitly; merging by key is what makes that deliberate.
  const merged = mergeFieldRules([]);
  const gender = merged.find((entry) => entry.key === 'eeoGender');
  assert.equal(gender?.skip, true, 'merging without overrides must not clear skip');
});

test('fallback fields never include a skipped rule', () => {
  const fields = fallbackFields(BUILTIN_FIELD_RULES, context);
  const keys = fields.map((entry) => entry.key);
  for (const forbidden of ['eeoGender', 'eeoRace', 'eeoVeteran', 'eeoDisability', 'salaryExpectation']) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must never be offered`);
  }
  assert.ok(keys.includes('fullName'), 'the ordinary fields are still offered');
});

test('LinkedIn is never automated', () => {
  for (const url of [
    'https://www.linkedin.com/jobs/view/123',
    'https://linkedin.com/jobs/view/123',
    'https://uk.linkedin.com/jobs/view/123',
  ]) {
    assert.equal(isManualOnlyHost(url), true, `${url} must route to the user`);
  }
  assert.equal(isManualOnlyHost('https://boards.greenhouse.io/acme/jobs/1'), false);
});

test('an unparseable apply URL is treated as manual, not automated', () => {
  assert.equal(isManualOnlyHost('not a url'), true);
  assert.equal(isManualOnlyHost(''), true);
});

test('splitName handles multi-part given names', () => {
  assert.deepEqual(splitName('Ada Lovelace'), { first: 'Ada', last: 'Lovelace' });
  assert.deepEqual(splitName('Mary Ann Evans'), { first: 'Mary Ann', last: 'Evans' });
  assert.deepEqual(splitName('Prince'), { first: 'Prince', last: '' });
  assert.deepEqual(splitName(null), { first: '', last: '' });
});
