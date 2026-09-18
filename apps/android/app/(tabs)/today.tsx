import { useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { heraldDate, strings, thousands } from '@herald/core';
import {
  BodyText, EmptyState, Label, Numeral, SectionLabel, StatGrid,
} from '../../src/components/primitives';
import { MatchRow } from '../../src/components/MatchRow';
import { color, display, space } from '../../src/theme';
import { appConfig } from '../../src/lib/config';
import {
  checkForOtaUpdate, downloadAndInstallApk, findNativeUpdate, type NativeUpdate,
} from '../../src/lib/updates';
import { getLastSeenVersion, setLastSeenVersion } from '../../src/lib/storage';
import { useFeed, useHerald } from '../../src/state/herald';

/**
 * Today — the summary screen.
 *
 * Stat grid, the sentence that puts the numbers in words, then everything
 * waiting on the user. The update banner lives here because it is the first
 * screen after launch and the only one the user is guaranteed to see.
 */
export default function Today() {
  const { stats, preferences, releases, refreshing, refresh, error, showToast } = useHerald();
  const { instant, pending } = useFeed();
  const insets = useSafeAreaInsets();
  const [nativeUpdate, setNativeUpdate] = useState<NativeUpdate | null>(null);

  // Two layers of updating, both checked on mount. An OTA patch downloads
  // silently and applies on the next launch; a native one needs the banner.
  useEffect(() => {
    void checkForOtaUpdate();
  }, []);

  useEffect(() => {
    setNativeUpdate(findNativeUpdate(releases));
  }, [releases]);

  // A one-time toast after an update lands, per the release spec.
  useEffect(() => {
    void (async () => {
      const lastSeen = await getLastSeenVersion();
      if (lastSeen && lastSeen !== appConfig.version) {
        showToast(strings.today.updatedToast(appConfig.version));
      }
      if (lastSeen !== appConfig.version) await setLastSeenVersion(appConfig.version);
    })();
  }, [showToast]);

  const timezone = preferences?.timezone;
  const read = stats?.read ?? 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space[4] }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.gold} />
      }
    >
      <View style={styles.header}>
        <BodyText style={display(28, 500)}>{strings.today.title.toUpperCase()}</BodyText>
        <Numeral size={13} tone={color.stone}>{heraldDate(new Date(), timezone)}</Numeral>
      </View>

      {nativeUpdate ? <UpdateBanner update={nativeUpdate} /> : null}

      {error ? (
        <View style={styles.notice}>
          <BodyText size={13} tone={color.danger}>{error}</BodyText>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: space[3] }}>
        <StatGrid
          columns={2}
          stats={[
            { label: strings.today.stats.read, value: thousands(read) },
            { label: strings.today.stats.matched, value: String(stats?.matched ?? 0) },
            { label: strings.today.stats.applied, value: String(stats?.applied ?? 0) },
            { label: strings.today.stats.pending, value: String(stats?.pending ?? 0) },
          ]}
        />
      </View>

      <View style={{ paddingHorizontal: space[3], paddingVertical: space[3] }}>
        {read > 0 ? (
          <BodyText size={14} tone={color.stone} style={{ lineHeight: 23 }}>
            {strings.today.sentence(thousands(read), instant.length)}
          </BodyText>
        ) : (
          <BodyText size={14} tone={color.stone}>{strings.today.empty}</BodyText>
        )}
      </View>

      <SectionLabel>{strings.today.awaiting(pending.length)}</SectionLabel>

      {pending.length === 0 ? (
        <EmptyState>{strings.today.emptyPending}</EmptyState>
      ) : (
        pending.map((match) => (
          <MatchRow
            key={match.id}
            match={match}
            variant={match.score >= (preferences?.threshold ?? 85) ? 'instant' : 'digest'}
            onPress={() => router.push(`/match/${match.id}`)}
          />
        ))
      )}
    </ScrollView>
  );
}

/**
 * "Version 1.5.0 is available · Install".
 *
 * Tapping downloads the APK and hands it to the system installer. Android will
 * not install a sideloaded package silently, so the user confirms once — that
 * is the whole of the manual work in a native update.
 */
function UpdateBanner({ update }: { update: NativeUpdate }) {
  const { showToast } = useHerald();
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);

  const apkUrl = findApkUrl(update.version);

  const install = async () => {
    if (!apkUrl) {
      // Without a download URL the best we can do is point at the notes, which
      // carry a link to the release.
      router.push('/releases');
      return;
    }
    setBusy(true);
    try {
      await downloadAndInstallApk(apkUrl, update.version, ({ fraction }) => {
        setPercent(fraction != null ? Math.round(fraction * 100) : null);
      });
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    } finally {
      setBusy(false);
      setPercent(null);
    }
  };

  return (
    <Pressable
      onPress={busy ? undefined : () => void install()}
      accessibilityRole="button"
      style={({ pressed }) => [styles.banner, pressed && { backgroundColor: color.graphite }]}
    >
      <BodyText size={13} style={{ flex: 1 }}>
        {strings.today.updateAvailable(update.version)}
      </BodyText>
      <Label tone="gold">
        {busy
          ? (percent != null ? `${percent}%` : strings.releases.downloading)
          : strings.today.updateAction}
      </Label>
    </Pressable>
  );
}

/**
 * Where the APK for a version lives.
 *
 * Derived from the release feed's own URL so it follows whatever the CI
 * publishes, rather than assuming a hosting layout.
 */
function findApkUrl(version: string): string | null {
  const indexUrl = appConfig.releasesIndexUrl;
  if (!indexUrl) return null;
  try {
    // releases/index.json -> releases/herald-<version>.apk
    return new URL(`herald-${version}.apk`, indexUrl).toString();
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[3],
    marginBottom: space[2],
    paddingVertical: 12,
    paddingHorizontal: space[2],
    borderWidth: 1,
    borderColor: color.line,
  },
  notice: {
    marginHorizontal: space[3],
    marginBottom: space[2],
    paddingVertical: 10,
    paddingHorizontal: space[2],
    borderWidth: 1,
    borderColor: color.danger,
  },
});
