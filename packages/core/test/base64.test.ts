import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { base64ToBytes, base64ToUtf8, parseModelJson } from '../src/base64.ts';

/**
 * React Native has no Buffer and its atob is Latin-1 only, so these are
 * hand-written. Node's Buffer is the reference: a resume that decodes
 * differently on the phone is a resume the model reads wrong.
 */
test('base64ToUtf8 matches Buffer for text, including accents and emoji', () => {
  const inputs = [
    '', 'a', 'ab', 'abc', 'abcd', 'hello world',
    'café', 'naïve résumé', '中文测试', '👋 emoji 🌐 pairs',
    'Ada Lovelace\nSenior Engineer\nada@example.com',
    'x'.repeat(1000),
  ];
  for (const input of inputs) {
    const encoded = Buffer.from(input, 'utf8').toString('base64');
    assert.equal(base64ToUtf8(encoded), input, `mismatch for ${JSON.stringify(input)}`);
  }
});

test('base64ToBytes matches Buffer for binary, across every padding length', () => {
  for (let length = 0; length < 40; length++) {
    const bytes = Buffer.from(
      Array.from({ length }, (_unused, index) => (index * 37 + 11) % 256),
    );
    const decoded = base64ToBytes(bytes.toString('base64'));
    assert.deepEqual([...decoded], [...bytes], `mismatch at length ${length}`);
  }
});

test('base64ToUtf8 tolerates the line breaks some encoders insert', () => {
  const text = 'a longer line of text that an encoder may wrap at 76 characters, as MIME does';
  const wrapped = (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\n');
  assert.equal(base64ToUtf8(wrapped), text);
});

test('parseModelJson reads bare, fenced and prefixed replies', () => {
  const want = { score: 87, why: ['a'], gaps: [] };
  const shapes = [
    JSON.stringify(want),
    '```json\n' + JSON.stringify(want) + '\n```',
    '```\n' + JSON.stringify(want) + '\n```',
    'Here is the score:\n' + JSON.stringify(want),
    '  ' + JSON.stringify(want) + '  \n',
  ];
  for (const shape of shapes) {
    assert.deepEqual(parseModelJson(shape), want, `failed for ${JSON.stringify(shape)}`);
  }
});

test('parseModelJson throws rather than inventing a score', () => {
  for (const reply of ['', 'I cannot score this posting.', 'null', '{ broken']) {
    assert.throws(() => parseModelJson(reply), /did not return JSON/);
  }
});
