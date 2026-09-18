/**
 * Credential storage for the desktop app.
 *
 * Tauri gives the app its own origin and its own isolated storage directory, so
 * `localStorage` here is not the shared, script-reachable store it is on the
 * web — it is a file inside the app's data directory. The token still never
 * leaves the machine.
 */

const KEYS = {
  engineUrl: 'herald.engine.url',
  engineToken: 'herald.engine.token',
  lastSeenVersion: 'herald.lastSeenVersion',
} as const;

export interface EngineCredentials {
  baseUrl: string;
  token: string;
}

export function loadCredentials(): EngineCredentials | null {
  try {
    const baseUrl = localStorage.getItem(KEYS.engineUrl);
    const token = localStorage.getItem(KEYS.engineToken);
    if (!baseUrl || !token) return null;
    return { baseUrl, token };
  } catch {
    // Storage can be unavailable in a hardened webview; treat that as unpaired
    // rather than crashing on first paint.
    return null;
  }
}

export function saveCredentials(credentials: EngineCredentials): void {
  localStorage.setItem(KEYS.engineUrl, credentials.baseUrl);
  localStorage.setItem(KEYS.engineToken, credentials.token);
}

export function clearCredentials(): void {
  localStorage.removeItem(KEYS.engineUrl);
  localStorage.removeItem(KEYS.engineToken);
}

export function getLastSeenVersion(): string | null {
  try {
    return localStorage.getItem(KEYS.lastSeenVersion);
  } catch {
    return null;
  }
}

export function setLastSeenVersion(version: string): void {
  try {
    localStorage.setItem(KEYS.lastSeenVersion, version);
  } catch {
    // A missing "what's new" toast is not worth failing a launch over.
  }
}
