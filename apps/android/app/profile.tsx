import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '@herald/core';
import { BodyText, Hairline, Label, Tag } from '../src/components/primitives';
import { color, display, space } from '../src/theme';
import { useHerald } from '../src/state/herald';

/**
 * What Herald took from the resume.
 *
 * This is the thing every score is judged against, so it is worth being able to
 * look at: a title or skill the parser missed explains a whole day of thin
 * matches, and there is no way to guess that from the matches themselves.
 */
export default function ProfileScreen() {
  const { profile, preferences } = useHerald();
  const insets = useSafeAreaInsets();

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
        <Label>{strings.detail.back}</Label>
      </Pressable>

      <View style={styles.header}>
        <BodyText style={display(22, 500)}>YOUR PROFILE</BodyText>
        <BodyText size={14} tone={color.stone} style={{ lineHeight: 22 }}>
          Read from {profile?.resumeFileName ?? 'your resume'}. Every posting is
          scored against this, so anything missing here is missing from the
          judgement too.
        </BodyText>
      </View>

      {!profile ? (
        <View style={styles.section}>
          <BodyText size={14} tone={color.stone}>No resume has been read yet.</BodyText>
        </View>
      ) : (
        <>
          <Hairline />
          <View style={styles.section}>
            <Row label="Name" value={profile.fullName} />
            <Row label="Email" value={profile.email} />
            <Row label="Phone" value={profile.phone} />
            <Row label="Location" value={profile.location} />
            <Row label="Portfolio" value={profile.portfolio} />
            <Row label="LinkedIn" value={profile.linkedin} />
            <Row
              label="Experience"
              value={profile.years != null ? `${profile.years} years` : null}
            />
          </View>

          {profile.titles.length > 0 ? (
            <>
              <Hairline />
              <View style={styles.section}>
                <Label size={11}>Titles held</Label>
                <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
                  These are what Herald looks for. A role whose title is nothing
                  like these will score low however well the rest fits.
                </BodyText>
                <View style={styles.tags}>
                  {profile.titles.map((title) => <Tag key={title}>{title}</Tag>)}
                </View>
              </View>
            </>
          ) : null}

          {profile.skills.length > 0 ? (
            <>
              <Hairline />
              <View style={styles.section}>
                <Label size={11}>Skills</Label>
                <View style={styles.tags}>
                  {profile.skills.map((skill) => <Tag key={skill}>{skill}</Tag>)}
                </View>
              </View>
            </>
          ) : null}

          {profile.summary ? (
            <>
              <Hairline />
              <View style={styles.section}>
                <Label size={11}>Summary</Label>
                <BodyText size={14} style={{ lineHeight: 23 }}>{profile.summary}</BodyText>
              </View>
            </>
          ) : null}

          <Hairline />
          <View style={styles.section}>
            <Label size={11}>What it is searching for</Label>
            <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
              {searchSentence(preferences?.roles ?? [], profile.titles)}
            </BodyText>
          </View>

          <Hairline />
          <View style={styles.section}>
            <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
              Anything wrong here comes from the resume as Herald read it.
              Re-uploading a clearer copy is the fix; the roles it searches for
              are set in Preferences and override nothing here.
            </BodyText>
          </View>
        </>
      )}
    </ScrollView>
  );
}

/**
 * Says plainly what governs the search, because the two are easy to confuse:
 * the roles list filters titles, the profile is what scoring judges against.
 */
function searchSentence(roles: string[], titles: string[]): string {
  if (roles.length > 0) {
    return `Only postings whose title matches ${roles.join(', ')} are scored. `
      + 'That list is yours, in Preferences — the profile above is what they are then judged against.';
  }
  if (titles.length > 0) {
    return 'No role filter is set, so every posting is scored against the profile '
      + `above — which leads with ${titles.slice(0, 3).join(', ')}.`;
  }
  return 'No role filter is set, so every posting is scored against the profile above.';
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.row}>
      <Label size={11} style={{ width: 96 }}>{label}</Label>
      <BodyText size={14} tone={value ? color.bone : color.stone} style={{ flex: 1 }}>
        {value ?? 'Not found'}
      </BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  back: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  header: { paddingHorizontal: space[3], paddingBottom: space[3], gap: 6 },
  section: { padding: space[3], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], paddingVertical: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
