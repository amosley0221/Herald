import type { SourceConfig } from '../config.js';
import type { Logger } from '../log.js';

/** A posting as an adapter produces it, before dedupe and normalization. */
export interface RawPosting {
  /** Identifier unique within the source. Combined with the source id for ours. */
  externalId: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  pay: string | null;
  payMin: number | null;
  payMax: number | null;
  payCurrency: string | null;
  /** Human-facing posting page. */
  url: string;
  /** Where the application form lives; often the same as `url`. */
  applyUrl: string;
  /** ISO 8601. Adapters must convert whatever the source publishes. */
  postedAt: string;
  description: string;
  /** Original record, stored so a mapping bug can be diagnosed after the fact. */
  raw: unknown;
}

export interface FetchContext {
  /** Only return postings published at or after this instant. */
  since: Date;
  log: Logger;
  http: HttpClient;
  signal: AbortSignal;
}

export interface HttpClient {
  json<T>(url: string, init?: RequestInit): Promise<T>;
  text(url: string, init?: RequestInit): Promise<string>;
}

export interface SourceAdapter {
  readonly id: string;
  /**
   * Yields postings lazily so a source with thousands of records does not have
   * to be held in memory before the pipeline can start working through it.
   */
  fetch(source: SourceConfig, ctx: FetchContext): AsyncIterable<RawPosting>;
}

/** Thrown when a source's `options` do not carry what its adapter needs. */
export class SourceConfigError extends Error {
  constructor(sourceId: string, message: string) {
    super(`Source "${sourceId}": ${message}`);
    this.name = 'SourceConfigError';
  }
}

export function requireString(source: SourceConfig, key: string): string {
  const value = source.options[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new SourceConfigError(source.id, `options.${key} is required and must be a non-empty string`);
  }
  return value;
}

export function optionalString(source: SourceConfig, key: string): string | undefined {
  const value = source.options[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function stringList(source: SourceConfig, key: string): string[] {
  const value = source.options[key];
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value as string[];
  if (typeof value === 'string') return [value];
  throw new SourceConfigError(source.id, `options.${key} must be a string or an array of strings`);
}

/** Best-effort remote detection from free text; adapters may override it. */
export function looksRemote(...fields: Array<string | null | undefined>): boolean {
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return /\b(remote|work from home|wfh|distributed|anywhere)\b/.test(haystack);
}

/** Pulls a salary range out of free text when a source gives no structured pay. */
export function parsePayText(text: string | null | undefined): {
  pay: string | null; payMin: number | null; payMax: number | null; payCurrency: string | null;
} {
  const empty = { pay: null, payMin: null, payMax: null, payCurrency: null };
  if (!text) return empty;
  const match = /([$€£])\s?([\d,]+(?:\.\d+)?)\s?([kK])?\s*(?:-|–|—|to)\s*([$€£])?\s?([\d,]+(?:\.\d+)?)\s?([kK])?/.exec(text);
  if (!match) return { ...empty, pay: text.slice(0, 120) };
  const scale = (raw: string, k: string | undefined) => {
    const n = Number(raw.replace(/,/g, ''));
    return k ? n * 1000 : n;
  };
  const currency = match[1] === '€' ? 'EUR' : match[1] === '£' ? 'GBP' : 'USD';
  return {
    pay: match[0],
    payMin: scale(match[2]!, match[3]),
    payMax: scale(match[5]!, match[6]),
    payCurrency: currency,
  };
}

/** Strips HTML to plain text so the scoring prompt is not full of markup. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return '';
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
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, ' ')
    // The opening tag of a block becomes a space, so a line break produced by
    // its closing tag would otherwise be followed by one.
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Reads a dotted path such as `location.name` or `compensation[].min`. */
export function readPath(record: unknown, path: string): unknown {
  let node: unknown = record;
  for (const segment of path.split('.')) {
    if (node == null) return undefined;
    if (segment.endsWith('[]')) {
      const key = segment.slice(0, -2);
      const arr = (node as Record<string, unknown>)[key];
      node = Array.isArray(arr) ? arr[0] : undefined;
    } else if (/^\d+$/.test(segment) && Array.isArray(node)) {
      node = node[Number(segment)];
    } else {
      node = (node as Record<string, unknown>)[segment];
    }
  }
  return node;
}
