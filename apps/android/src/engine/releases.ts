import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReleaseIndex } from '@herald/core';

/**
 * The release feed, read directly.
 *
 * Paired with an engine, the app asks it for the feed and the engine proxies
 * and caches it. Standalone there is nothing to proxy, so the app fetches
 * `releases/index.json` itself — otherwise the in-app updater has nothing to
 * check and the app could never tell the user a new version exists.
 *
 * The URL is configuration, not a constant: it comes from the build
 * (`HERALD_RELEASES_INDEX_URL`) or from Preferences, so a fork publishes to its
 * own feed without touching this file.
 */

const FEED_URL = 'herald.releasesIndexUrl';
const CACHE = 'herald.releasesCache';
/** Long enough not to hit the network on every launch, short enough to be useful. */
const CACHE_MINUTES = 30;

export async function getReleasesIndexUrl(): Promise<string | null> {
  const stored = await AsyncStorage.getItem(FEED_URL);
  if (stored?.trim()) return stored.trim();
  const fromBuild = (Constants.expoConfig?.extra as { releasesIndexUrl?: string } | undefined)
    ?.releasesIndexUrl;
  return fromBuild?.trim() ? fromBuild.trim() : null;
}

export async function setReleasesIndexUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (trimmed) await AsyncStorage.setItem(FEED_URL, trimmed);
  else await AsyncStorage.removeItem(FEED_URL);
}

export async function fetchReleaseIndex(): Promise<ReleaseIndex> {
  const url = await getReleasesIndexUrl();
  if (!url) {
    throw new Error(
      'No release feed is configured, so Herald cannot check for updates. Set one in Preferences.',
    );
  }

  const cached = await readCache();
  if (cached) return cached;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`The release feed returned ${response.status}.`);

  const index = (await response.json()) as ReleaseIndex;
  if (!index?.latest || !Array.isArray(index.releases)) {
    throw new Error('That URL did not return a Herald release feed.');
  }

  await AsyncStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), index }));
  return index;
}

async function readCache(): Promise<ReleaseIndex | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE);
    if (!raw) return null;
    const { at, index } = JSON.parse(raw) as { at: number; index: ReleaseIndex };
    if (Date.now() - at > CACHE_MINUTES * 60_000) return null;
    return index;
  } catch {
    // A corrupt cache is not worth reporting; just fetch again.
    return null;
  }
}
