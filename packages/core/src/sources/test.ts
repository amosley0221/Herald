import { greenhouseAdapter } from './greenhouse.js';
import { leverAdapter } from './lever.js';
import { ashbyAdapter } from './ashby.js';
import { workdayAdapter } from './workday.js';
import { jsonAdapter } from './json.js';
import type {
  Logger, RawPosting, SearchTerms, SourceAdapter, SourceConfig,
} from './types.js';

/**
 * Fetches one source and reports what came back.
 *
 * A source is a URL plus a map from that service's field names to Herald's. The
 * URL can be right and the map wrong, and the result is not an error: it is a
 * scan that reads nothing, or reads postings with no title, which looks exactly
 * like a board that had a quiet day. That ambiguity is the whole problem, and
 * it cannot be closed by a type checker or by a test against a recorded payload
 * -- only by asking the live service and looking at the answer.
 *
 * So this runs the real adapter against the real endpoint and hands back both
 * the mapped postings and the warnings the adapter logged along the way. It is
 * the same code the scan runs, not a reimplementation of it, because a test
 * that exercises a different path can only tell you about that path.
 */

const ADAPTERS: Record<string, SourceAdapter> = {
  greenhouse: greenhouseAdapter,
  lever: leverAdapter,
  ashby: ashbyAdapter,
  workday: workdayAdapter,
  json: jsonAdapter,
};

export interface SourceTestResult {
  ok: boolean;
  /** Postings as Herald mapped them, newest first, capped. */
  samples: RawPosting[];
  /** How many the adapter produced before the cap; more may exist. */
  read: number;
  /** What went wrong, in the order it went wrong. */
  problems: string[];
  /** Fields the samples left empty — the usual sign of a bad mapping. */
  missingFields: string[];
}

export interface SourceTestOptions {
  /** How far back to look. A wide window, since this is a reachability check. */
  since?: Date;
  limit?: number;
  search?: SearchTerms;
  http: { json<T>(url: string, init?: RequestInit): Promise<T>; text(url: string, init?: RequestInit): Promise<string> };
  signal?: AbortSignal;
}

export async function testSource(
  source: SourceConfig,
  options: SourceTestOptions,
): Promise<SourceTestResult> {
  const problems: string[] = [];
  const log = collectingLogger(problems);
  const adapter = ADAPTERS[source.adapter];
  if (!adapter) {
    return {
      ok: false, samples: [], read: 0, missingFields: [],
      problems: [`No adapter named "${source.adapter}" runs on this device.`],
    };
  }

  const limit = options.limit ?? 3;
  // Thirty days rather than the scan's window: a board that posts monthly is
  // working, and reporting it as broken because nothing landed yesterday would
  // send the user off to fix a source that is fine.
  const since = options.since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const signal = options.signal ?? new AbortController().signal;
  const samples: RawPosting[] = [];
  let read = 0;

  try {
    for await (const posting of adapter.fetch(source, {
      since, search: options.search, log, http: options.http, signal,
    })) {
      read++;
      if (samples.length < limit) samples.push(posting);
      // Enough to judge the mapping by; the rest is the scan's job.
      if (read >= limit * 10) break;
    }
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }

  if (read === 0 && problems.length === 0) {
    problems.push(
      'The source answered, but no postings came back. Either it has published '
      + 'nothing in the last 30 days, or the path to the list of postings is wrong.',
    );
  }

  return {
    ok: samples.length > 0,
    samples,
    read,
    problems,
    missingFields: emptyFields(samples),
  };
}

/**
 * Fields that came back empty across every sample.
 *
 * One posting without a salary means nothing. Every posting without a company
 * means the mapping points at a field that is not there, and naming it saves
 * the user comparing JSON by eye.
 */
function emptyFields(samples: RawPosting[]): string[] {
  if (samples.length === 0) return [];
  const checks: Array<[string, (p: RawPosting) => boolean]> = [
    ['company', (p) => !p.company.trim()],
    ['location', (p) => !p.location.trim()],
    ['description', (p) => !p.description.trim()],
    ['posted date', (p) => !p.postedAt],
  ];
  return checks.filter(([, empty]) => samples.every(empty)).map(([name]) => name);
}

function collectingLogger(into: string[]): Logger {
  const record = (message: string, fields?: Record<string, unknown>) => {
    const detail = fields?.err ?? fields?.error;
    into.push(detail ? `${message}: ${String(detail)}` : message);
  };
  return { error: record, warn: record, info: () => {}, debug: () => {} };
}
