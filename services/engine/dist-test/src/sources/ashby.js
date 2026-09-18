import { htmlToText, looksRemote, parsePayText, stringList, } from './types.js';
/**
 * Ashby job boards.
 *
 * `options.boards` is a list of job-board names — the `<name>` in
 * `jobs.ashbyhq.com/<name>`.
 */
export const ashbyAdapter = {
    id: 'ashby',
    async *fetch(source, ctx) {
        const boards = stringList(source, 'boards');
        const apiBase = source.options.apiBase ?? 'https://api.ashbyhq.com/posting-api/job-board';
        for (const board of boards) {
            if (ctx.signal.aborted)
                return;
            const url = `${apiBase}/${encodeURIComponent(board)}?includeCompensation=true`;
            let payload;
            try {
                payload = await ctx.http.json(url);
            }
            catch (cause) {
                ctx.log.warn('ashby board failed', { board, err: String(cause) });
                continue;
            }
            for (const job of payload.jobs ?? []) {
                const postedAt = job.publishedAt ? new Date(job.publishedAt) : null;
                if (!postedAt || !Number.isFinite(postedAt.getTime()) || postedAt < ctx.since)
                    continue;
                const description = job.descriptionPlain?.trim() ? job.descriptionPlain : htmlToText(job.descriptionHtml);
                const location = job.location ?? '';
                const jobUrl = job.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${job.id}`;
                yield {
                    externalId: job.id,
                    title: job.title,
                    company: source.company ?? board,
                    location,
                    remote: job.isRemote === true || looksRemote(location),
                    ...ashbyPay(job),
                    url: jobUrl,
                    applyUrl: job.applyUrl ?? `${jobUrl}/application`,
                    postedAt: postedAt.toISOString(),
                    description,
                    raw: job,
                };
            }
        }
    },
};
function ashbyPay(job) {
    const salary = job.compensation?.summaryComponents?.find((c) => c.compensationType === 'Salary' || c.interval === 'YEAR');
    if (salary && (salary.minValue != null || salary.maxValue != null)) {
        const multiplier = salary.interval === 'HOUR' ? 2080 : salary.interval === 'MONTH' ? 12 : 1;
        return {
            pay: job.compensation?.compensationTierSummary ?? null,
            payMin: salary.minValue != null ? salary.minValue * multiplier : null,
            payMax: salary.maxValue != null ? salary.maxValue * multiplier : null,
            payCurrency: salary.currencyCode ?? 'USD',
        };
    }
    return parsePayText(job.compensation?.compensationTierSummary ?? null);
}
//# sourceMappingURL=ashby.js.map