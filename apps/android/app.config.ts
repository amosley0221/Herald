import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExpoConfig } from 'expo/config';

/**
 * Expo config.
 *
 * Nothing about a particular deployment is written in here: the version comes
 * from `version.generated.json` (written by `scripts/sync-version.mjs` from the
 * root package.json), and everything environment-specific — the EAS project,
 * the update channel, the release feed — comes from the environment, so the
 * same source tree builds for any account.
 */

interface GeneratedVersion {
  version: string;
  androidVersionCode: number;
}

function readVersion(): GeneratedVersion {
  try {
    const raw = readFileSync(resolve(__dirname, 'version.generated.json'), 'utf8');
    return JSON.parse(raw) as GeneratedVersion;
  } catch {
    // A working tree that has never had sync-version run still has to build.
    return { version: '0.0.0', androidVersionCode: 1 };
  }
}

const { version, androidVersionCode } = readVersion();

const easProjectId = process.env.EAS_PROJECT_ID ?? '';
const updatesUrl = process.env.EXPO_UPDATES_URL
  ?? (easProjectId ? `https://u.expo.dev/${easProjectId}` : undefined);

const config: ExpoConfig = {
  name: 'Herald',
  slug: process.env.EXPO_SLUG ?? 'herald',
  version,
  orientation: 'portrait',
  scheme: 'herald',
  userInterfaceStyle: 'dark',
  icon: './assets/icon.png',
  // Zero rounding and a near-black field, per the Crowned Pixel tokens.
  backgroundColor: '#0C0A09',
  assetBundlePatterns: ['**/*'],

  android: {
    package: process.env.ANDROID_PACKAGE ?? 'design.herald.app',
    versionCode: androidVersionCode,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0C0A09',
    },
    permissions: [
      'INTERNET',
      'POST_NOTIFICATIONS',
      // Lets the in-app updater hand a downloaded APK to the system installer.
      // Android never allows a fully silent sideloaded install; the user taps
      // once to confirm, and that is the only manual step in an update.
      'REQUEST_INSTALL_PACKAGES',
    ],
    /**
     * Permissions that libraries pull in but Herald has no business asking for.
     * expo-camera declares RECORD_AUDIO because it can film video; Herald only
     * ever reads a QR code, and a job-application app asking to record audio is
     * not something a user should have to talk themselves into.
     */
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    // Deep links from notification actions: herald://match/<id>.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: false,
        data: [{ scheme: 'herald' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/splash.png',
        resizeMode: 'contain',
        backgroundColor: '#0C0A09',
      },
    ],
    [
      'expo-font',
      {
        // Both families are OFL and bundled, so type never falls back to a
        // system face on a device that has never seen them.
        fonts: [
          './assets/fonts/Cinzel-Medium.ttf',
          './assets/fonts/Cinzel-SemiBold.ttf',
          './assets/fonts/Cinzel-Bold.ttf',
          './assets/fonts/Jost-Light.ttf',
          './assets/fonts/Jost-Regular.ttf',
          './assets/fonts/Jost-Medium.ttf',
        ],
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#C6A75E',
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          // Required for the installer intent on Android 14+.
          compileSdkVersion: 35,
          targetSdkVersion: 35,
        },
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Herald uses the camera once, to scan the pairing code shown by the desktop app.',
      },
    ],
    // Signs release builds with a real keystore rather than the throwaway debug
    // one, so a later build installs over an earlier one instead of being
    // rejected for a signature mismatch.
    './plugins/with-release-signing.js',
  ],

  updates: {
    // Over-the-air updates: a JS/TS change reaches the phone without any
    // install step at all. Native changes still go through the APK updater.
    ...(updatesUrl ? { url: updatesUrl } : {}),
    enabled: updatesUrl != null,
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },
  runtimeVersion: {
    // Ties a patch to the native build it was compiled against, so an OTA
    // update can never land on an APK whose native modules do not match.
    policy: 'appVersion',
  },

  extra: {
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
    // Read at runtime by src/lib/config.ts. Every one is optional: the app
    // prompts for what it does not have rather than assuming a deployment.
    defaultEngineUrl: process.env.HERALD_DEFAULT_ENGINE_URL ?? null,
    releasesIndexUrl: process.env.HERALD_RELEASES_INDEX_URL ?? null,
    releasesPageUrl: process.env.HERALD_RELEASES_PAGE_URL ?? null,
  },

  experiments: {
    typedRoutes: true,
  },
};

export default config;
