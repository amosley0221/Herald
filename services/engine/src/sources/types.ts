/**
 * The ingest contract moved to @herald/core so the Android app can run the same
 * adapters without a server. This re-exports it, so the engine's own imports —
 * and anything written against them — keep working unchanged.
 */
export type {
  RawPosting, FetchContext, HttpClient, SourceAdapter, SourceConfig, FieldMap, Logger,
} from '@herald/core';
export {
  SourceConfigError, requireString, optionalString, stringList,
  looksRemote, parsePayText, htmlToText, readPath,
} from '@herald/core';
