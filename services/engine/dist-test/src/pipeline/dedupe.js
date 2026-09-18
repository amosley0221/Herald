import { createHash } from 'node:crypto';
/** Field separator for hash inputs; a NUL cannot occur inside any of the parts. */
const SEP = String.fromCharCode(0);
/**
 * Words that change how a title reads to a human but not what the job is.
 * Stripping them makes "Sr. Product Designer (Remote)" and "Senior Product
 * Designer" collapse onto the same key.
 */
const TITLE_NOISE = [
    /\((?:remote|hybrid|on-?site|contract|full[- ]?time|part[- ]?time|[^)]*\b(?:US|USA|EMEA|LATAM)\b[^)]*)\)/gi,
    /\b(?:f\/m\/d|m\/f\/d|m\/w\/d|w\/m\/d)\b/gi,
    /\[[^\]]*\]/g,
    /[–—-]\s*(?:remote|hybrid|on-?site|contract)\b.*$/gi,
];
const TITLE_SYNONYMS = [
    [/\bsr\.?\b/gi, 'senior'],
    [/\bjr\.?\b/gi, 'junior'],
    [/\bmgr\.?\b/gi, 'manager'],
    [/\beng\.?\b/gi, 'engineer'],
    [/\bdev\b/gi, 'developer'],
    [/\bux\/ui\b/gi, 'ux ui'],
    [/\bui\/ux\b/gi, 'ux ui'],
    [/\bii\b/gi, '2'],
    [/\biii\b/gi, '3'],
    [/\biv\b/gi, '4'],
];
/** Company suffixes that vary between how an ATS and an aggregator spell it. */
const COMPANY_NOISE = /\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|nv|bv|ag|pte|pty|holdings|group)\b\.?/gi;
export function normalizeTitle(title) {
    let out = title.toLowerCase();
    for (const pattern of TITLE_NOISE)
        out = out.replace(pattern, ' ');
    for (const [pattern, replacement] of TITLE_SYNONYMS)
        out = out.replace(pattern, replacement);
    return out.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function normalizeCompany(company) {
    return company
        .toLowerCase()
        .replace(COMPANY_NOISE, ' ')
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Reduces a location to the part that distinguishes one posting from another.
 * Country and state suffixes vary wildly between sources, so we keep the first
 * segment (usually the city) and drop the rest.
 */
export function normalizeLocation(location, remote) {
    if (remote)
        return 'remote';
    const trimmed = location.toLowerCase().trim();
    if (!trimmed)
        return '';
    if (/\b(remote|anywhere)\b/.test(trimmed))
        return 'remote';
    const first = trimmed.split(/[,|/·]/)[0] ?? trimmed;
    return first.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * Hash of (company, normalized title, location). Two postings sharing this key
 * are treated as the same job listed in two places.
 */
export function dedupeKey(posting) {
    const parts = [
        normalizeCompany(posting.company),
        normalizeTitle(posting.title),
        normalizeLocation(posting.location, posting.remote),
    ];
    return createHash('sha256').update(parts.join(SEP)).digest('hex').slice(0, 32);
}
/**
 * Hash identifying the posting *content* for the score cache. Includes the
 * description so that a re-posted job with rewritten requirements is scored
 * again rather than served a stale verdict.
 */
export function contentHash(posting, resumeFingerprint) {
    return createHash('sha256')
        .update([
        normalizeCompany(posting.company),
        normalizeTitle(posting.title),
        posting.location.toLowerCase().trim(),
        posting.description.trim(),
        // A new resume invalidates every cached score, which is what we want.
        resumeFingerprint,
    ].join(SEP))
        .digest('hex');
}
export function fingerprint(text) {
    return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
/**
 * Collapses a batch of postings that share a dedupe key down to one winner.
 * Highest source priority wins, then the earliest posting date — an aggregator
 * copy should always lose to the ATS original it was scraped from.
 */
export function collapse(postings) {
    const best = new Map();
    for (const posting of postings) {
        const incumbent = best.get(posting.dedupeKey);
        if (!incumbent || wins(posting, incumbent))
            best.set(posting.dedupeKey, posting);
    }
    return [...best.values()];
}
function wins(candidate, incumbent) {
    if (candidate.sourcePriority !== incumbent.sourcePriority) {
        return candidate.sourcePriority > incumbent.sourcePriority;
    }
    return candidate.postedAt < incumbent.postedAt;
}
//# sourceMappingURL=dedupe.js.map