import type { SourceConfig } from '../config.js';
import {
  htmlToText, looksRemote, parsePayText, stringList,
  type FetchContext, type RawPosting, type SourceAdapter,
} from './types.js';

interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at: string;
  location?: { name?: string };
  content?: string;
  company_name?: string;
  metadata?: Array<{ name?: string; value?: unknown }>;
}

/**
 * Greenhouse job boards.
 *
 * `options.boards` is a list of board tokens — the slug in
 * `boards.greenhouse.io/<token>`. `options.apiBase` overrides the host for
 * self-hosted or regional deployments.
 */
export const greenhouseAdapter: SourceAdapter = {
  id: 'greenhouse',

  async *fetch(source: SourceConfig, ctx: FetchContext): AsyncIterable<RawPosting> {
    const boards = stringList(source, 'boards');
    const apiBase = (source.options.apiBase as string | undefined) ?? 'https://boards-api.greenhouse.io/v1/boards';

    for (const board of boards) {
      if (ctx.signal.aborted) return;
      const url = `${apiBase}/${encodeURIComponent(board)}/jobs?content=true`;
      let payload: { jobs?: GreenhouseJob[] };
      try {
        payload = await ctx.http.json<{ jobs?: GreenhouseJob[] }>(url);
      } catch (cause) {
        // One dead board must not sink the rest of the crawl.
        ctx.log.warn('greenhouse board failed', { board, err: String(cause) });
        continue;
      }

      for (const job of payload.jobs ?? []) {
        const postedAt = new Date(job.updated_at);
        if (!Number.isFinite(postedAt.getTime()) || postedAt < ctx.since) continue;

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

function readPayMetadata(metadata: GreenhouseJob['metadata']): ReturnType<typeof parsePayText> | null {
  const entry = metadata?.find((m) => /salary|compensation|pay/i.test(m.name ?? ''));
  if (!entry || entry.value == null) return null;
  return parsePayText(String(entry.value));
}

/** Finds the line most likely to carry a salary range. */
function findPayLine(description: string): string | null {
  const line = description
    .split('\n')
    .find((l) => /[$€£]\s?\d/.test(l) && /(salary|range|compensation|pay|base)/i.test(l));
  return line ?? null;
}

function decodeEntities(html: string): string {
  return html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
