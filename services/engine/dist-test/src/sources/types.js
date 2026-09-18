/** Thrown when a source's `options` do not carry what its adapter needs. */
export class SourceConfigError extends Error {
    constructor(sourceId, message) {
        super(`Source "${sourceId}": ${message}`);
        this.name = 'SourceConfigError';
    }
}
export function requireString(source, key) {
    const value = source.options[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw new SourceConfigError(source.id, `options.${key} is required and must be a non-empty string`);
    }
    return value;
}
export function optionalString(source, key) {
    const value = source.options[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
export function stringList(source, key) {
    const value = source.options[key];
    if (value === undefined)
        return [];
    if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
        return value;
    if (typeof value === 'string')
        return [value];
    throw new SourceConfigError(source.id, `options.${key} must be a string or an array of strings`);
}
/** Best-effort remote detection from free text; adapters may override it. */
export function looksRemote(...fields) {
    const haystack = fields.filter(Boolean).join(' ').toLowerCase();
    return /\b(remote|work from home|wfh|distributed|anywhere)\b/.test(haystack);
}
/** Pulls a salary range out of free text when a source gives no structured pay. */
export function parsePayText(text) {
    const empty = { pay: null, payMin: null, payMax: null, payCurrency: null };
    if (!text)
        return empty;
    const match = /([$€£])\s?([\d,]+(?:\.\d+)?)\s?([kK])?\s*(?:-|–|—|to)\s*([$€£])?\s?([\d,]+(?:\.\d+)?)\s?([kK])?/.exec(text);
    if (!match)
        return { ...empty, pay: text.slice(0, 120) };
    const scale = (raw, k) => {
        const n = Number(raw.replace(/,/g, ''));
        return k ? n * 1000 : n;
    };
    const currency = match[1] === '€' ? 'EUR' : match[1] === '£' ? 'GBP' : 'USD';
    return {
        pay: match[0],
        payMin: scale(match[2], match[3]),
        payMax: scale(match[5], match[6]),
        payCurrency: currency,
    };
}
/** Strips HTML to plain text so the scoring prompt is not full of markup. */
export function htmlToText(html) {
    if (!html)
        return '';
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
        .replace(/[ \t]+/g, ' ')
        // The opening tag of a block becomes a space, so a line break produced by
        // its closing tag would otherwise be followed by one.
        .replace(/[ \t]*\n[ \t]*/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** Reads a dotted path such as `location.name` or `compensation[].min`. */
export function readPath(record, path) {
    let node = record;
    for (const segment of path.split('.')) {
        if (node == null)
            return undefined;
        if (segment.endsWith('[]')) {
            const key = segment.slice(0, -2);
            const arr = node[key];
            node = Array.isArray(arr) ? arr[0] : undefined;
        }
        else if (/^\d+$/.test(segment) && Array.isArray(node)) {
            node = node[Number(segment)];
        }
        else {
            node = node[segment];
        }
    }
    return node;
}
//# sourceMappingURL=types.js.map