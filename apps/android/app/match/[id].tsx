import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { payRange, relativeTime, statusLabel, statusTone, strings } from '@herald/core';
import {
  Badge, BodyText, Button, EmptyState, Hairline, Label, Numeral,
} from '../../src/components/primitives';
import { color, hairline, space } from '../../src/theme';
import { useHerald } from '../../src/state/herald';

/**
 * Match detail.
 *
 * The score and role, the four-cell meta grid, then the two lists the scoring
 * model produced: why it fits, in gold, and where it does not, in stone. A
 * pending match ends in Approve over Skip; a decided one shows its status
 * instead, because there is nothing left to do from here.
 */
export default function MatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matchById, approve, skip, showToast } = useHerald();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const match = id ? matchById(id) : undefined;

  if (!match) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <BackLink />
        <EmptyState>That match is no longer in the feed.</EmptyState>
      </View>
    );
  }

  const { posting } = match;
  const pay = payRange(posting.payMin, posting.payMax, posting.payCurrency, posting.pay);

  const onApprove = async () => {
    setBusy(true);
    try {
      await approve(match.id);
      router.push(`/review/${match.id}`);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + space[3] }}
    >
      <BackLink />

      <View style={styles.headline}>
        <Numeral size={48}>{String(match.score)}</Numeral>
        <View style={{ flex: 1, gap: 4 }}>
          <BodyText size={18} weight={500}>{posting.title}</BodyText>
          <BodyText size={14} tone={color.stone}>{posting.company}</BodyText>
        </View>
      </View>

      <View style={styles.metaGrid}>
        <MetaCell label={strings.detail.meta.location} value={posting.location || '—'} borderRight borderBottom />
        <MetaCell label={strings.detail.meta.compensation} value={pay ?? 'Not published'} borderBottom />
        <MetaCell label={strings.detail.meta.source} value={posting.source} borderRight />
        <MetaCell label={strings.detail.meta.posted} value={relativeTime(new Date(posting.postedAt))} />
      </View>

      {match.why.length > 0 ? (
        <View style={styles.reasons}>
          <Label tone="gold">{strings.detail.why}</Label>
          {match.why.map((reason) => (
            <View key={reason} style={styles.bullet}>
              <BodyText size={14} tone={color.gold}>·</BodyText>
              <BodyText size={14} style={{ flex: 1, lineHeight: 23 }}>{reason}</BodyText>
            </View>
          ))}
        </View>
      ) : null}

      {match.gaps.length > 0 ? (
        <View style={styles.reasons}>
          <Label>{strings.detail.gaps}</Label>
          {match.gaps.map((gap) => (
            <View key={gap} style={styles.bullet}>
              <BodyText size={14} tone={color.stone}>·</BodyText>
              <BodyText size={14} tone={color.stone} style={{ flex: 1, lineHeight: 23 }}>{gap}</BodyText>
            </View>
          ))}
        </View>
      ) : null}

      {match.blockedReason ? (
        <View style={styles.blocked}>
          <BodyText size={13} tone={color.danger}>{match.blockedReason}</BodyText>
        </View>
      ) : null}

      <Hairline style={{ marginTop: space[3] }} />

      {match.status === 'pending' ? (
        <View style={styles.actions}>
          <Button fullWidth loading={busy} onPress={() => void onApprove()}>
            {strings.detail.approve}
          </Button>
          <Button variant="ghost" fullWidth disabled={busy} onPress={() => { void skip(match.id); router.back(); }}>
            {strings.detail.skip}
          </Button>
        </View>
      ) : match.status === 'approved' ? (
        <View style={styles.actions}>
          <Button fullWidth onPress={() => router.push(`/review/${match.id}`)}>
            {strings.review.title}
          </Button>
        </View>
      ) : (
        <View style={styles.statusBox}>
          <Badge tone={statusTone(match.status)}>{statusLabel(match.status)}</Badge>
        </View>
      )}
    </ScrollView>
  );
}

function BackLink() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/matches'))}
      accessibilityRole="button"
      hitSlop={12}
      style={styles.back}
    >
      <Label>{strings.detail.back}</Label>
    </Pressable>
  );
}

function MetaCell({ label, value, borderRight, borderBottom }: {
  label: string; value: string; borderRight?: boolean; borderBottom?: boolean;
}) {
  return (
    <View style={[
      styles.metaCell,
      borderRight ? hairline.right : null,
      borderBottom ? hairline.bottom : null,
    ]}>
      <Label size={11}>{label}</Label>
      <BodyText size={14} numberOfLines={2}>{value}</BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  back: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  headline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingBottom: space[3],
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: space[3],
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.line,
  },
  metaCell: { width: '50%', paddingVertical: space[2], paddingHorizontal: space[2], gap: 4 },
  reasons: { paddingHorizontal: space[3], paddingTop: space[3], gap: 10 },
  bullet: { flexDirection: 'row', gap: 12 },
  blocked: {
    marginHorizontal: space[3],
    marginTop: space[3],
    padding: space[2],
    borderWidth: 1,
    borderColor: color.danger,
  },
  actions: { paddingHorizontal: space[3], paddingTop: space[3], gap: space[1] },
  statusBox: { paddingHorizontal: space[3], paddingTop: space[3] },
});
