import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clockTime, strings } from '@herald/core';
import { BodyText, EmptyState, Label, SectionLabel } from '../../src/components/primitives';
import { MatchRow } from '../../src/components/MatchRow';
import { color, display, space } from '../../src/theme';
import { useFeed, useHerald } from '../../src/state/herald';

/**
 * Matches — the feed, split into the two sections the threshold defines.
 *
 * Approve now (gold label) is everything at or above the threshold; Morning
 * digest (stone label) is the rest. Moving the threshold in Preferences
 * re-splits this list immediately.
 */
export default function Matches() {
  const { preferences, refreshing, refresh } = useHerald();
  const { instant, digest, pending, threshold } = useFeed();
  const insets = useSafeAreaInsets();

  const digestTime = clockTime(preferences?.digestHour ?? 7);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space[4] }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.gold} />
      }
    >
      <View style={styles.header}>
        <BodyText style={display(28, 500)}>{strings.matches.title.toUpperCase()}</BodyText>
        <Label>{strings.matches.pending(pending.length)}</Label>
      </View>

      {pending.length === 0 ? (
        <EmptyState>{strings.matches.empty}</EmptyState>
      ) : (
        <>
          <SectionLabel tone="gold">{strings.matches.approveNow(threshold)}</SectionLabel>
          {instant.length === 0 ? (
            <EmptyState>{strings.matches.emptyAboveThreshold}</EmptyState>
          ) : (
            instant.map((match) => (
              <MatchRow
                key={match.id}
                match={match}
                variant="instant"
                onPress={() => router.push(`/match/${match.id}`)}
              />
            ))
          )}

          {digest.length > 0 ? (
            <>
              <SectionLabel>{strings.matches.digest(digestTime)}</SectionLabel>
              {digest.map((match) => (
                <MatchRow
                  key={match.id}
                  match={match}
                  variant="digest"
                  onPress={() => router.push(`/match/${match.id}`)}
                />
              ))}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
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
});
