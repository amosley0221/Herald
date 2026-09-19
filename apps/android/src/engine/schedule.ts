import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { strings } from '@herald/core';
import type { Preferences } from '@herald/core';
import { CHANNELS } from '../lib/notifications';
import { runCrawl, type CrawlOutcome } from './crawl';
import * as db from './db';

/**
 * The daily scan, on a phone.
 *
 * Android decides when background work actually runs — `minimumInterval` is a
 * floor, not a schedule, and Doze can defer a task well past it. That is a real
 * difference from the engine's cron, and it is why the scan asks "has it been
 * long enough?" rather than assuming the wake-up it just got was the one it
 * asked for. Two wake-ups in an hour cost one scan, not two.
 */

const TASK = 'herald.daily-scan';
const LAST_SCAN = 'herald.lastScanAt';
const LAST_DIGEST = 'herald.lastDigestOn';

/**
 * How often to ask for a wake-up.
 *
 * Six hours rather than twenty-four: the system defers, so asking daily would
 * reliably produce something less than daily. Asking more often and declining
 * most of the wake-ups lands closer to once a day than asking once a day does.
 */
const WAKE_INTERVAL_MINUTES = 6 * 60;

/** The scan itself will not run more often than this, however often we wake. */
const MIN_HOURS_BETWEEN_SCANS = 20;

TaskManager.defineTask(TASK, async () => {
  try {
    const last = await AsyncStorage.getItem(LAST_SCAN);
    const elapsedHours = last ? (Date.now() - Number(last)) / 3_600_000 : Infinity;
    if (elapsedHours < MIN_HOURS_BETWEEN_SCANS) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    const outcome = await runCrawl();
    await AsyncStorage.setItem(LAST_SCAN, String(Date.now()));

    const preferences = await db.getPreferences();
    if (preferences) await notify(outcome, preferences);

    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    // Throwing here would have Android back off and retry less often, which is
    // the opposite of what a failed scan needs.
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Registers the scan, if the platform will have it. */
export async function startDailyScan(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync();
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return false;

  await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: WAKE_INTERVAL_MINUTES });
  return true;
}

export async function stopDailyScan(): Promise<void> {
  if (await TaskManager.isTaskRegisteredAsync(TASK)) {
    await BackgroundTask.unregisterTaskAsync(TASK);
  }
}

export async function dailyScanRegistered(): Promise<boolean> {
  return TaskManager.isTaskRegisteredAsync(TASK);
}

/** When the last scan actually ran, for the Today screen to show. */
export async function lastScanAt(): Promise<Date | null> {
  const value = await AsyncStorage.getItem(LAST_SCAN);
  return value ? new Date(Number(value)) : null;
}

// ── Notifying ───────────────────────────────────────────────────────────────

/**
 * Tells the user what the scan found.
 *
 * Paired with an engine this arrives as a push; here the device raises it
 * itself, which is simpler — there is no token, no FCM project and no server
 * round trip, and it works offline.
 */
export async function notify(outcome: CrawlOutcome, preferences: Preferences): Promise<void> {
  if (outcome.created.length === 0) return;

  const strong = outcome.created.filter((match) => match.score >= preferences.threshold);
  const rest = outcome.created.filter((match) => match.score < preferences.threshold);

  if (preferences.instant && strong.length > 0) {
    // One notification for one match names it; several would bury each other,
    // so they collapse into a count.
    const first = strong[0] as (typeof strong)[number];
    await Notifications.scheduleNotificationAsync({
      content: {
        title: strong.length === 1 ? `${first.score} · ${first.title}` : `${strong.length} strong matches`,
        body: strong.length === 1
          ? first.company
          : strong.slice(0, 3).map((match) => `${match.score} · ${match.title}`).join('\n'),
        data: strong.length === 1 ? { matchId: first.id } : {},
        ...(await androidChannel(CHANNELS.instant)),
      },
      trigger: null,
    });
  }

  if (preferences.digest && rest.length > 0) {
    await scheduleDigest(rest.length, preferences);
  }
}

/**
 * Holds the lesser matches for the morning.
 *
 * The point of a digest is one interruption instead of many, so it is only
 * scheduled once a day however many times the scan runs.
 */
async function scheduleDigest(count: number, preferences: Preferences): Promise<void> {
  const today = new Date().toDateString();
  if ((await AsyncStorage.getItem(LAST_DIGEST)) === today) return;

  const when = new Date();
  when.setHours(preferences.digestHour, 0, 0, 0);
  // Past this morning's hour already, so it belongs to tomorrow.
  if (when.getTime() <= Date.now()) when.setDate(when.getDate() + 1);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: strings.brand.wordmark,
      body: `${count} ${count === 1 ? 'posting' : 'postings'} worth a look this morning.`,
      ...(await androidChannel(CHANNELS.digest)),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: when,
    },
  });

  await AsyncStorage.setItem(LAST_DIGEST, today);
}

/** Channels are Android-only; on any other platform this is simply nothing. */
async function androidChannel(channelId: string): Promise<{ channelId?: string }> {
  const { Platform } = await import('react-native');
  return Platform.OS === 'android' ? { channelId } : {};
}
