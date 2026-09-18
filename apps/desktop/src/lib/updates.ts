import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';

/**
 * Desktop updates.
 *
 * Tauri's updater reads a signed manifest published by CI alongside the release
 * feed, downloads the new build in the background, and swaps it in on relaunch.
 * The user never visits a download page and never runs an installer again after
 * the first one.
 *
 * Every update is signature-checked against the public key baked into
 * `tauri.conf.json`, so a compromised host cannot push a build of its own.
 */

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string; notes: string | null }
  | { status: 'downloading'; version: string; percent: number | null }
  | { status: 'ready'; version: string }
  | { status: 'failed'; error: string };

let pending: Update | null = null;

/** Returns the installed version, for the About row and What's new. */
export async function currentVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    // Running in a plain browser during `vite dev`, where there is no Tauri.
    return import.meta.env.VITE_APP_VERSION ?? '0.0.0';
  }
}

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const update = await check();
    if (!update) return { status: 'none' };
    pending = update;
    return { status: 'available', version: update.version, notes: update.body ?? null };
  } catch (cause) {
    // No updater configured, or no network. Neither should surface as an error
    // the user has to dismiss on every launch.
    return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * Downloads and stages the update that `checkForUpdate` found.
 *
 * `onProgress` reports a fraction where the server declared a length, and null
 * where it did not.
 */
export async function downloadUpdate(
  onProgress?: (percent: number | null) => void,
): Promise<UpdateState> {
  if (!pending) return { status: 'none' };
  const update = pending;
  try {
    let total = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0;
          onProgress?.(total > 0 ? 0 : null);
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress?.(total > 0 ? Math.round((downloaded / total) * 100) : null);
          break;
        case 'Finished':
          onProgress?.(100);
          break;
      }
    });
    return { status: 'ready', version: update.version };
  } catch (cause) {
    return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Restarts into the staged build. */
export async function applyUpdate(): Promise<void> {
  await relaunch();
}
