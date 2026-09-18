import { htmlToText, looksRemote, parsePayText, readPath, requireString, SourceConfigError, } from './types.js';
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
 */
export const jsonAdapter = {
    id: 'json',
    async *fetch(source, ctx) {
        const urlTemplate = requireString(source, 'url');
        const map = source.fieldMap;
        if (!map)
            throw new SourceConfigError(source.id, 'fieldMap is required for the "json" adapter');
        const listPath = source.options.listPath ?? '';
        const maxPages = Number(source.options.maxPages ?? 1);
        const pageStart = Number(source.options.pageStart ?? 1);
        const method = String(source.options.method ?? 'GET').toUpperCase();
        const bodyTemplate = source.options.body;
        for (let page = pageStart; page < pageStart + maxPages; page++) {
            if (ctx.signal.aborted)
                return;
            const url = urlTemplate.replace(/\{page\}/g, String(page));
            let payload;
            try {
                payload = await ctx.http.json(url, {
                    method,
                    ...(bodyTemplate
                        ? {
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(substitute(bodyTemplate, { page, since: ctx.since.toISOString() })),
                        }
                        : {}),
                });
            }
            catch (cause) {
                ctx.log.warn('json source failed', { source: source.id, url, err: String(cause) });
                return;
            }
            const list = listPath ? readPath(payload, listPath) : payload;
            if (!Array.isArray(list)) {
                ctx.log.warn('json source returned no array', { source: source.id, listPath });
                return;
            }
            if (list.length === 0)
                return;
            for (const record of list) {
                const posting = mapRecord(record, source, ctx);
                if (!posting)
                    continue;
                if (new Date(posting.postedAt) < ctx.since)
                    continue;
                yield posting;
            }
        }
    },
};
function mapRecord(record, source, ctx) {
    const map = source.fieldMap;
    const str = (path) => {
        if (!path)
            return null;
        const value = readPath(record, path);
        return value == null ? null : String(value);
    };
    const num = (path) => {
        const value = str(path);
        if (value == null)
            return null;
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
    const postedAt = rawPostedAt ? new Date(rawPostedAt) : new Date();
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
function isTruthy(value) {
    return /^(true|yes|1|remote)$/i.test(value.trim());
}
/** Replaces `{page}` / `{since}` placeholders inside a request body template. */
function substitute(template, vars) {
    const out = {};
    for (const [key, value] of Object.entries(template)) {
        if (typeof value === 'string') {
            out[key] = value.replace(/\{(\w+)\}/g, (match, name) => name in vars ? String(vars[name]) : match);
        }
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            out[key] = substitute(value, vars);
        }
        else {
            out[key] = value;
        }
    }
    return out;
}
//# sourceMappingURL=json.js.map