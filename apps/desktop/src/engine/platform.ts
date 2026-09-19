import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { LazyStore } from '@tauri-apps/plugin-store';
import {
  DEFAULT_FEED_FLOOR, DEFAULT_MODELS, LocalBackend, defineSource,
  runCrawl as runSharedCrawl,
  type CrawlOutcome, type EnginePlatform, type EngineSettings, type ModelConfig,
  type SourceConfig,
} from '@herald/core';
import { store as sqlStore } from './db';

/**
 * This machine, as the engine sees it.
 *
 * The pipeline and the backend are the shared ones; only these three things are
 * local. HTTP is the interesting one: a webview's own fetch cannot read a job
 * board, because no ATS sends CORS headers, so every request goes through
 * Tauri's native stack instead. That also keeps the Anthropic key out of
 * anything a page could observe.
 */

const settingsFile = new LazyStore('herald-settings.json');

const KEYS = {
  apiKey: 'anthropicApiKey',
  sources: 'sources',
  models: 'models',
  feedFloor: 'feedFloor',
  feedUrl: 'releasesIndexUrl',
} as const;

/** Where Herald publishes its own builds, unless told otherwise. */
const DEFAULT_FEED =
  'https://raw.githubusercontent.com/amosley0221/Herald/main/releases/index.json';

export const EXAMPLE_SOURCES: SourceConfig[] = [
  defineSource({ id: 'greenhouse', adapter: 'greenhouse', priority: 10, options: { boards: [] } }),
  defineSource({ id: 'lever', adapter: 'lever', priority: 10, options: { sites: [] } }),
  defineSource({ id: 'ashby', adapter: 'ashby', priority: 10, options: { boards: [] } }),
];

export const settings: EngineSettings = {
  async getApiKey() {
    return (await settingsFile.get<string>(KEYS.apiKey)) ?? null;
  },
  async getSources() {
    const stored = await settingsFile.get<SourceConfig[]>(KEYS.sources);
    return Array.isArray(stored) && stored.length > 0
      ? stored.map((source) => defineSource(source))
      : EXAMPLE_SOURCES;
  },
  async getModels(): Promise<ModelConfig> {
    return { ...DEFAULT_MODELS, ...(await settingsFile.get<Partial<ModelConfig>>(KEYS.models)) };
  },
  async getFeedFloor() {
    return (await settingsFile.get<number>(KEYS.feedFloor)) ?? DEFAULT_FEED_FLOOR;
  },
  async getReleasesIndexUrl() {
    return (await settingsFile.get<string>(KEYS.feedUrl)) ?? DEFAULT_FEED;
  },
};

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await settingsFile.set(KEYS.apiKey, trimmed);
  else await settingsFile.delete(KEYS.apiKey);
  await settingsFile.save();
}

export async function setSources(sources: SourceConfig[]): Promise<void> {
  await settingsFile.set(KEYS.sources, sources);
  await settingsFile.save();
}

export async function setModels(models: Partial<ModelConfig>): Promise<void> {
  await settingsFile.set(KEYS.models, { ...(await settings.getModels()), ...models });
  await settingsFile.save();
}

export async function setFeedFloor(floor: number): Promise<void> {
  await settingsFile.set(KEYS.feedFloor, Math.round(floor));
  await settingsFile.save();
}

export const platform: EnginePlatform = {
  store: sqlStore,
  settings,
  // Tauri's fetch is the native one, so it is not subject to the webview's
  // origin rules — which is the only reason reading a job board works at all.
  fetch: tauriFetch as typeof globalThis.fetch,
  log: {
    // eslint-disable-next-line no-console
    error: (message, fields) => console.error(`[herald] ${message}`, fields ?? ''),
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
