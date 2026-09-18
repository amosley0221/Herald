import { htmlToText, looksRemote, parsePayText, stringList, } from './types.js';
/**
 * Greenhouse job boards.
 *
 * `options.boards` is a list of board tokens — the slug in
 * `boards.greenhouse.io/<token>`. `options.apiBase` overrides the host for
 * self-hosted or regional deployments.
 */
export const greenhouseAdapter = {
    id: 'greenhouse',
    async *fetch(source, ctx) {
        const boards = stringList(source, 'boards');
        const apiBase = source.options.apiBase ?? 'https://boards-api.greenhouse.io/v1/boards';
        for (const board of boards) {
            if (ctx.signal.aborted)
                return;
            const url = `${apiBase}/${encodeURIComponent(board)}/jobs?content=true`;
            let payload;
            try {
                payload = await ctx.http.json(url);
            }
            catch (cause) {
                // One dead board must not sink the rest of the crawl.
                ctx.log.warn('greenhouse board failed', { board, err: String(cause) });
                continue;
            }
            for (const job of payload.jobs ?? []) {
                const postedAt = new Date(job.updated_at);
                if (!Number.isFinite(postedAt.getTime()) || postedAt < ctx.since)
                    continue;
                // Greenhouse HTML-escapes `content`; decode before stripping tags.
                const description = htmlToText(decodeEntities(job.content ?? ''));
                const location = job.location?.name ?? '';
                const payFromMetadata = readPayMetadata(job.metadata);
                yield {
                    externalId: String(job.id),
                    title: job.title,
                    company: source.company ?? job.company_name ?? board,
                    location,
                    remote: looksRemote(location, job.title),
                    ...(payFromMetadata ?? parsePayText(findPayLine(description))),
                    url: job.absolute_url,
                    applyUrl: job.absolute_url,
                    postedAt: postedAt.toISOString(),
                    description,
                    raw: job,
                };
            }
        }
    },
};
function readPayMetadata(metadata) {
    const entry = metadata?.find((m) => /salary|compensation|pay/i.test(m.name ?? ''));
    if (!entry || entry.value == null)
        return null;
    return parsePayText(String(entry.value));
}
/** Finds the line most likely to carry a salary range. */
function findPayLine(description) {
    const line = description
        .split('\n')
        .find((l) => /[$€£]\s?\d/.test(l) && /(salary|range|compensation|pay|base)/i.test(l));
    return line ?? null;
}
function decodeEntities(html) {
    return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
//# sourceMappingURL=greenhouse.js.map