import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReleaseEntry } from '@herald/core';
import { strings, toRoman } from '@herald/core';
import {
  BodyText, Button, EmptyState, Hairline, Label, Numeral,
} from '../src/components/primitives';
import { color, display, space } from '../src/theme';
import { appConfig } from '../src/lib/config';
import { applyOtaUpdate, checkForOtaUpdate, runtimeInfo } from '../src/lib/updates';
import { useHerald } from '../src/state/herald';

/**
 * What's new.
 *
 * Reads the release feed the engine proxies and renders it in Herald's own
 * style: version in Cinzel, the date as roman numerals, notes in Jost 300, a
 * hairline between versions. Patches are listed under their release, because a
 * code-push patch is a real change the user received and should be able to see.
 */
export default function Releases() {
  const { releases, showToast } = useHerald();
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const [staged, setStaged] = useState(false);

  const runtime = runtimeInfo();

  const check = async () => {
    setChecking(true);
    const result = await checkForOtaUpdate();
    setChecking(false);
    if (result.status === 'downloaded') {
      setStaged(true);
      showToast(strings.releases.restartToApply);
    } else if (result.status === 'up-to-date') {
      showToast(strings.releases.upToDate);
    } else if (result.status === 'failed') {
      showToast(result.error ?? strings.errors.generic, 'danger');
    } else {
      showToast(strings.releases.upToDate);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + space[4] }}
    >
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/preferences'))}
        accessibilityRole="button"
        hitSlop={12}
        style={styles.back}
      >
        <Label>{strings.releases.back}</Label>
      </Pressable>

      <View style={styles.header}>
        <BodyText style={display(28, 500)}>{strings.releases.title.toUpperCase()}</BodyText>
        <Label>{strings.releases.current(appConfig.version)}</Label>
        {runtime.updateId && !runtime.embedded ? (
          <Label size={11}>{`Patch ${runtime.updateId.slice(0, 8)}`}</Label>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Button
          variant="outline"
          loading={checking}
          onPress={() => (staged ? void applyOtaUpdate() : void check())}
        >
          {staged ? strings.releases.restartToApply : strings.releases.checking}
        </Button>
        {appConfig.releasesPageUrl ? (
          <Button variant="ghost" onPress={() => void Linking.openURL(appConfig.releasesPageUrl!)}>
            Open on the web
          </Button>
        ) : null}
      </View>

      <Hairline />

      {!releases || releases.releases.length === 0 ? (
        <EmptyState>{strings.releases.empty}</EmptyState>
      ) : (
        releases.releases.map((release) => (
          <ReleaseSection key={release.version} release={release} />
        ))
      )}
    </ScrollView>
  );
}

function ReleaseSection({ release }: { release: ReleaseEntry }) {
  const current = release.version === appConfig.version;
  return (
    <View style={styles.release}>
      <View style={styles.releaseHeader}>
        <Numeral size={20} tone={current ? color.gold : color.bone}>{release.version}</Numeral>
        <Label size={11}>{romanDate(release.date)}</Label>
      </View>

      <Notes markdown={release.notesMarkdown} />

      {release.patches?.length ? (
        <View style={styles.patches}>
          {release.patches.map((patch) => (
            <View key={patch.number} style={{ gap: 6 }}>
              <Label size={11} tone="gold">{strings.releases.patch(patch.number)}</Label>
              <Notes markdown={patch.notesMarkdown} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Renders the Keep-a-Changelog subset the notes actually use: `###` section
 * headings and `-` bullets. A full Markdown renderer would be a dependency and
 * a second type system for one screen.
 */
function Notes({ markdown }: { markdown: string }) {
  const lines = markdown.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <View style={{ gap: 8 }}>
      {lines.map((line, index) => {
        if (line.startsWith('#')) {
          return (
            <Label key={index} size={11} style={{ marginTop: index === 0 ? 0 : space[1] }}>
              {line.replace(/^#+\s*/, '')}
            </Label>
          );
        }
        if (line.startsWith('-') || line.startsWith('*')) {
          return (
            <View key={index} style={styles.bullet}>
              <BodyText size={14} tone={color.gold}>·</BodyText>
              <BodyText size={14} style={{ flex: 1, lineHeight: 23 }}>
                {stripInlineMarkdown(line.replace(/^[-*]\s*/, ''))}
              </BodyText>
            </View>
          );
        }
        return (
          <BodyText key={index} size={14} style={{ lineHeight: 23 }}>
            {stripInlineMarkdown(line)}
          </BodyText>
        );
      })}
    </View>
  );
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** `2026-09-18` -> `18 · IX · MMXXVI`, matching the Today dateline. */
function romanDate(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) return iso;
  return `${Number(parts[3])} · ${toRoman(Number(parts[2]))} · ${toRoman(Number(parts[1]))}`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  back: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  header: { paddingHorizontal: space[3], paddingBottom: space[3], gap: 6 },
  actions: { paddingHorizontal: space[3], paddingBottom: space[3], gap: space[1], alignItems: 'flex-start' },
  release: {
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    gap: space[2],
  },
  releaseHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space[2] },
  bullet: { flexDirection: 'row', gap: 12 },
  patches: { gap: space[2], paddingTop: space[1] },
});
