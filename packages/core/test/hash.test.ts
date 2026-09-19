import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { randomId, sha256 } from '../src/hash.ts';

/**
 * The pipeline runs on a server and on a phone, and both must derive the same
 * dedupe key for the same posting or the phone re-scores everything the engine
 * has already seen. node:crypto is the reference implementation; these pin ours
 * to it, including the padding boundaries where a hand-written SHA-256 breaks.
 */
const reference = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

test('sha256 matches node:crypto for ordinary text', () => {
  for (const input of ['', 'a', 'abc', 'hello world', 'Senior Product Designer']) {
    assert.equal(sha256(input), reference(input), `mismatch for ${JSON.stringify(input)}`);
  }
});

test('sha256 matches node:crypto across the message-padding boundaries', () => {
  // A block is 64 bytes and the length field takes the last 8, so 55/56 and
  // 63/64/65 are where an off-by-one in the padding shows up.
  for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
    const input = 'x'.repeat(length);
    assert.equal(sha256(input), reference(input), `mismatch at length ${length}`);
  }
});

test('sha256 matches node:crypto for multi-byte and astral characters', () => {
  for (const input of ['café', '中文测试', 'héllo wörld', '👋 emoji 🌐 pairs', '\u0000\u0001']) {
    assert.equal(sha256(input), reference(input), `mismatch for ${JSON.stringify(input)}`);
  }
});

test('randomId returns well-formed, unique version 4 UUIDs', () => {
  const shape = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ids = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const id = randomId();
    assert.match(id, shape);
    ids.add(id);
  }
  assert.equal(ids.size, 2000, 'ids collided');
});
