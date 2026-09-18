import * as Updates from 'expo-updates';
import * as IntentLauncher from 'expo-intent-launcher';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { ReleaseIndex } from '@herald/core';
import { isNewer } from '@herald/core';
import { appConfig } from './config';

/**
 * Updating without reinstalling, in two layers.
 *
 * **A. Over-the-air.** Almost every change is JavaScript, and `expo-updates`
 * fetches those silently and applies them on the next launch. The user does
 * nothing and sees nothing but a "What's new" toast.
 *
 * **B. Native.** A new permission or SDK bump needs a real APK. The engine's
 * release feed says which version is current; when the installed build is
 * behind, Today shows a hairline banner, and tapping it downloads the APK and
 * hands it to the system package installer. Android does not permit a silent
 * install of a sideloaded package, so the user confirms once — that single tap
 * is the only manual step, and there is no store account or file copying.
 */

export interface OtaResult {
  status: 'downloaded' | 'up-to-date' | 'disabled' | 'failed';
  error?: string;
}

/**
 * Checks for and downloads an OTA patch. Returns `downloaded` when one is
 * staged; the caller decides whether to reload now or on next launch.
 */
export async function checkForOtaUpdate(): Promise<OtaResult> {
  // Disabled in development, and in any build made without an updates URL.
  if (__DEV__ || !Updates.isEnabled) return { status: 'disabled' };
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return { status: 'up-to-date' };
    await Updates.fetchUpdateAsync();
    return { status: 'downloaded' };
  } catch (cause) {
    // A failed update check must never block the app. The user is here to
    // read matches, not to update.
    return { status: 'failed', error: cause instanceof Error ? cause.message : String(cause) };
  }
}

/** Restarts into a patch that has already been downloaded. */
export async function applyOtaUpdate(): Promise<void> {
  await Updates.reloadAsync();
}

/** What the running bundle is, for the What's new screen. */
export function runtimeInfo(): { version: string; updateId: string | null; channel: string | null; embedded: boolean } {
  return {
    version: appConfig.version,
    updateId: Updates.updateId ?? null,
    channel: Updates.channel ?? null,
    // True when running the bundle that shipped inside the APK, i.e. no patch
    // has been applied yet.
    embedded: Updates.isEmbeddedLaunch,
  };
}

// ── Native APK updates ──────────────────────────────────────────────────────

export interface NativeUpdate {
  version: string;
  androidVersionCode: number;
  notesMarkdown: string;
  date: string;
  /** Where CI published this version's APK, when the feed records it. */
  apkUrl: string | null;
}

/**
 * Compares the installed build against the release feed.
 *
 * Returns null when up to date, so the caller can render the banner on a truthy
 * value and nothing otherwise.
 */
export function findNativeUpdate(feed: ReleaseIndex | null): NativeUpdate | null {
  if (!feed) return null;
  if (!isNewer(feed.latest, appConfig.version)) return null;
  const release = feed.releases.find((entry) => entry.version === feed.latest);
  if (!release) return null;
  return {
    version: release.version,
    androidVersionCode: release.androidVersionCode,
    notesMarkdown: release.notesMarkdown,
    date: release.date,
    apkUrl: release.androidApkUrl ?? null,
  };
}

export interface DownloadProgress {
  /** 0–1, or null while the server has not declared a content length. */
  fraction: number | null;
}

/**
 * Downloads an APK and opens the system installer on it.
 *
 * The file goes to the cache directory and is exposed through the app's
 * FileProvider, because Android 7+ refuses a `file://` URI in an install
 * intent. The user taps once to confirm; nothing installs behind their back.
 */
export async function downloadAndInstallApk(
  apkUrl: string,
  version: string,
  onProgress?: (progress: DownloadProgress) => void,
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('APK installation is Android-only.');
  }

  const directory = new Directory(Paths.cache, 'updates');
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = new File(directory, `herald-${version}.apk`);
  // A partial file from an interrupted attempt would install as a corrupt
  // package, so always start clean.
  if (destination.exists) destination.delete();

  const downloaded = await File.downloadFileAsync(apkUrl, destination, {
    onProgress: onProgress
      ? (progress) => {
          // `totalBytes` is -1 when the server sent no Content-Length, in which
          // case there is no fraction to report — the banner shows a spinner.
          const total = progress.totalBytes;
          onProgress({
            fraction: total > 0 ? progress.bytesWritten / total : null,
          });
        }
      : undefined,
  });

  const contentUri = await getContentUri(downloaded);

  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    flags:
      // GRANT_READ_URI_PERMISSION lets the installer read out of our cache.
      1 /* FLAG_GRANT_READ_URI_PERMISSION */ |
      268435456 /* FLAG_ACTIVITY_NEW_TASK */,
    type: 'application/vnd.android.package-archive',
  });
}

/**
 * Turns a file path into a `content://` URI the installer will accept.
 *
 * expo-file-system's modern API exposes the FileProvider URI directly; the
 * legacy helper is the fallback for builds where it is not yet available.
 */
async function getContentUri(file: File): Promise<string> {
  const candidate = (file as unknown as { contentUri?: string }).contentUri;
  if (typeof candidate === 'string' && candidate.startsWith('content://')) return candidate;
  const legacy = await import('expo-file-system/legacy');
  return legacy.getContentUriAsync(file.uri);
}
