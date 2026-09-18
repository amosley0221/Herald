import Constants from 'expo-constants';
import * as Application from 'expo-application';

/**
 * Build-time configuration, read from `app.config.ts`'s `extra`.
 *
 * Every field is optional. The app asks the user for whatever it does not have
 * rather than assuming any particular deployment, which is what lets one build
 * work against any engine.
 */
interface Extra {
  defaultEngineUrl: string | null;
  releasesIndexUrl: string | null;
  releasesPageUrl: string | null;
}

const extra = (Constants.expoConfig?.extra ?? {}) as Partial<Extra>;

export const appConfig = {
  /** Pre-filled on the pairing screen when a build was made for one engine. */
  defaultEngineUrl: extra.defaultEngineUrl ?? null,
  /**
   * Release feed for the What's new screen and the APK updater. The engine also
   * proxies this at `GET /releases`, which is preferred once paired because it
   * keeps the phone talking to a single origin.
   */
  releasesIndexUrl: extra.releasesIndexUrl ?? null,
  /** Public release-notes page, offered as a link from What's new. */
  releasesPageUrl: extra.releasesPageUrl ?? null,

  /** Version of the installed binary, which is what the updater compares. */
  version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '0.0.0',
  buildVersion: Application.nativeBuildVersion ?? null,
  packageName: Application.applicationId ?? null,
} as const;
