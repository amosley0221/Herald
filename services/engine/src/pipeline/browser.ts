import { chromium, type Browser, type Page } from 'playwright';
import type { LoadedConfig } from '../config.js';
import type { Logger } from '../log.js';
import type { DiscoveredField, MappedField } from './form.js';

/** Raised when a page cannot be automated and the user has to finish it. */
export class ManualInterventionRequired extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'ManualInterventionRequired';
  }
}

/** Signals a CAPTCHA, login wall or bot check. Never worked around. */
const BLOCKERS: ReadonlyArray<{ selector: string; reason: string }> = [
  { selector: 'iframe[src*="recaptcha"]', reason: 'The form is protected by reCAPTCHA.' },
  { selector: 'iframe[src*="hcaptcha"]', reason: 'The form is protected by hCaptcha.' },
  { selector: '[class*="cf-turnstile"]', reason: 'The form is protected by Cloudflare Turnstile.' },
  { selector: 'iframe[title*="challenge" i]', reason: 'The form presents a challenge Herald cannot complete.' },
  { selector: 'input[type="password"]', reason: 'The form requires signing in to an account.' },
];

/**
 * Playwright wrapper for the two things Herald does in a browser: read an apply
 * form, and fill and submit one that the user has reviewed.
 *
 * The browser is launched lazily and reused, because starting Chromium costs a
 * second or two and a user approving several matches in a row should not pay it
 * every time.
 */
export class FormBrowser {
  private browser: Browser | null = null;

  constructor(
    private readonly config: LoadedConfig,
    private readonly log: Logger,
  ) {}

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  /** Loads the apply page and reports every control it asks the user to fill. */
  async discover(applyUrl: string): Promise<DiscoveredField[]> {
    return this.withPage(applyUrl, async (page) => {
      await this.assertAutomatable(page);
      return page.evaluate(collectFields);
    });
  }

  /**
   * Fills and submits a reviewed form.
   *
   * `fields` is what the user saw and confirmed on the Review screen — this
   * method never derives a value of its own, so what is submitted is exactly
   * what was shown.
   */
  async submit(
    applyUrl: string,
    fields: MappedField[],
    resumePath: string | null,
    screenshotPath: string | null,
  ): Promise<{ confirmationImage: string | null; confirmationText: string }> {
    return this.withPage(applyUrl, async (page) => {
      await this.assertAutomatable(page);

      for (const field of fields) {
        if (!field.selector || field.skipped || !field.value) continue;
        try {
          await this.fillOne(page, field, resumePath);
        } catch (cause) {
          // A single unfillable control should not abort a submission the user
          // has already approved; it is reported in the log instead.
          this.log.warn('could not fill field', { label: field.label, err: String(cause) });
        }
      }

      const submitButton = await findSubmitButton(page);
      if (!submitButton) {
        throw new ManualInterventionRequired('Herald could not find a submit button on the form.');
      }

      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: this.config.apply.timeoutMs }).catch(() => undefined),
        submitButton.click(),
      ]);
      // Single-page forms swap in a confirmation without a navigation, so give
      // the DOM a moment to settle before reading the result.
      await page.waitForTimeout(2_000);

      // A captcha that appears only on submit is still a captcha.
      await this.assertAutomatable(page);

      const confirmationText = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 2_000);
      let confirmationImage: string | null = null;
      if (screenshotPath && this.config.apply.screenshotConfirmations) {
        await page.screenshot({ path: screenshotPath, fullPage: true });
        confirmationImage = screenshotPath;
      }

      if (!looksConfirmed(confirmationText)) {
        throw new ManualInterventionRequired(
          'The form did not show a confirmation after submitting. Check the posting directly.',
        );
      }

      return { confirmationImage, confirmationText };
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async withPage<T>(url: string, work: (page: Page) => Promise<T>): Promise<T> {
    const browser = await this.launch();
    const context = await browser.newContext({
      // A real UA string: several ATS front-ends serve a degraded or blocked
      // page to obviously headless clients, and we need the same form a person
      // would see in order to show the user an accurate review.
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.apply.timeoutMs);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.config.apply.timeoutMs });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      return await work(page);
    } finally {
      await context.close();
    }
  }

  private async launch(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.log.debug('launching browser', { headless: this.config.apply.headless });
    this.browser = await chromium.launch({
      headless: this.config.apply.headless,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    return this.browser;
  }

  /** Throws if the page shows anything Herald must not attempt to get past. */
  private async assertAutomatable(page: Page): Promise<void> {
    for (const blocker of BLOCKERS) {
      if ((await page.locator(blocker.selector).count()) > 0) {
        throw new ManualInterventionRequired(blocker.reason);
      }
    }
  }

  private async fillOne(page: Page, field: MappedField, resumePath: string | null): Promise<void> {
    const locator = page.locator(field.selector!).first();
    if ((await locator.count()) === 0) return;

    switch (field.kind) {
      case 'file': {
        if (!resumePath) return;
        await locator.setInputFiles(resumePath);
        return;
      }
      case 'select': {
        // Match the option the user confirmed; fall back to a label match so a
        // trivially different casing does not drop the answer.
        try {
          await locator.selectOption({ label: field.value });
        } catch {
          await locator.selectOption({ value: field.value });
        }
        return;
      }
      case 'boolean': {
        const truthy = /^(yes|true|1)$/i.test(field.value);
        if (truthy) await locator.check();
        else await locator.uncheck();
        return;
      }
      default: {
        await locator.fill(field.value);
      }
    }
  }
}

/**
 * Runs inside the page. Returns one entry per control the form asks for, with
 * the best label we can find and a selector that addresses it uniquely.
 */
function collectFields(): DiscoveredField[] {
  const out: DiscoveredField[] = [];
  const seen = new Set<string>();

  const labelFor = (element: Element): string => {
    const id = element.getAttribute('id');
    if (id) {
      const explicit = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (explicit?.textContent) return explicit.textContent.trim();
    }
    const wrapping = element.closest('label');
    if (wrapping?.textContent) return wrapping.textContent.trim();
    const aria = element.getAttribute('aria-label');
    if (aria) return aria.trim();
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const target = document.getElementById(labelledBy);
      if (target?.textContent) return target.textContent.trim();
    }
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
    // Fall back to the nearest preceding text, which is how several ATS
    // templates associate a question with its input.
    const group = element.closest('div, fieldset, li');
    const heading = group?.querySelector('label, legend, .label, [class*="label"]');
    return heading?.textContent?.trim() ?? '';
  };

  const selectorFor = (element: Element, index: number): string => {
    const id = element.getAttribute('id');
    if (id) return `#${CSS.escape(id)}`;
    const name = element.getAttribute('name');
    if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
  };

  const controls = document.querySelectorAll('input, textarea, select');
  controls.forEach((element, index) => {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') ?? 'text').toLowerCase();
    if (tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;

    const selector = selectorFor(element, index);
    if (seen.has(selector)) return;
    seen.add(selector);

    let kind: DiscoveredField['kind'] = 'text';
    if (tag === 'textarea') kind = 'textarea';
    else if (tag === 'select') kind = 'select';
    else if (type === 'file') kind = 'file';
    else if (type === 'email') kind = 'email';
    else if (type === 'tel') kind = 'tel';
    else if (type === 'url') kind = 'url';
    else if (type === 'checkbox' || type === 'radio') kind = 'boolean';

    const options = tag === 'select'
      ? Array.from((element as HTMLSelectElement).options).map((option) => option.label || option.value).filter(Boolean)
      : [];

    out.push({
      selector,
      label: labelFor(element),
      name: element.getAttribute('name') ?? '',
      id: element.getAttribute('id') ?? '',
      kind,
      required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
      options,
    });
  });

  return out;
}

async function findSubmitButton(page: Page) {
  const candidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit application")',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Send application")',
    '[role="button"]:has-text("Submit")',
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible().catch(() => false))) return locator;
  }
  return null;
}

/** Heuristic read of whether the page says the application went through. */
export function looksConfirmed(text: string): boolean {
  const lowered = text.toLowerCase();
  const positives = [
    'thank you for applying',
    'thanks for applying',
    'application received',
    'application submitted',
    'we have received your application',
    "we've received your application",
    'successfully submitted',
    'your application has been',
    'thank you for your interest',
  ];
  if (positives.some((phrase) => lowered.includes(phrase))) return true;
  // An error banner is stronger evidence than a vague success word.
  const negatives = ['required field', 'please correct', 'there was a problem', 'is required'];
  return !negatives.some((phrase) => lowered.includes(phrase)) && lowered.includes('thank you');
}
