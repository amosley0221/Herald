import { htmlToText, looksRemote, parsePayText, stringList, } from './types.js';
/**
 * Lever job boards.
 *
 * `options.sites` is a list of Lever site slugs — the `<site>` in
 * `jobs.lever.co/<site>`.
 */
export const leverAdapter = {
    id: 'lever',
    async *fetch(source, ctx) {
        const sites = stringList(source, 'sites');
        const apiBase = source.options.apiBase ?? 'https://api.lever.co/v0/postings';
        for (const site of sites) {
            if (ctx.signal.aborted)
                return;
            const url = `${apiBase}/${encodeURIComponent(site)}?mode=json`;
            let postings;
            try {
                postings = await ctx.http.json(url);
            }
            catch (cause) {
                ctx.log.warn('lever site failed', { site, err: String(cause) });
                continue;
            }
            for (const posting of postings) {
                const postedAt = new Date(posting.createdAt);
                if (!Number.isFinite(postedAt.getTime()) || postedAt < ctx.since)
                    continue;
                const location = posting.categories?.location ?? '';
                const description = posting.descriptionPlain?.trim()
                    ? posting.descriptionPlain
                    : htmlToText(posting.description);
                yield {
                    externalId: posting.id,
                    title: posting.text,
                    company: source.company ?? site,
                    location,
                    remote: posting.workplaceType === 'remote' || looksRemote(location, posting.workplaceType),
                    ...structuredPay(posting) ?? parsePayText(null),
                    url: posting.hostedUrl,
                    applyUrl: posting.applyUrl ?? `${posting.hostedUrl.replace(/\/$/, '')}/apply`,
                    postedAt: postedAt.toISOString(),
                    description,
                    raw: posting,
                };
            }
        }
    },
};
function structuredPay(posting) {
    const range = posting.salaryRange;
    if (!range || (range.min == null && range.max == null))
        return null;
    // Lever reports hourly and monthly intervals too; normalize to annual so the
    // salary floor in Preferences compares like with like.
    const multiplier = range.interval === 'per-hour' ? 2080 : range.interval === 'per-month' ? 12 : 1;
    const min = range.min != null ? range.min * multiplier : null;
    const max = range.max != null ? range.max * multiplier : null;
    return {
        pay: null,
        payMin: min,
        payMax: max,
        payCurrency: range.currency ?? 'USD',
    };
}
//# sourceMappingURL=lever.js.map