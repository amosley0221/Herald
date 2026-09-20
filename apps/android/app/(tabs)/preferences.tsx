import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clockTime, strings, thousands } from '@herald/core';
import {
  BodyText, Button, Hairline, Label, Numeral, Slider, Switch, Tag,
} from '../../src/components/primitives';
import { body, color, display, space } from '../../src/theme';
import { appConfig } from '../../src/lib/config';
import { useHerald } from '../../src/state/herald';

/**
 * Preferences — everything that steers the engine, plus the way out to
 * What's new and to disconnecting the engine.
 *
 * Changes save as they are made. There is no Save button because there is
 * nothing here that is only valid as a set.
 */
export default function Preferences() {
  const { preferences, profile, mode, updatePreferences, disconnect } = useHerald();
  const insets = useSafeAreaInsets();
  const [newRole, setNewRole] = useState('');

  if (!preferences) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + space[4] }}>
        <BodyText size={14} tone={color.stone} style={{ paddingHorizontal: space[3] }}>
          {strings.errors.offline}
        </BodyText>
      </ScrollView>
    );
  }

  const digestTime = clockTime(preferences.digestHour);

  const addRole = () => {
    const role = newRole.trim();
    if (!role || preferences.roles.includes(role)) return;
    void updatePreferences({ roles: [...preferences.roles, role] });
    setNewRole('');
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: space[4] }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <BodyText style={display(28, 500)}>{strings.preferences.title.toUpperCase()}</BodyText>
      </View>

      <Section label={strings.preferences.roles}>
        <View style={styles.tags}>
          {preferences.roles.map((role) => (
            <Tag
              key={role}
              onRemove={() => void updatePreferences({ roles: preferences.roles.filter((r) => r !== role) })}
            >
              {role}
            </Tag>
          ))}
        </View>
        <View style={styles.addRow}>
          <TextInput
            value={newRole}
            onChangeText={setNewRole}
            onSubmitEditing={addRole}
            placeholder={strings.preferences.addRole}
            placeholderTextColor={color.stone}
            returnKeyType="done"
            style={[body(15, 400), styles.input, { flex: 1 }]}
          />
          <Button variant="outline" onPress={addRole} disabled={!newRole.trim()}>Add</Button>
        </View>
      </Section>

      <Section label={strings.preferences.location}>
        <TextInput
          defaultValue={preferences.locations.join(', ')}
          onEndEditing={(event) => {
            const locations = event.nativeEvent.text
              .split(',').map((part) => part.trim()).filter(Boolean);
            void updatePreferences({ locations });
          }}
          placeholder="Charlotte, NC"
          placeholderTextColor={color.stone}
          style={[body(15, 400), styles.input]}
        />
        <Switch
          label="Include remote roles"
          value={preferences.remote}
          onChange={(next) => void updatePreferences({ remote: next })}
        />
      </Section>

      <Section label={strings.preferences.minSalary}>
        <View style={styles.numeralRow}>
          <Numeral size={28}>
            {preferences.minSalary != null ? `$${thousands(preferences.minSalary)}` : '—'}
          </Numeral>
          <TextInput
            defaultValue={preferences.minSalary != null ? String(preferences.minSalary) : ''}
            onEndEditing={(event) => {
              const raw = event.nativeEvent.text.replace(/[^\d]/g, '');
              void updatePreferences({ minSalary: raw ? Number(raw) : null });
            }}
            keyboardType="number-pad"
            placeholder="No minimum"
            placeholderTextColor={color.stone}
            style={[body(15, 400), styles.input, { flex: 1 }]}
          />
        </View>
      </Section>

      <Section label={strings.preferences.threshold}>
        <View style={styles.numeralRow}>
          <Numeral size={40}>{String(preferences.threshold)}</Numeral>
          <BodyText size={14} tone={color.stone} style={{ flex: 1 }}>
            {strings.onboarding.threshold.explainer}
          </BodyText>
        </View>
        <Slider
          value={preferences.threshold}
          min={60}
          max={99}
          onChange={(next) => void updatePreferences({ threshold: next })}
        />
      </Section>

      <Section>
        <Switch
          label={strings.onboarding.threshold.instant}
          value={preferences.instant}
          onChange={(next) => void updatePreferences({ instant: next })}
        />
        <Switch
          label={strings.onboarding.threshold.digest(digestTime)}
          value={preferences.digest}
          onChange={(next) => void updatePreferences({ digest: next })}
        />
        <Switch
          label={strings.onboarding.threshold.tailor}
          value={preferences.tailorLetter}
          onChange={(next) => void updatePreferences({ tailorLetter: next })}
        />
      </Section>

      <Section label={strings.preferences.dailyCap}>
        <View style={styles.numeralRow}>
          <Numeral size={28}>{String(preferences.dailySubmitCap)}</Numeral>
          <BodyText size={13} tone={color.stone} style={{ flex: 1 }}>
            Herald never submits more than this many applications in a day.
          </BodyText>
        </View>
        <Slider
          value={preferences.dailySubmitCap}
          min={0}
          max={50}
          onChange={(next) => void updatePreferences({ dailySubmitCap: next })}
        />
      </Section>

      {profile ? (
        <Section label="Application details">
          <LabelledInput
            label={strings.review.fields.authorization}
            value={profile.workAuthorization}
            placeholder="US citizen · no sponsorship"
          />
          <LabelledInput
            label={strings.review.fields.availability}
            value={profile.availability}
            placeholder="Two weeks"
          />
        </Section>
      ) : null}

      <Hairline />
      <Pressable
        onPress={() => router.push('/releases')}
        accessibilityRole="button"
        style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: color.graphite }]}
      >
        <BodyText size={15} style={{ flex: 1 }}>{strings.preferences.about}</BodyText>
        <Label>{appConfig.version}</Label>
      </Pressable>
      <Hairline />

      {mode === 'local' ? (
        <>
          <Pressable
            onPress={() => router.push('/profile')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: color.graphite }]}
          >
            <BodyText size={15} style={{ flex: 1 }}>What Herald read from your resume</BodyText>
            <Label>View</Label>
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() => router.push('/sources')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: color.graphite }]}
          >
            <BodyText size={15} style={{ flex: 1 }}>Job sources</BodyText>
            <Label>Edit</Label>
          </Pressable>
          <Hairline />
          <Pressable
            onPress={() => router.push('/engine-settings')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.linkRow, pressed && { backgroundColor: color.graphite }]}
          >
            <BodyText size={15} style={{ flex: 1 }}>Key and models</BodyText>
            <Label>Edit</Label>
          </Pressable>
          <Hairline />
          <View style={{ padding: space[3], gap: space[2] }}>
            <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
              Herald is scanning on this phone. It runs when the phone is awake
              and charged; nothing leaves the device except the postings it
              scores.
            </BodyText>
          </View>
        </>
      ) : (
        <View style={{ padding: space[3], gap: space[2] }}>
          <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
            Sources are configured on the engine. Herald reads every board listed
            there once an hour.
          </BodyText>
          <Button variant="ghost" onPress={() => void disconnect()}>
            {strings.preferences.signOut}
          </Button>
        </View>
      )}
    </ScrollView>
  );
}

function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      {label ? <Label>{label}</Label> : null}
      {children}
    </View>
  );
}

/** A profile field the resume never carries but application forms always ask. */
function LabelledInput({ label, value, placeholder }: {
  label: string; value: string | null; placeholder: string;
}) {
  const { updateProfile } = useHerald();
  return (
    <View style={{ gap: 6 }}>
      <Label size={11}>{label}</Label>
      <TextInput
        defaultValue={value ?? ''}
        onEndEditing={(event) => {
          const next = event.nativeEvent.text.trim();
          const key = label === strings.review.fields.authorization ? 'workAuthorization' : 'availability';
          void updateProfile({ [key]: next || null });
        }}
        placeholder={placeholder}
        placeholderTextColor={color.stone}
        style={[body(15, 400), styles.input]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  header: {
    paddingHorizontal: space[3],
    paddingTop: space[4],
    paddingBottom: space[3],
  },
  section: {
    paddingHorizontal: space[3],
    paddingVertical: space[3],
    borderTopWidth: 1,
    borderTopColor: color.line,
    gap: space[2],
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  numeralRow: { flexDirection: 'row', alignItems: 'baseline', gap: space[2] },
  input: {
    borderWidth: 1,
    borderColor: color.line,
    color: color.bone,
    paddingHorizontal: space[2],
    paddingVertical: 10,
    minHeight: 44,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    minHeight: 56,
  },
});
