import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSubmitted, strings } from '@herald/core';
import { BodyText, EmptyState, Label } from '../../src/components/primitives';
import { TrackerRow } from '../../src/components/MatchRow';
import { color, display, space } from '../../src/theme';
import { useHerald, useTracker } from '../../src/state/herald';

/**
 * Tracker — everything the user has decided on, newest first.
 *
 * The count in the header is applications actually sent, not rows shown: a
 * skipped posting belongs in the history but is not something you applied to.
 */
export default function Tracker() {
  const { refreshing, refresh } = useHerald();
  const decided = useTracker();
  const insets = useSafeAreaInsets();

  const appliedCount = decided.filter((match) => isSubmitted(match.status)).length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space[4] }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={color.gold} />
      }
    >
      <View style={styles.header}>
        <BodyText style={display(28, 500)}>{strings.tracker.title.toUpperCase()}</BodyText>
        <Label>{strings.tracker.applied(appliedCount)}</Label>
      </View>

      {decided.length === 0 ? (
        <EmptyState>{strings.tracker.empty}</EmptyState>
      ) : (
        decided.map((match) => (
          <TrackerRow
            key={match.id}
            match={match}
            onPress={() => router.push(`/match/${match.id}`)}
          />
        ))
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
