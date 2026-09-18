import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { collapse, contentHash, dedupeKey, normalizeCompany, normalizeTitle } from '../src/pipeline/dedupe.js';
import { prefilter, matchesAnyRole } from '../src/pipeline/prefilter.js';
import { startOfLocalDay } from '../src/pipeline/apply.js';
import { looksConfirmed } from '../src/pipeline/browser.js';
import { mapFields, fallbackFields, loadFieldRules, splitName } from '../src/pipeline/form.js';
import { extractJson } from '../src/llm/client.js';
import { extractContactDetails } from '../src/resume/parse.js';
import { resolvePostedOn } from '../src/sources/workday.js';
import { htmlToText, parsePayText, readPath, looksRemote } from '../src/sources/types.js';
const PREFERENCES = {
    roles: ['Product Designer'],
    locations: ['Charlotte, NC'],
    remote: true,
    minSalary: 110_000,
    threshold: 85,
    instant: true,
    digest: true,
    digestHour: 7,
    tailorLetter: true,
    dailySubmitCap: 15,
    timezone: 'America/New_York',
    seniority: [],
    excludeKeywords: ['contract'],
};
function posting(overrides = {}) {
    return {
        externalId: 'x1',
        title: 'Senior Product Designer',
        company: 'Duke Energy',
        location: 'Charlotte, NC',
        remote: false,
        pay: null,
        payMin: 128_000,
        payMax: 146_000,
        payCurrency: 'USD',
        url: 'https://example.com/jobs/1',
        applyUrl: 'https://example.com/jobs/1/apply',
        postedAt: new Date().toISOString(),
        description: 'We need someone to lead our design system.',
        raw: {},
        ...overrides,
    };
}
// ── Dedupe ──────────────────────────────────────────────────────────────────
test('title normalization collapses the ways one job gets written', () => {
    assert.equal(normalizeTitle('Sr. Product Designer (Remote)'), 'senior product designer');
    assert.equal(normalizeTitle('Senior Product Designer'), 'senior product designer');
    assert.equal(normalizeTitle('Product Designer II'), 'product designer 2');
    assert.equal(normalizeTitle('UX/UI Designer [Hybrid]'), 'ux ui designer');
});
test('company normalization ignores legal suffixes', () => {
    assert.equal(normalizeCompany('Acme, Inc.'), 'acme');
    assert.equal(normalizeCompany('Acme LLC'), 'acme');
    assert.equal(normalizeCompany('ACME'), 'acme');
});
test('the same job on two boards shares a dedupe key', () => {
    const greenhouse = posting({ title: 'Senior Product Designer', company: 'Duke Energy, Inc.' });
    const linkedin = posting({ title: 'Sr. Product Designer (Hybrid)', company: 'Duke Energy' });
    assert.equal(dedupeKey(greenhouse), dedupeKey(linkedin));
});
test('different jobs do not share a dedupe key', () => {
    assert.notEqual(dedupeKey(posting({ title: 'Product Designer' })), dedupeKey(posting({ title: 'Product Manager' })));
    assert.notEqual(dedupeKey(posting({ location: 'Charlotte, NC' })), dedupeKey(posting({ location: 'Austin, TX' })));
});
test('collapse keeps the highest-priority source', () => {
    const key = 'same-key';
    const winner = { dedupeKey: key, sourcePriority: 10, postedAt: '2026-09-18T10:00:00Z', id: 'greenhouse' };
    const loser = { dedupeKey: key, sourcePriority: 1, postedAt: '2026-09-18T09:00:00Z', id: 'aggregator' };
    const result = collapse([loser, winner]);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'greenhouse', 'the ATS original must beat the aggregator copy');
});
test('a new resume invalidates the score cache', () => {
    const p = posting();
    assert.notEqual(contentHash(p, 'resume-v1'), contentHash(p, 'resume-v2'));
    assert.equal(contentHash(p, 'resume-v1'), contentHash(p, 'resume-v1'));
});
// ── Prefilter ───────────────────────────────────────────────────────────────
test('prefilter keeps a posting that matches every preference', () => {
    assert.equal(prefilter(posting(), PREFERENCES, { maxPostingAgeDays: 30 }).keep, true);
});
test('prefilter drops on role, keyword, salary and staleness', () => {
    const cases = [
        ['role', posting({ title: 'Senior Product Manager' })],
        ['keyword', posting({ title: 'Product Designer (Contract)', company: 'Contract Co' })],
        ['salary', posting({ payMin: 60_000, payMax: 80_000 })],
        ['stale', posting({ postedAt: new Date(Date.now() - 60 * 86_400_000).toISOString() })],
        ['location', posting({ location: 'Austin, TX', remote: false })],
    ];
    for (const [label, p] of cases) {
        const verdict = prefilter(p, PREFERENCES, { maxPostingAgeDays: 30 });
        assert.equal(verdict.keep, false, `expected ${label} to be dropped`);
        assert.ok(verdict.reason, `${label} should say why`);
    }
});
test('a missing salary range is not treated as a low one', () => {
    const p = posting({ payMin: null, payMax: null, pay: null });
    assert.equal(prefilter(p, PREFERENCES, { maxPostingAgeDays: 30 }).keep, true);
});
test('empty preferences filter nothing out', () => {
    const open = { ...PREFERENCES, roles: [], locations: [], excludeKeywords: [], minSalary: null };
    assert.equal(prefilter(posting({ title: 'Warehouse Associate' }), open, { maxPostingAgeDays: 30 }).keep, true);
});
test('remote postings pass when the user is open to remote', () => {
    const p = posting({ location: 'Remote - US', remote: true });
    assert.equal(prefilter(p, PREFERENCES, { maxPostingAgeDays: 30 }).keep, true);
    assert.equal(prefilter(p, { ...PREFERENCES, remote: false }, { maxPostingAgeDays: 30 }).keep, false);
});
test('role matching requires every word, not any', () => {
    assert.ok(matchesAnyRole('senior product designer, growth', ['Product Designer']));
    assert.ok(!matchesAnyRole('product manager', ['Product Designer']));
});
// ── Form mapping ────────────────────────────────────────────────────────────
const PROFILE = {
    fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '(704) 555-0142',
    location: 'Charlotte, NC', portfolio: 'ada.design', linkedin: null, summary: null,
    skills: [], titles: [], years: 6, workAuthorization: 'US citizen',
    availability: 'Two weeks', resumeFileName: 'ada.pdf', resumeUpdatedAt: null,
};
test('form fields map onto profile values', () => {
    const rules = loadFieldRules('/nonexistent-so-builtins-are-used.json');
    const mapped = mapFields([
        { selector: '#first', label: 'First Name', name: 'first_name', id: 'first', kind: 'text', required: true, options: [] },
        { selector: '#email', label: 'Email', name: 'email', id: 'email', kind: 'email', required: true, options: [] },
        { selector: '#resume', label: 'Resume/CV', name: 'resume', id: 'resume', kind: 'file', required: true, options: [] },
        { selector: '#gender', label: 'Gender', name: 'gender', id: 'gender', kind: 'select', required: false, options: ['Male', 'Female'] },
    ], rules, { profile: PROFILE, coverLetter: 'Dear team', resumeFileName: 'ada.pdf' });
    const byKey = Object.fromEntries(mapped.map((f) => [f.key, f]));
    assert.equal(byKey.firstName.value, 'Ada');
    assert.equal(byKey.email.value, 'ada@example.com');
    assert.equal(byKey.resume.value, 'ada.pdf');
    // Demographic questions are never answered automatically.
    assert.equal(byKey.eeoGender.value, '');
    assert.equal(byKey.eeoGender.skipped, true);
});
test('unrecognised controls are surfaced blank rather than guessed at', () => {
    const rules = loadFieldRules('/nonexistent.json');
    const mapped = mapFields([{ selector: '#q1', label: 'What is your favourite typeface?', name: 'q1', id: 'q1', kind: 'text', required: false, options: [] }], rules, { profile: PROFILE, coverLetter: null, resumeFileName: null });
    assert.equal(mapped[0].value, '');
    assert.equal(mapped[0].label, 'What is your favourite typeface?');
});
test('fallback fields cover the Review screen when the form cannot be read', () => {
    const fields = fallbackFields(loadFieldRules('/nonexistent.json'), {
        profile: PROFILE, coverLetter: null, resumeFileName: 'ada.pdf',
    });
    const keys = fields.map((f) => f.key);
    for (const expected of ['fullName', 'email', 'phone', 'resume', 'authorization', 'availability']) {
        assert.ok(keys.includes(expected), `expected a ${expected} field`);
    }
});
test('name splitting handles multi-part given names', () => {
    assert.deepEqual(splitName('Ada Lovelace'), { first: 'Ada', last: 'Lovelace' });
    assert.deepEqual(splitName('Mary Anne Evans'), { first: 'Mary Anne', last: 'Evans' });
    assert.deepEqual(splitName('Prince'), { first: 'Prince', last: '' });
    assert.deepEqual(splitName(null), { first: '', last: '' });
});
// ── Parsing helpers ─────────────────────────────────────────────────────────
test('JSON is extracted from a fenced or chatty reply', () => {
    assert.equal(extractJson('```json\n{"score":91}\n```'), '{"score":91}');
    assert.equal(extractJson('Here you go: {"score":91} — hope that helps'), '{"score":91}');
    assert.equal(extractJson('{"a":{"b":1}}'), '{"a":{"b":1}}');
    // A brace inside a string must not terminate the object early.
    assert.equal(extractJson('{"why":["a } b"],"score":1}'), '{"why":["a } b"],"score":1}');
});
test('contact details are extracted deterministically', () => {
    const resume = `Ada Lovelace
ada@example.com | (704) 555-0142 | linkedin.com/in/adalovelace | ada.design
Charlotte, NC`;
    const details = extractContactDetails(resume);
    assert.equal(details.fullName, 'Ada Lovelace');
    assert.equal(details.email, 'ada@example.com');
    assert.equal(details.phone, '(704) 555-0142');
    assert.match(details.linkedin ?? '', /adalovelace/);
    // The email's own domain must never be mistaken for a personal site.
    assert.equal(details.portfolio, 'ada.design');
});
test('a resume with no personal site yields no portfolio', () => {
    const details = extractContactDetails('Ada Lovelace\nada@example.com | (704) 555-0142');
    assert.equal(details.portfolio, null);
});
test('no contact details are invented when none are present', () => {
    const details = extractContactDetails('Experienced designer with six years in the field.');
    assert.equal(details.email, null);
    assert.equal(details.phone, null);
    assert.equal(details.fullName, null);
});
test('workday relative dates resolve, and unknown phrasing is rejected', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    assert.ok(resolvePostedOn('Posted Today', now));
    const threeDays = resolvePostedOn('Posted 3 Days Ago', now);
    assert.ok(threeDays && threeDays < now);
    assert.equal(resolvePostedOn('Posted recently', now), null);
    assert.equal(resolvePostedOn(undefined, now), null);
});
test('pay text parsing', () => {
    assert.deepEqual(parsePayText('$128,000 - $146,000'), {
        pay: '$128,000 - $146,000', payMin: 128000, payMax: 146000, payCurrency: 'USD',
    });
    assert.deepEqual(parsePayText('$128k – $146k'), {
        pay: '$128k – $146k', payMin: 128000, payMax: 146000, payCurrency: 'USD',
    });
    assert.equal(parsePayText(null).payMin, null);
});
test('html is reduced to readable text', () => {
    assert.equal(htmlToText('<p>Hello</p><p>World</p>'), 'Hello\nWorld');
    assert.equal(htmlToText('<script>evil()</script><p>Safe</p>'), 'Safe');
    assert.equal(htmlToText('A&nbsp;&amp;&nbsp;B'), 'A & B');
});
test('dotted paths read nested values', () => {
    const record = { a: { b: [{ c: 1 }] }, list: [{ x: 'first' }] };
    assert.equal(readPath(record, 'a.b.0.c'), 1);
    assert.equal(readPath(record, 'list[].x'), 'first');
    assert.equal(readPath(record, 'a.missing.deep'), undefined);
});
test('remote detection', () => {
    assert.ok(looksRemote('Remote - US'));
    assert.ok(looksRemote('Anywhere'));
    assert.ok(!looksRemote('Charlotte, NC'));
});
// ── Guardrails ──────────────────────────────────────────────────────────────
test('the daily cap window starts at local midnight', () => {
    const now = new Date('2026-09-18T04:30:00Z'); // 00:30 in New York
    const start = new Date(startOfLocalDay('America/New_York', now));
    assert.ok(start <= now);
    // Half an hour past local midnight means the window opened half an hour ago.
    assert.ok(now.getTime() - start.getTime() < 3_600_000);
});
test('a confirmation page is recognised, an error page is not', () => {
    assert.ok(looksConfirmed('Thank you for applying! We have received your application.'));
    assert.ok(looksConfirmed('Your application has been submitted.'));
    assert.ok(!looksConfirmed('Email is required. Please correct the errors below.'));
    assert.ok(!looksConfirmed('Senior Product Designer — apply now'));
});
//# sourceMappingURL=pipeline.test.js.map