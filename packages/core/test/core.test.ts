import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { toRoman, heraldDate, relativeTime, payRange, joinMeta, thousands } from '../src/format.ts';
import { androidVersionCode, compareVersions, isNewer, parseVersion } from '../src/version.ts';
import { canTransition, routesInstantly, statusTone, isSubmitted } from '../src/status.ts';

test('roman numerals', () => {
  assert.equal(toRoman(2026), 'MMXXVI');
  assert.equal(toRoman(9), 'IX');
  assert.equal(toRoman(3), 'III');
  assert.equal(toRoman(1), 'I');
  assert.equal(toRoman(3999), 'MMMCMXCIX');
  // Out of range falls back to arabic rather than throwing in a render path.
  assert.equal(toRoman(0), '0');
  assert.equal(toRoman(4000), '4000');
});

test('herald dateline matches the Today screen format', () => {
  const date = new Date('2026-09-18T12:00:00Z');
  assert.equal(heraldDate(date, 'UTC'), '18 · IX · MMXXVI');
});

test('relative time buckets', () => {
  const now = new Date('2026-09-18T12:00:00Z');
  assert.equal(relativeTime(new Date('2026-09-18T11:59:30Z'), now), 'now');
  assert.equal(relativeTime(new Date('2026-09-18T10:00:00Z'), now), '2h ago');
  assert.equal(relativeTime(new Date('2026-09-15T12:00:00Z'), now), '3d ago');
});

test('pay range formatting', () => {
  assert.equal(payRange(128000, 146000, 'USD', null), '$128k – $146k');
  assert.equal(payRange(null, null, 'USD', '$90/hr'), '$90/hr');
  assert.equal(payRange(110000, null, 'USD', null), 'From $110k');
  assert.equal(payRange(null, 95000, 'EUR', null), 'Up to €95k');
});

test('meta joining drops empty parts', () => {
  assert.equal(joinMeta('Duke Energy', 'Charlotte, NC'), 'Duke Energy · Charlotte, NC');
  assert.equal(joinMeta('Duke Energy', null, undefined, ''), 'Duke Energy');
  assert.equal(thousands(2418), '2,418');
});

test('version parsing and ordering', () => {
  assert.deepEqual(parseVersion('v1.4.2'), { major: 1, minor: 4, patch: 2, prerelease: null });
  assert.equal(parseVersion('nope'), null);
  assert.ok(compareVersions('1.5.0', '1.4.9') > 0);
  assert.ok(compareVersions('1.4.2', '1.4.2') === 0);
  // A release outranks its own prerelease.
  assert.ok(compareVersions('1.4.2', '1.4.2-rc.1') > 0);
  assert.ok(isNewer('2.0.0', '1.99.99'));
  assert.ok(!isNewer('1.0.0', '1.0.0'));
});

test('android version codes increase monotonically with the tag', () => {
  assert.equal(androidVersionCode('1.4.2'), 1_004_002);
  assert.ok(androidVersionCode('1.5.0') > androidVersionCode('1.4.99'));
  assert.ok(androidVersionCode('2.0.0') > androidVersionCode('1.999.999'));
  assert.throws(() => androidVersionCode('1.1000.0'));
});

test('status machine rejects impossible transitions', () => {
  assert.ok(canTransition('pending', 'approved'));
  assert.ok(canTransition('approved', 'applied'));
  assert.ok(!canTransition('pending', 'applied'), 'approve must precede submit');
  assert.ok(!canTransition('rejected', 'applied'));
  assert.ok(canTransition('needs_you', 'applied'));
});

test('routing and tone', () => {
  assert.ok(routesInstantly(94, 85));
  assert.ok(routesInstantly(85, 85), 'threshold is inclusive');
  assert.ok(!routesInstantly(84, 85));
  assert.equal(statusTone('applied'), 'solid');
  assert.equal(statusTone('interview'), 'success');
  assert.ok(isSubmitted('interview'));
  assert.ok(!isSubmitted('approved'));
});
