import type { DiscoveredField } from './apply.js';

/**
 * Reading and filling an application form inside a web view.
 *
 * The engine drives a real browser with Playwright. The phone and desktop apps
 * cannot, so they load the form in a web view and run these scripts inside it.
 * The scripts are shared so all three agree on what a form field is, what
 * counts as a blocker, and — most importantly — that nothing here ever presses
 * Submit. Filling and sending are deliberately different acts: Herald does the
 * first, the user does the second, on the real page, having seen it.
 */

/** Things that mean Herald should hand the page back to the user. */
export const FORM_BLOCKERS: ReadonlyArray<{ selector: string; reason: string }> = [
  { selector: 'iframe[src*="recaptcha"]', reason: 'The form is protected by reCAPTCHA.' },
  { selector: 'iframe[src*="hcaptcha"]', reason: 'The form is protected by hCaptcha.' },
  { selector: '[class*="cf-turnstile"]', reason: 'The form is protected by Cloudflare Turnstile.' },
  { selector: 'iframe[title*="challenge" i]', reason: 'The form presents a challenge Herald cannot complete.' },
  { selector: 'input[type="password"]', reason: 'The form requires signing in to an account.' },
];

/** What the discovery script posts back out of the web view. */
export interface FormScanResult {
  type: 'herald:scan';
  url: string;
  blocked: string | null;
  fields: DiscoveredField[];
}

/** What the fill script posts back. */
export interface FormFillResult {
  type: 'herald:filled';
  filled: string[];
  missed: string[];
}

export type WebFormMessage = FormScanResult | FormFillResult;

/**
 * JavaScript that reads the form and posts it back.
 *
 * Injected as a string because that is the only channel a web view offers.
 * Written defensively: a page that throws here should hand back a blocked
 * result rather than leaving the caller waiting forever.
 */
export const DISCOVER_SCRIPT = `(function () {
  function post(payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }
    catch (e) { try { window.__heraldPost(JSON.stringify(payload)); } catch (e2) {} }
  }

  try {
    var blockers = ${JSON.stringify(FORM_BLOCKERS)};
    for (var i = 0; i < blockers.length; i++) {
      if (document.querySelector(blockers[i].selector)) {
        post({ type: 'herald:scan', url: location.href, blocked: blockers[i].reason, fields: [] });
        return;
      }
    }

    function labelFor(el) {
      if (el.id) {
        var tied = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (tied && tied.innerText.trim()) return tied.innerText.trim();
      }
      var wrapping = el.closest('label');
      if (wrapping && wrapping.innerText.trim()) return wrapping.innerText.trim();
      var aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim();
      if (el.getAttribute('aria-labelledby')) {
        var by = document.getElementById(el.getAttribute('aria-labelledby'));
        if (by && by.innerText.trim()) return by.innerText.trim();
      }
      if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
      // Last resort: the nearest preceding text, which is how plenty of older
      // ATS templates label their fields.
      var previous = el.previousElementSibling;
      while (previous) {
        if (previous.innerText && previous.innerText.trim()) return previous.innerText.trim().slice(0, 120);
        previous = previous.previousElementSibling;
      }
      return '';
    }

    function selectorFor(el, index) {
      if (el.id) return '#' + CSS.escape(el.id);
      if (el.name) return el.tagName.toLowerCase() + '[name="' + CSS.escape(el.name) + '"]';
      // Nothing stable to hold on to, so tag the element ourselves.
      var marker = 'herald-field-' + index;
      el.setAttribute('data-herald-field', marker);
      return '[data-herald-field="' + marker + '"]';
    }

    function kindFor(el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'textarea') return 'textarea';
      if (tag === 'select') return 'select';
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'email') return 'email';
      if (type === 'tel') return 'tel';
      if (type === 'url') return 'url';
      if (type === 'file') return 'file';
      if (type === 'checkbox' || type === 'radio') return 'boolean';
      return 'text';
    }

    var nodes = document.querySelectorAll('input, textarea, select');
    var fields = [];
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      var type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') continue;
      if (el.disabled) continue;
      // Genuinely invisible controls are page plumbing, not questions.
      if (!el.offsetParent && el.type !== 'file') continue;

      var options = [];
      if (el.tagName.toLowerCase() === 'select') {
        for (var k = 0; k < el.options.length; k++) {
          var text = el.options[k].text.trim();
          if (text) options.push(text);
        }
      }

      fields.push({
        selector: selectorFor(el, j),
        label: labelFor(el),
        name: el.name || '',
        id: el.id || '',
        kind: kindFor(el),
        required: Boolean(el.required || el.getAttribute('aria-required') === 'true'),
        options: options
      });
    }

    post({ type: 'herald:scan', url: location.href, blocked: null, fields: fields });
  } catch (error) {
    post({
      type: 'herald:scan', url: location.href, fields: [],
      blocked: 'Herald could not read this form: ' + (error && error.message ? error.message : 'unknown error')
    });
  }
})(); true;`;

/**
 * JavaScript that fills the reviewed values in.
 *
 * It does not submit, and it will not touch a file input: a web view cannot put
 * a file into one, and pretending otherwise would leave the user believing
 * their resume was attached when it was not.
 */
export function fillScript(values: Array<{ selector: string; value: string }>): string {
  return `(function () {
  function post(payload) {
    try { window.ReactNativeWebView.postMessage(JSON.stringify(payload)); }
    catch (e) { try { window.__heraldPost(JSON.stringify(payload)); } catch (e2) {} }
  }

  var wanted = ${JSON.stringify(values)};
  var filled = [];
  var missed = [];

  for (var i = 0; i < wanted.length; i++) {
    var entry = wanted[i];
    if (!entry.value) continue;
    var el = null;
    try { el = document.querySelector(entry.selector); } catch (e) {}
    if (!el) { missed.push(entry.selector); continue; }

    var tag = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();

    // A web view cannot populate a file input, and a half-filled one reads as
    // attached when it is not.
    if (type === 'file') { missed.push(entry.selector); continue; }

    if (tag === 'select') {
      var matched = false;
      for (var k = 0; k < el.options.length; k++) {
        if (el.options[k].text.trim().toLowerCase() === entry.value.trim().toLowerCase()) {
          el.selectedIndex = k; matched = true; break;
        }
      }
      if (!matched) { missed.push(entry.selector); continue; }
    } else if (type === 'checkbox' || type === 'radio') {
      el.checked = entry.value === 'true' || entry.value === 'yes';
    } else {
      // React and friends listen for input events rather than reading .value,
      // so setting the property alone leaves their state stale.
      var setter = Object.getOwnPropertyDescriptor(
        tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
        'value'
      );
      if (setter && setter.set) setter.set.call(el, entry.value);
      else el.value = entry.value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(entry.selector);
  }

  post({ type: 'herald:filled', filled: filled, missed: missed });
})(); true;`;
}

/** Parses a message out of the web view, or null when it is not ours. */
export function parseWebFormMessage(raw: string): WebFormMessage | null {
  try {
    const parsed = JSON.parse(raw) as WebFormMessage;
    if (parsed?.type === 'herald:scan' || parsed?.type === 'herald:filled') return parsed;
    return null;
  } catch {
    // Pages post all sorts of things to their own listeners; not ours.
    return null;
  }
}
