import type { SourceConfig } from './types.js';
import {
  htmlToText, looksRemote, parsePayText, readPath, requireString,
  type FetchContext, type RawPosting, type SourceAdapter, SourceConfigError,
} from './types.js';

/**
 * Generic JSON adapter — the escape hatch that keeps new sources out of code.
 *
 * Point `options.url` at any endpoint returning JSON, tell it where the array
 * of postings lives (`options.listPath`), and map the fields with `fieldMap`.
 * Paging is optional and driven entirely by config.
 *
 *   {
 *     "id": "acme",
 *     "adapter": "json",
 *     "options": {
 *       "url": "https://acme.example/api/jobs?page={page}",
 *       "listPath": "data.results",
 *       "pageParam": "page", "pageStart": 1, "maxPages": 5
 *     },
 *     "fieldMap": { "title": "name", "company": "org.name", "url": "links.self" }
 *   }
 *
 * A URL may also carry `{query}`, `{location}` and `{since}`, which is what
 * turns this from a feed reader into a search client: the same definition then
 * asks an aggregator the user's own question rather than a fixed one. `{query}`
 * runs the request once per role the user is looking for, since aggregators
 * take a phrase rather than a boolean expression.
 */
export const jsonAdapter: SourceAdapter = {
  id: 'json',

  async *fetch(source: SourceConfig, ctx: FetchContext): AsyncIterable<RawPosting> {
    const urlTemplate = requireString(source, 'url');
    const map = source.fieldMap;
    if (!map) throw new SourceConfigError(source.id, 'fieldMap is required for the "json" adapter');

    const listPath = (source.options.listPath as string | undefined) ?? '';
    const maxPages = Number(source.options.maxPages ?? 1);
    const pageStart = Number(source.options.pageStart ?? 1);
    const method = String(source.options.method ?? 'GET').toUpperCase();
    const bodyTemplate = source.options.body as Record<string, unknown> | undefined;

    // A `{query}` source is a search, so it needs something to search for.
    // Running it with an empty term would ask an aggregator for every job it
    // has, which is both useless and the most expensive thing we could do.
    const wantsQuery = /\{query\}/.test(urlTemplate) || hasPlaceholder(bodyTemplate, 'query');
    if (wantsQuery && !ctx.search?.queries.length) {
      ctx.log.warn('search source has nothing to search for; skipping', { source: source.id });
      return;
    }
    const queries = wantsQuery ? ctx.search!.queries : [''];
    const maxQueries = Number(source.options.maxQueries ?? 4);

    for (const query of queries.slice(0, maxQueries)) {
      for (let page = pageStart; page < pageStart + maxPages; page++) {
        if (ctx.signal.aborted) return;
        const vars = {
          ...stringOptions(source.options),
          page: String(page),
          query,
          location: ctx.search?.location ?? '',
          since: ctx.since.toISOString(),
          sinceDate: ctx.since.toISOString().slice(0, 10),
        };
        const url = expand(urlTemplate, vars);
        // Some APIs authenticate by header rather than query string, and take
        // the key under a name of their own choosing, so the header set is
        // configuration too. Values are templated but not URL-encoded: a header
        // is not a URL, and percent-encoding an email would break the one
        // USAJOBS asks for.
        const headers = expandHeaders(source.options.headers, {
          ...stringOptions(source.options),
          query,
          location: ctx.search?.location ?? '',
        });
        let payload: unknown;
        try {
          payload = await ctx.http.json<unknown>(url, {
            method,
            ...(headers ? { headers } : {}),
            ...(bodyTemplate
              ? {
                  headers: { 'Content-Type': 'application/json', ...headers },
                  body: JSON.stringify(substitute(bodyTemplate, vars)),
                }
              : {}),
          });
        } catch (cause) {
          ctx.log.warn('json source failed', { source: source.id, url, err: String(cause) });
          break;
        }

        const list = listPath ? readPath(payload, listPath) : payload;
        if (!Array.isArray(list)) {
          ctx.log.warn('json source returned no array', { source: source.id, listPath });
          break;
        }
        if (list.length === 0) break;

        for (const record of list) {
          const posting = mapRecord(record, source, ctx);
          if (!posting) continue;
          if (new Date(posting.postedAt) < ctx.since) continue;
          yield posting;
        }
      }
    }
  },
};

function mapRecord(record: unknown, source: SourceConfig, ctx: FetchContext): RawPosting | null {
  const map = source.fieldMap!;
  const str = (path: string | undefined): string | null => {
    if (!path) return null;
    const value = readPath(record, path);
    return value == null ? null : String(value);
  };
  const num = (path: string | undefined): number | null => {
    const value = str(path);
    if (value == null) return null;
    const parsed = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const title = str(map.title);
  const url = str(map.url);
  if (!title || !url) {
    ctx.log.debug('json record missing title or url', { source: source.id });
    return null;
  }

  const rawPostedAt = str(map.postedAt);
  const postedAt = rawPostedAt ? parseDate(rawPostedAt) : new Date();
  const location = str(map.location) ?? '';
  const descriptionRaw = str(map.description) ?? '';
  const description = /<[a-z][\s\S]*>/i.test(descriptionRaw) ? htmlToText(descriptionRaw) : descriptionRaw;

  const payMin = num(map.payMin);
  const payMax = num(map.payMax);
  const payText = str(map.pay);
  const pay = payMin != null || payMax != null
    ? { pay: payText, payMin, payMax, payCurrency: str(map.payCurrency) ?? 'USD' }
    : parsePayText(payText);

  const remoteRaw = str(map.remote);
  return {
    externalId: str(map.id) ?? url,
    title,
    company: str(map.company) ?? source.company ?? source.id,
    location,
    remote: remoteRaw != null ? isTruthy(remoteRaw) : looksRemote(location, title),
    ...pay,
    url,
    applyUrl: str(map.applyUrl) ?? url,
    postedAt: Number.isFinite(postedAt.getTime()) ? postedAt.toISOString() : new Date().toISOString(),
    description,
    raw: record,
  };
}

/**
 * A published-at value as some feed or other writes it.
 *
 * Several publish epoch seconds. `new Date("1699999999")` is an invalid date,
 * and the caller's fallback would then stamp every posting with the time of the
 * scan -- so the whole run would look freshly posted and nothing would ever age
 * out. Digits alone are therefore read as an epoch, in whichever unit their
 * magnitude implies.
 */
function parseDate(value: string): Date {
  const trimmed = value.trim();
  if (/^\d{9,14}$/.test(trimmed)) {
    const n = Number(trimmed);
    return new Date(trimmed.length <= 11 ? n * 1000 : n);
  }
  return new Date(trimmed);
}

function isTruthy(value: string): boolean {
  return /^(true|yes|1|remote)$/i.test(value.trim());
}

/**
 * Fills placeholders in a URL, encoding each value.
 *
 * Encoding here rather than at the call site because these values are the
 * user's own words -- a role like "C++ engineer" or a location with a comma
 * would otherwise build a URL that means something else.
 */
function expand(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? encodeURIComponent(vars[name]!) : match);
}

/** Whether a body template mentions a placeholder anywhere in its values. */
/**
 * The source's own string options, usable as placeholders.
 *
 * This is what lets a key that travels as a query parameter work without a
 * second mechanism for secrets: `options.appKey` fills `{appKey}`, the same way
 * a page number fills `{page}`.
 */
function stringOptions(options: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(options)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** Request headers from config, with `{option}` placeholders filled in. */
function expandHeaders(
  configured: unknown,
  vars: Record<string, string>,
): Record<string, string> | null {
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) return null;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(configured as Record<string, unknown>)) {
    if (typeof value !== 'string') continue;
    out[name] = value.replace(/\{(\w+)\}/g, (match, key: string) =>
      key in vars ? vars[key]! : match);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function hasPlaceholder(template: Record<string, unknown> | undefined, name: string): boolean {
  if (!template) return false;
  return Object.values(template).some((value) =>
    typeof value === 'string'
      ? value.includes(`{${name}}`)
      : value && typeof value === 'object' && !Array.isArray(value)
        ? hasPlaceholder(value as Record<string, unknown>, name)
        : false);
}

/** Replaces `{page}` / `{since}` placeholders inside a request body template. */
function substitute(template: Record<string, unknown>, vars: Record<string, string | number>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(template)) {
    if (typeof value === 'string') {
      out[key] = value.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = substitute(value as Record<string, unknown>, vars);
    } else {
      out[key] = value;
    }
  }
  return out;
}
