import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { HeraldClient } from '@herald/core';
import { color } from '../theme';
import { appConfig } from './config';
import { getRegisteredPushToken, setRegisteredPushToken } from './storage';

/**
 * Push notifications.
 *
 * Three channels, matching what the engine sends: an instant push for a match
 * above the threshold, the morning digest, and "finish this one yourself" when
 * a submission hits a wall. The instant channel carries Approve / View / Skip
 * actions, so a strong match can be acted on from the lock screen.
 */

/** Must match `CHANNELS` in services/engine/src/notify/index.ts. */
export const CHANNELS = {
  instant: 'herald-instant',
  digest: 'herald-digest',
  attention: 'herald-attention',
} as const;

/** Must match `CATEGORIES` in the engine. */
export const CATEGORIES = {
  match: 'HERALD_MATCH',
  digest: 'HERALD_DIGEST',
  attention: 'HERALD_ATTENTION',
} as const;

export const ACTIONS = {
  approve: 'approve',
  view: 'view',
  skip: 'skip',
} as const;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Registers channels and action buttons and asks for permission.
 *
 * Split out from `registerForPush` because a device doing its own scanning
 * needs all of this and none of the token: it raises its own notifications, so
 * there is no Firebase project to depend on.
 *
 * Returns false when the user declines — the app keeps working, matches just
 * wait in the feed instead of announcing themselves.
 */
export async function prepareNotifications(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Promise.all([
      Notifications.setNotificationChannelAsync(CHANNELS.instant, {
        name: 'Strong matches',
        description: 'A posting that cleared your approval threshold.',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: color.gold,
        sound: null,
        vibrationPattern: [0, 120],
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.digest, {
        name: 'Morning digest',
        description: 'One summary of everything below your threshold.',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: color.gold,
        sound: null,
      }),
      Notifications.setNotificationChannelAsync(CHANNELS.attention, {
        name: 'Needs you',
        description: 'An application Herald could not finish on your behalf.',
        importance: Notifications.AndroidImportance.HIGH,
        lightColor: color.gold,
        sound: null,
      }),
    ]);
  }

  // The Approve action opens the app on the Review screen; Skip resolves
  // without opening it at all, which is the whole point of having it there.
  await Notifications.setNotificationCategoryAsync(CATEGORIES.match, [
    { identifier: ACTIONS.approve, buttonTitle: 'Approve', options: { opensAppToForeground: true } },
    { identifier: ACTIONS.view, buttonTitle: 'View', options: { opensAppToForeground: true } },
    { identifier: ACTIONS.skip, buttonTitle: 'Skip', options: { opensAppToForeground: false } },
  ]);

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  return status === 'granted';
}

/**
 * The above, plus the device push token an engine needs to reach this phone.
 * Returns null when permission was declined or no token could be obtained.
 */
export async function registerForPush(): Promise<string | null> {
  if (!(await prepareNotifications())) return null;

  try {
    const { data } = await Notifications.getDevicePushTokenAsync();
    return typeof data === 'string' ? data : null;
  } catch {
    // A build without Firebase credentials cannot get a token. That is a
    // configuration gap, not a crash: the feed still works.
    return null;
  }
}

/**
 * Registers this device with the engine, skipping the call when the token has
 * not changed since last launch.
 */
export async function syncPushToken(client: HeraldClient): Promise<void> {
  const token = await registerForPush();
  if (!token) return;
  const previous = await getRegisteredPushToken();
  if (previous === token) return;
  await client.registerDevice({ token, platform: 'android', appVersion: appConfig.version });
  await setRegisteredPushToken(token);
}

/** Pulls the fields the engine puts in a notification's data payload. */
export interface NotificationPayload {
  type?: 'match' | 'digest' | 'needs_you';
  matchId?: string;
  deepLink?: string;
  reason?: string;
  applyUrl?: string;
}

export function readPayload(notification: Notifications.Notification): NotificationPayload {
  return (notification.request.content.data ?? {}) as NotificationPayload;
}
