import { Pressable, StyleSheet, View } from 'react-native';
import type { Match } from '@herald/core';
import { joinMeta, payRange, relativeTime, statusLabel, statusTone } from '@herald/core';
import { Badge, BodyText, Numeral } from './primitives';
import { color, labelTight, space } from '../theme';

/**
 * A row in the Matches feed.
 *
 * `variant` is the Approve-now / Digest split: an instant row leads with a
 * 28px gold score and carries the pay and source line; a digest row is
 * compacted to a 20px stone score and two lines, because it is a list to skim
 * rather than a list to act on.
 */
export function MatchRow({ match, variant = 'instant', onPress }: {
  match: Match;
  variant?: 'instant' | 'digest';
  onPress: () => void;
}) {
  const { posting } = match;
  const instant = variant === 'instant';
  const pay = payRange(posting.payMin, posting.payMax, posting.payCurrency, posting.pay);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${match.score}. ${posting.title} at ${posting.company}`}
      style={({ pressed }) => [
        styles.row,
        instant ? styles.rowInstant : styles.rowDigest,
        pressed && { backgroundColor: color.graphite },
      ]}
    >
      <View style={styles.scoreColumn}>
        <Numeral size={instant ? 28 : 20} tone={instant ? color.gold : color.stone}>
          {String(match.score)}
        </Numeral>
      </View>

      <View style={styles.body}>
        <BodyText size={instant ? 15 : 14} weight={500} numberOfLines={2}>
          {posting.title}
        </BodyText>
        <BodyText size={14} tone={color.stone} numberOfLines={1}>
          {joinMeta(posting.company, posting.location)}
        </BodyText>
        {instant ? (
          <BodyText
            size={11}
            tone={color.stone}
            numberOfLines={1}
            style={labelTight(11)}
          >
            {joinMeta(pay, posting.source, relativeTime(new Date(posting.postedAt)))}
          </BodyText>
        ) : null}
      </View>

      {match.status !== 'pending' ? (
        <Badge tone={statusTone(match.status)}>{statusLabel(match.status)}</Badge>
      ) : null}
    </Pressable>
  );
}

/** The Tracker's read of a match: role, company and date, with the status. */
export function TrackerRow({ match, onPress }: { match: Match; onPress: () => void }) {
  const decided = match.submittedAt ?? match.decidedAt ?? match.createdAt;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${match.posting.title} at ${match.posting.company}, ${statusLabel(match.status)}`}
      style={({ pressed }) => [styles.row, styles.rowInstant, pressed && { backgroundColor: color.graphite }]}
    >
      <View style={styles.body}>
        <BodyText size={15} weight={500} numberOfLines={2}>{match.posting.title}</BodyText>
        <BodyText size={14} tone={color.stone} numberOfLines={1}>
          {joinMeta(match.posting.company, formatDecided(decided))}
        </BodyText>
      </View>
      <Badge tone={statusTone(match.status)}>{statusLabel(match.status)}</Badge>
    </Pressable>
  );
}

function formatDecided(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowInstant: { paddingVertical: space[2] },
  rowDigest: { paddingVertical: 12 },
  scoreColumn: { width: 44, alignItems: 'flex-start' },
  body: { flex: 1, gap: 2 },
});
