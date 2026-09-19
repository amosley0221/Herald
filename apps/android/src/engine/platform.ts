import * as FileSystem from 'expo-file-system/legacy';
import {
  LocalBackend, runCrawl as runSharedCrawl,
  type CrawlOutcome, type EnginePlatform, type ResumeUpload,
} from '@herald/core';
import * as store from './db';
import { getApiKey, getFeedFloor, getModels, getSources } from './settings';
import { getReleasesIndexUrl } from './settings';

/**
 * This device, as the engine sees it.
 *
 * The pipeline, scoring and backend all live in @herald/core and are the same
 * here as on the desktop; only storage, settings and HTTP differ, and those are
 * what this supplies. React Native's global fetch reaches a job board fine, so
 * nothing is wrapped.
 */
export const platform: EnginePlatform = {
  store,
  settings: { getApiKey, getSources, getModels, getFeedFloor, getReleasesIndexUrl },
  fetch: (input, init) => fetch(input, init),
  log: {
    // eslint-disable-next-line no-console
    error: (message, fields) => console.warn(`[herald] ${message}`, fields ?? ''),
    // eslint-disable-next-line no-console
    warn: (message, fields) => console.warn(`[herald] ${message}`, fields ?? ''),
    // eslint-disable-next-line no-console
    info: (message, fields) => console.log(`[herald] ${message}`, fields ?? ''),
    debug: () => {},
  },
};

export function createBackend(): LocalBackend {
  return new LocalBackend(platform);
}

export function runCrawl(): Promise<CrawlOutcome> {
  return runSharedCrawl(platform);
}

/**
 * Turns a picked file into something the shared backend can read.
 *
 * The document picker hands back a content:// URI, which only a filesystem can
 * resolve — so it is resolved here rather than in core, which deliberately has
 * no filesystem.
 */
export async function readUpload(file: ResumeUpload): Promise<ResumeUpload> {
  if (typeof file.data !== 'object' || file.data === null) return file;
  if (!('uri' in file.data)) return file;

  const base64 = await FileSystem.readAsStringAsync(file.data.uri, { encoding: 'base64' });
  // The shared backend reads a string as base64; the union is widened here
  // because only this side knows the URI has already been resolved.
  return { ...file, data: base64 as unknown as ResumeUpload['data'] };
}
