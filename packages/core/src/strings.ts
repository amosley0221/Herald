/**
 * Every user-facing string in both clients.
 *
 * Copy is final per the handoff, so it lives in one place rather than inline in
 * components — that keeps the Android and desktop wording identical and makes
 * translation a matter of adding a second table, not touching any screen.
 */

export const strings = {
  brand: {
    wordmark: 'HERALD',
    emblemAlt: 'Herald emblem',
  },

  nav: {
    today: 'Today',
    matches: 'Matches',
    tracker: 'Tracker',
    preferences: 'Preferences',
  },

  onboarding: {
    stepOf: (step: number, total: number) => `Step ${roman(step)} of ${roman(total)}`,
    upload: {
      body: 'Provide your resume. Herald reads every posting published today against it and brings you only the ones worth your time.',
      cta: 'Upload resume',
      formats: 'PDF · DOCX · TXT',
      footer: 'Nothing is submitted without your approval. Ever.',
      error: 'That file could not be read. Try a PDF, DOCX or TXT.',
    },
    parsing: {
      steps: [
        'Reading document',
        'Extracting experience',
        'Mapping skills',
        'Building your profile',
        'Profile ready',
      ],
      continue: 'Continue',
      /** e.g. "Six years · Product design · Design systems · Charlotte, NC" */
      summaryFallback: 'Profile built from your resume.',
    },
    threshold: {
      label: 'Approval threshold',
      explainer: 'and above notify you instantly. The rest wait for the morning digest.',
      instant: 'Instant notifications',
      digest: (time: string) => `Morning digest · ${time}`,
      tailor: 'Tailor cover letter per posting',
      cta: 'Begin the search',
    },
  },

  notification: {
    title: 'HERALD',
    now: 'now',
    body: 'Strong match. Approve to prepare the application for your review.',
    approve: 'Approve',
    view: 'View',
    skip: 'Skip',
    digestTitle: 'Morning digest',
    digestBody: (n: number) =>
      n === 1 ? '1 match waiting for you.' : `${n} matches waiting for you.`,
    needsYou: 'Finish this one yourself',
    needsYouBody: (company: string) => `${company} requires a step Herald cannot take.`,
  },

  today: {
    title: 'Today',
    stats: { read: 'Read', matched: 'Matched', applied: 'Applied', pending: 'Pending' },
    /** The summary sentence under the stat grid. */
    sentence: (read: string, instant: number) =>
      `Herald read ${read} postings published since yesterday. ${instant} cleared your threshold and were sent to you directly; the remainder wait below in the digest.`,
    awaiting: (n: number) => `Awaiting approval · ${n}`,
    empty: 'No postings read yet. The first crawl runs within the hour.',
    emptyPending: 'Nothing is waiting on you.',
    updateAvailable: (version: string) => `Version ${version} is available`,
    updateAction: 'Install',
    updatedToast: (version: string) => `Updated to ${version} · What's new`,
  },

  matches: {
    title: 'Matches',
    pending: (n: number) => `${n} pending`,
    approveNow: (threshold: number) => `Approve now · ${threshold}+`,
    digest: (time: string) => `Morning digest · ${time}`,
    empty: 'No matches yet. Herald is still reading.',
    emptyAboveThreshold: 'Nothing above your threshold right now.',
  },

  detail: {
    back: '← Matches',
    why: 'Why it fits',
    gaps: 'Where it does not',
    meta: {
      location: 'Location',
      compensation: 'Compensation',
      source: 'Source',
      posted: 'Posted',
    },
    approve: 'Approve · prepare application',
    skip: 'Skip',
    preparing: 'Preparing application…',
  },

  review: {
    title: 'Review before submitting',
    /** `Role · Company · via Source` */
    subtitle: (role: string, company: string, source: string) => `${role} · ${company} · via ${source}`,
    coverLetter: 'Cover letter · tailored',
    submit: 'Submit application',
    back: 'Back',
    submitting: 'Submitting…',
    degraded: 'Herald could not read the full form. Check every field before submitting.',
    manualOnly: 'This source must be completed by hand. Open the posting to finish it.',
    openPosting: 'Open posting',
    fields: {
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      resume: 'Resume',
      portfolio: 'Portfolio',
      authorization: 'Authorization',
      availability: 'Availability',
    },
  },

  tracker: {
    title: 'Tracker',
    applied: (n: number) => `${n} applied`,
    empty: 'Nothing submitted yet.',
  },

  preferences: {
    title: 'Preferences',
    roles: 'Roles',
    addRole: 'Add role',
    location: 'Location',
    minSalary: 'Minimum salary',
    threshold: 'Approval threshold',
    dailyCap: 'Daily submission cap',
    sourcesFootnote: (count: number, named: string) =>
      `Sources · ${named} and ${count} others. Refreshed hourly.`,
    about: 'About / What’s new',
    signOut: 'Disconnect engine',
  },

  releases: {
    title: 'What’s new',
    back: '← Preferences',
    current: (version: string) => `You are on ${version}`,
    patch: (n: number) => `Patch ${n}`,
    empty: 'No releases published yet.',
    checking: 'Checking for updates…',
    upToDate: 'Herald is up to date.',
    downloading: 'Downloading…',
    restartToApply: 'Update ready · restart to apply',
  },

  setup: {
    title: 'Set Herald up',
    body: 'Herald can run entirely on this phone, or let something always-on do the scanning for it.',
    onDevice: 'Run on this phone',
    onDeviceBody: 'Herald scans, scores and tracks on this device. It needs an Anthropic API key, which stays in this phone\u2019s keystore and is sent only to Anthropic.',
    apiKey: 'Anthropic API key',
    apiKeyHint: 'From console.anthropic.com. Scoring, cover letters and reading your resume all use it.',
    start: 'Start',
    useEngine: 'Connect to an engine instead',
    engineTitle: 'Connect to your engine',
    engineBody: 'Scan the pairing code shown on the desktop app, or enter the address and token by hand.',
    back: 'Back',
    scan: 'Scan pairing code',
    manual: 'Enter manually',
    baseUrl: 'Engine address',
    token: 'Access token',
    connect: 'Connect',
    failed: 'Could not reach the engine at that address.',
    pairingTitle: 'Pair your phone',
    pairingBody: 'Open Herald on your phone and scan this code.',
  },

  toast: {
    skipped: (company: string) => `Skipped · ${company}`,
    submitted: (company: string) => `Application submitted · ${company}`,
    failed: (company: string) => `Submission failed · ${company}`,
    approved: (company: string) => `Approved · ${company}`,
    saved: 'Preferences saved',
    capReached: (cap: number) => `Daily cap of ${cap} reached`,
  },

  errors: {
    offline: 'Cannot reach the engine.',
    retry: 'Retry',
    generic: 'Something went wrong.',
  },
} as const;

/** Local roman helper so `strings` has no import cycle with `format`. */
function roman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let rest = n;
  let out = '';
  for (const [value, numeral] of table) {
    while (rest >= value) { out += numeral; rest -= value; }
  }
  return out;
}

export type Strings = typeof strings;
