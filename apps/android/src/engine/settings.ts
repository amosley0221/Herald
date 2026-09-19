import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { defineSource, type SourceConfig } from '@herald/core';
import { DEFAULT_MODELS, type ModelConfig } from '@herald/core';

/**
 * What the phone needs to do the engine's job, and where it is kept.
 *
 * The Anthropic key goes in the Android keystore through SecureStore, never in
 * AsyncStorage — it is a credential that can spend money, and it is the one
 * piece of this that must not sit in plain application storage. Everything else
 * is ordinary configuration.
 *
 * Nothing here is baked into the build: sources, models and thresholds are all
 * editable in the app, so watching a new company needs no new APK.
 */

const API_KEY = 'herald.anthropic.apiKey';
const SOURCES = 'herald.sources';
const MODELS = 'herald.models';
const FEED_FLOOR = 'herald.feedFloor';
const FEED_URL = 'herald.releasesIndexUrl';

import { DEFAULT_FEED_FLOOR } from '@herald/core';

export { DEFAULT_FEED_FLOOR };

export async function getApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_KEY);
  } catch {
    // A device with no keystore available should prompt for a key, not crash.
    return null;
  }
}

export async function setApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed) await SecureStore.setItemAsync(API_KEY, trimmed);
  else await SecureStore.deleteItemAsync(API_KEY);
}

/**
 * Example boards, used only until the user picks their own.
 *
 * These are placeholders rather than recommendations — the point is that the
 * Sources screen opens with something to edit instead of an empty list.
 */
export const EXAMPLE_SOURCES: SourceConfig[] = [
  defineSource({ id: 'greenhouse', adapter: 'greenhouse', priority: 10, options: { boards: [] } }),
  defineSource({ id: 'lever', adapter: 'lever', priority: 10, options: { sites: [] } }),
  defineSource({ id: 'ashby', adapter: 'ashby', priority: 10, options: { boards: [] } }),
];

export async function getSources(): Promise<SourceConfig[]> {
  const raw = await AsyncStorage.getItem(SOURCES);
  if (!raw) return EXAMPLE_SOURCES;
  try {
    const parsed = JSON.parse(raw) as SourceConfig[];
    return Array.isArray(parsed) ? parsed.map((source) => defineSource(source)) : EXAMPLE_SOURCES;
  } catch {
    return EXAMPLE_SOURCES;
  }
}

export async function setSources(sources: SourceConfig[]): Promise<void> {
  await AsyncStorage.setItem(SOURCES, JSON.stringify(sources));
}

export async function getModels(): Promise<ModelConfig> {
  const raw = await AsyncStorage.getItem(MODELS);
  if (!raw) return DEFAULT_MODELS;
  try {
    return { ...DEFAULT_MODELS, ...(JSON.parse(raw) as Partial<ModelConfig>) };
  } catch {
    return DEFAULT_MODELS;
  }
}

export async function setModels(models: Partial<ModelConfig>): Promise<void> {
  await AsyncStorage.setItem(MODELS, JSON.stringify({ ...(await getModels()), ...models }));
}

export async function getFeedFloor(): Promise<number> {
  const raw = await AsyncStorage.getItem(FEED_FLOOR);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : DEFAULT_FEED_FLOOR;
}

export async function setFeedFloor(floor: number): Promise<void> {
  await AsyncStorage.setItem(FEED_FLOOR, String(Math.round(floor)));
}

// ── Release feed ────────────────────────────────────────────────────────────

/**
 * Where Herald checks for new versions of itself.
 *
 * Configuration rather than a constant: it comes from the build or from
 * Preferences, so a fork publishes to its own feed without touching code.
 */
export async function getReleasesIndexUrl(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(FEED_URL);
  if (stored?.trim()) return stored.trim();

  const Constants = (await import('expo-constants')).default;
  const fromBuild = (Constants.expoConfig?.extra as { releasesIndexUrl?: string } | undefined)
    ?.releasesIndexUrl;
  return fromBuild?.trim() ? fromBuild.trim() : null;
}

export async function setReleasesIndexUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (trimmed) await AsyncStorage.setItem(FEED_URL, trimmed);
  else await AsyncStorage.removeItem(FEED_URL);
}
