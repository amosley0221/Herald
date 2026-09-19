import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DISCOVER_SCRIPT, FORM_BLOCKERS, fillScript, parseWebFormMessage,
} from '../dist/index.js';

/**
 * These scripts are strings that run inside someone else's page, so the
 * compiler never sees them. A quoting mistake in the template literal would
 * surface as a silently dead web view on a real application form — the worst
 * place to find out. Parsing them here is the check the type system cannot do.
 */

test('the discovery script is syntactically valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(DISCOVER_SCRIPT));
});

test('the fill script is valid for every shape of value', () => {
  const awkward = [
    { selector: '#name', value: "O'Brien" },
    { selector: '#quote', value: 'She said "hello"' },
    { selector: '#backslash', value: 'C:\\Users\\ada' },
    { selector: '#newline', value: 'line one\nline two' },
    { selector: '#unicode', value: 'café 中文 👋' },
    { selector: '#empty', value: '' },
    // A page could name a field anything; the script must not be escapable.
    { selector: '#x", value: "pwned', value: '</script><script>alert(1)</script>' },
    { selector: '#tpl', value: '${process.env.SECRET}' },
  ];
  assert.doesNotThrow(() => new Function(fillScript(awkward)));
});

test('the fill script embeds values as data, not as code', () => {
  const script = fillScript([{ selector: '#a', value: '"); alert(1); ("' }]);
  // The payload must survive as a JSON string literal rather than closing it.
  assert.ok(script.includes(JSON.stringify([{ selector: '#a', value: '"); alert(1); ("' }])));
  assert.doesNotThrow(() => new Function(script));
});

test('neither script presses submit', () => {
  // Filling and sending are deliberately different acts. If a change ever makes
  // the web view submit on the user's behalf, this is where it should fail.
  for (const script of [DISCOVER_SCRIPT, fillScript([{ selector: '#a', value: 'b' }])]) {
    assert.ok(!/\.submit\s*\(/.test(script), 'must not call form.submit()');
    assert.ok(!/\.click\s*\(/.test(script), 'must not click anything');
    assert.ok(!/type=["']submit/.test(script), 'must not seek out a submit button');
  }
});

test('the fill script refuses file inputs', () => {
  const script = fillScript([{ selector: '#resume', value: 'ada.pdf' }]);
  assert.ok(
    script.includes("type === 'file'"),
    'a web view cannot attach a file, and a half-filled input reads as attached',
  );
});

test('every blocker has a selector and a reason a person can act on', () => {
  assert.ok(FORM_BLOCKERS.length > 0);
  for (const blocker of FORM_BLOCKERS) {
    assert.ok(blocker.selector.length > 0);
    assert.match(blocker.reason, /\.$/, 'reasons are shown to the user, so they read as sentences');
  }
  const reasons = FORM_BLOCKERS.map((blocker) => blocker.reason).join(' ');
  for (const expected of ['reCAPTCHA', 'hCaptcha', 'Turnstile', 'signing in']) {
    assert.ok(reasons.includes(expected), `${expected} must be treated as a blocker`);
  }
});

test('parseWebFormMessage accepts our messages and ignores the page\'s', () => {
  const scan = { type: 'herald:scan', url: 'https://x', blocked: null, fields: [] };
  assert.deepEqual(parseWebFormMessage(JSON.stringify(scan)), scan);

  const filled = { type: 'herald:filled', filled: ['#a'], missed: [] };
  assert.deepEqual(parseWebFormMessage(JSON.stringify(filled)), filled);

  for (const noise of ['', 'not json', '{}', '{"type":"something-else"}', 'null', '[]']) {
    assert.equal(parseWebFormMessage(noise), null, `${noise} is not ours`);
  }
});
