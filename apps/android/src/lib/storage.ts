import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the app keeps things between launches.
 *
 * The engine credentials go in SecureStore, which is backed by the Android
 * keystore — that token is the only thing between the internet and the user's
 * resume, so it never touches ordinary storage. Everything else is preference
 * dust and lives in AsyncStorage.
 */

const KEYS = {
  engineUrl: 'herald.engine.url',
  engineToken: 'herald.engine.token',
  onboarded: 'herald.onboarded',
  lastSeenVersion: 'herald.lastSeenVersion',
  pushToken: 'herald.pushToken',
} as const;

export interface EngineCredentials {
  baseUrl: string;
  token: string;
}

export async function saveCredentials(credentials: EngineCredentials): Promise<void> {
  await SecureStore.setItemAsync(KEYS.engineUrl, credentials.baseUrl);
  await SecureStore.setItemAsync(KEYS.engineToken, credentials.token);
}

export async function loadCredentials(): Promise<EngineCredentials | null> {
  const [baseUrl, token] = await Promise.all([
    SecureStore.getItemAsync(KEYS.engineUrl),
    SecureStore.getItemAsync(KEYS.engineToken),
  ]);
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}

export async function clearCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(KEYS.engineUrl),
    SecureStore.deleteItemAsync(KEYS.engineToken),
    AsyncStorage.removeItem(KEYS.onboarded),
  ]);
}

/** Whether the three onboarding steps have been completed on this device. */
export async function isOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.onboarded)) === 'true';
}

export async function setOnboarded(value: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.onboarded, value ? 'true' : 'false');
}

/**
 * The version this device last showed a "What's new" toast for. Used so the
 * toast appears exactly once per update.
 */
export async function getLastSeenVersion(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.lastSeenVersion);
}

export async function setLastSeenVersion(version: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.lastSeenVersion, version);
}

/** The FCM token already registered with the engine, to avoid re-posting it. */
export async function getRegisteredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.pushToken);
}

export async function setRegisteredPushToken(token: string): Promise<void> {
  await AsyncStorage.setItem(KEYS.pushToken, token);
}
