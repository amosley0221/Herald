import { htmlToText, looksRemote, parsePayText, SourceConfigError, } from './types.js';
/**
 * Workday career sites.
 *
 * Workday has no public aggregate API, so each tenant is listed explicitly in
 * `options.tenants`. The search endpoint pages 20 at a time; the detail
 * endpoint is only called for postings that survive the date filter, which
 * keeps the request count proportional to what is actually new.
 */
export const workdayAdapter = {
    id: 'workday',
    async *fetch(source, ctx) {
        const tenants = readTenants(source);
        const pageSize = Number(source.options.pageSize ?? 20);
        const maxPages = Number(source.options.maxPages ?? 10);
        const searchText = String(source.options.searchText ?? '');
        for (const tenant of tenants) {
            if (ctx.signal.aborted)
                return;
            const base = `https://${tenant.tenant}.${tenant.host}/wday/cxs/${tenant.tenant}/${tenant.site}`;
            for (let page = 0; page < maxPages; page++) {
                let payload;
                try {
                    payload = await ctx.http.json(`${base}/jobs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ appliedFacets: {}, limit: pageSize, offset: page * pageSize, searchText }),
                    });
                }
                catch (cause) {
                    ctx.log.warn('workday tenant failed', { tenant: tenant.tenant, page, err: String(cause) });
                    break;
                }
                const postings = payload.jobPostings ?? [];
                if (postings.length === 0)
                    break;
                // `postedOn` is relative prose ("Posted 3 Days Ago"), so resolve it to a
                // date before deciding whether the posting is new enough to keep.
                let allStale = true;
                for (const posting of postings) {
                    const postedAt = resolvePostedOn(posting.postedOn, ctx.since);
                    if (!postedAt || postedAt < ctx.since)
                        continue;
                    allStale = false;
                    const jobUrl = `https://${tenant.tenant}.${tenant.host}/en-US/${tenant.site}${posting.externalPath}`;
                    let description = '';
                    let remoteType;
                    try {
                        const detail = await ctx.http.json(`${base}${posting.externalPath}`);
                        description = htmlToText(detail.jobPostingInfo?.jobDescription);
                        remoteType = detail.jobPostingInfo?.remoteType;
                    }
                    catch (cause) {
                        ctx.log.debug('workday detail failed', { path: posting.externalPath, err: String(cause) });
                    }
                    const location = posting.locationsText ?? '';
                    yield {
                        externalId: posting.externalPath,
                        title: posting.title,
                        company: source.company ?? tenant.company,
                        location,
                        remote: looksRemote(location, remoteType, posting.title),
                        ...parsePayText(posting.bulletFields?.find((b) => /[$€£]\s?\d/.test(b)) ?? null),
                        url: jobUrl,
                        applyUrl: jobUrl,
                        postedAt: postedAt.toISOString(),
                        description,
                        raw: posting,
                    };
                }
                // Workday returns newest first, so a fully stale page means we are past
                // the window for this tenant and the remaining pages are older still.
                if (allStale)
                    break;
                if (payload.total != null && (page + 1) * pageSize >= payload.total)
                    break;
            }
        }
    },
};
function readTenants(source) {
    const raw = source.options.tenants;
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new SourceConfigError(source.id, 'options.tenants must be a non-empty array');
    }
    return raw.map((entry, index) => {
        const t = entry;
        for (const key of ['tenant', 'host', 'site', 'company']) {
            if (typeof t[key] !== 'string' || !t[key]) {
                throw new SourceConfigError(source.id, `options.tenants[${index}].${key} is required`);
            }
        }
        return t;
    });
}
/**
 * Workday publishes `postedOn` as "Posted Today" / "Posted 3 Days Ago".
 * Returns null when the phrasing is not recognised, which drops the posting
 * rather than guessing a date that would corrupt the freshness filter.
 */
export function resolvePostedOn(text, now) {
    if (!text)
        return null;
    const lowered = text.toLowerCase();
    if (lowered.includes('today'))
        return startOfDay(now);
    if (lowered.includes('yesterday'))
        return addDays(startOfDay(now), -1);
    const match = /(\d+)\+?\s*(day|days|hour|hours|week|weeks|month|months)\s*ago/.exec(lowered);
    if (match) {
        const n = Number(match[1]);
        const unit = match[2];
        if (unit.startsWith('hour'))
            return new Date(now.getTime() - n * 3_600_000);
        if (unit.startsWith('day'))
            return addDays(startOfDay(now), -n);
        if (unit.startsWith('week'))
            return addDays(startOfDay(now), -n * 7);
        return addDays(startOfDay(now), -n * 30);
    }
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}
function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
}
function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
}
//# sourceMappingURL=workday.js.map