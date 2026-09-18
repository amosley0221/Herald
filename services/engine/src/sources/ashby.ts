import type { SourceConfig } from '../config.js';
import {
  htmlToText, looksRemote, parsePayText, stringList,
  type FetchContext, type RawPosting, type SourceAdapter,
} from './types.js';

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  department?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  isRemote?: boolean;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    compensationTierSummary?: string;
    summaryComponents?: Array<{ minValue?: number; maxValue?: number; currencyCode?: string; interval?: string; compensationType?: string }>;
  };
}

/**
 * Ashby job boards.
 *
 * `options.boards` is a list of job-board names — the `<name>` in
 * `jobs.ashbyhq.com/<name>`.
 */
export const ashbyAdapter: SourceAdapter = {
  id: 'ashby',

  async *fetch(source: SourceConfig, ctx: FetchContext): AsyncIterable<RawPosting> {
    const boards = stringList(source, 'boards');
    const apiBase = (source.options.apiBase as string | undefined) ?? 'https://api.ashbyhq.com/posting-api/job-board';

    for (const board of boards) {
      if (ctx.signal.aborted) return;
      const url = `${apiBase}/${encodeURIComponent(board)}?includeCompensation=true`;
      let payload: { jobs?: AshbyJob[] };
      try {
        payload = await ctx.http.json<{ jobs?: AshbyJob[] }>(url);
      } catch (cause) {
        ctx.log.warn('ashby board failed', { board, err: String(cause) });
        continue;
      }

      for (const job of payload.jobs ?? []) {
        const postedAt = job.publishedAt ? new Date(job.publishedAt) : null;
        if (!postedAt || !Number.isFinite(postedAt.getTime()) || postedAt < ctx.since) continue;

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

function ashbyPay(job: AshbyJob) {
  const salary = job.compensation?.summaryComponents?.find(
    (c) => c.compensationType === 'Salary' || c.interval === 'YEAR',
  );
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
