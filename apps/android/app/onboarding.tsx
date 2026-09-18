import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '@herald/core';
import {
  BodyText, Button, Emblem, Hairline, Label, Numeral, Screen, Slider, Switch, Tag,
} from '../src/components/primitives';
import { color, display, space } from '../src/theme';
import { useHerald } from '../src/state/herald';

/**
 * Onboarding — the three steps from the handoff, in one screen so the
 * "STEP I OF III" header stays put while the body beneath it changes.
 *
 * I   Upload resume
 * II  Parsing, then the extracted profile
 * III Approval threshold and the three switches
 */
export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  return (
    <Screen contentStyle={{ paddingTop: insets.top + space[4], paddingHorizontal: space[3], paddingBottom: insets.bottom + space[3], gap: space[3], minHeight: '100%' }}>
      <Emblem size={40} />
      <View>
        <BodyText style={display(28, 500)}>{strings.brand.wordmark}</BodyText>
        <Label style={{ marginTop: space[1] }}>{strings.onboarding.stepOf(step, 3)}</Label>
      </View>

      {step === 1 ? <StepUpload onDone={() => setStep(2)} /> : null}
      {step === 2 ? <StepParsing onDone={() => setStep(3)} /> : null}
      {step === 3 ? <StepThreshold /> : null}
    </Screen>
  );
}

// ── Step I · Upload ─────────────────────────────────────────────────────────

function StepUpload({ onDone }: { onDone: () => void }) {
  const { uploadResume, showToast } = useHerald();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
      ],
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setBusy(true);
    try {
      const warnings = await uploadResume({
        name: asset.name,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        data: { uri: asset.uri },
      });
      // Warnings are real but not blocking — a missing phone number should not
      // stop onboarding, it should just be said once.
      if (warnings.length > 0) showToast(warnings[0]!);
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : strings.onboarding.upload.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <BodyText size={16} style={{ lineHeight: 26 }}>{strings.onboarding.upload.body}</BodyText>

      <Pressable
        onPress={busy ? undefined : () => void pick()}
        accessibilityRole="button"
        accessibilityLabel={strings.onboarding.upload.cta}
        style={({ pressed }) => [styles.dropzone, pressed && { backgroundColor: color.graphite }]}
      >
        <Label tone="gold">{strings.onboarding.upload.cta}</Label>
        <BodyText size={13} tone={color.stone} style={{ marginTop: space[1] }}>
          {strings.onboarding.upload.formats}
        </BodyText>
      </Pressable>

      {error ? <BodyText size={13} tone={color.danger}>{error}</BodyText> : null}

      <View style={{ flex: 1 }} />
      <BodyText size={13} tone={color.stone}>{strings.onboarding.upload.footer}</BodyText>
    </>
  );
}

// ── Step II · Parsing ───────────────────────────────────────────────────────

function StepParsing({ onDone }: { onDone: () => void }) {
  const { profile } = useHerald();
  const [percent, setPercent] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // The upload already completed before this step mounted, so the progress bar
  // is a readout of a finished job. It still runs, because the labels tell the
  // user what Herald actually did with their resume — and it is the only place
  // that is explained.
  useEffect(() => {
    timer.current = setInterval(() => {
      setPercent((current) => {
        const next = Math.min(100, current + 4);
        if (next >= 100 && timer.current) clearInterval(timer.current);
        return next;
      });
    }, 90);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const done = percent >= 100;
  const steps = strings.onboarding.parsing.steps;
  const stepLabel = steps[Math.min(steps.length - 1, Math.floor(percent / 25))];

  const derivedSummary = [
    profile?.years != null ? `${profile.years} years` : null,
    profile?.titles[0] ?? null,
    profile?.location ?? null,
  ].filter(Boolean).join(' · ');
  const summary = profile?.summary || derivedSummary || strings.onboarding.parsing.summaryFallback;

  return (
    <>
      <View style={styles.fileRow}>
        <BodyText size={14} numberOfLines={1} style={{ flex: 1 }}>
          {profile?.resumeFileName ?? '—'}
        </BodyText>
        <Numeral size={20}>{`${percent}%`}</Numeral>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>

      <Label>{stepLabel}</Label>

      {done ? (
        <>
          {profile && profile.skills.length > 0 ? (
            <View style={styles.tags}>
              {profile.skills.map((skill) => <Tag key={skill}>{skill}</Tag>)}
            </View>
          ) : null}
          <BodyText size={14} tone={color.stone}>{summary}</BodyText>
          <View style={{ flex: 1 }} />
          <Button fullWidth onPress={onDone}>{strings.onboarding.parsing.continue}</Button>
        </>
      ) : null}
    </>
  );
}

// ── Step III · Threshold ────────────────────────────────────────────────────

function StepThreshold() {
  const { preferences, updatePreferences, completeOnboarding } = useHerald();
  const [busy, setBusy] = useState(false);

  const threshold = preferences?.threshold ?? 85;
  const digestTime = `${preferences?.digestHour ?? 7}:00`;

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      await completeOnboarding();
      router.replace('/(tabs)/today');
    } finally {
      setBusy(false);
    }
  }, [completeOnboarding]);

  return (
    <>
      <Label>{strings.onboarding.threshold.label}</Label>

      <View style={styles.thresholdRow}>
        <Numeral size={40}>{String(threshold)}</Numeral>
        <BodyText size={14} tone={color.stone} style={{ flex: 1 }}>
          {strings.onboarding.threshold.explainer}
        </BodyText>
      </View>

      <Slider
        value={threshold}
        min={60}
        max={99}
        onChange={(next) => void updatePreferences({ threshold: next })}
      />

      <Hairline style={{ marginTop: space[1] }} />

      <View style={{ gap: space[2], paddingTop: space[1] }}>
        <Switch
          label={strings.onboarding.threshold.instant}
          value={preferences?.instant ?? true}
          onChange={(next) => void updatePreferences({ instant: next })}
        />
        <Switch
          label={strings.onboarding.threshold.digest(digestTime)}
          value={preferences?.digest ?? true}
          onChange={(next) => void updatePreferences({ digest: next })}
        />
        <Switch
          label={strings.onboarding.threshold.tailor}
          value={preferences?.tailorLetter ?? true}
          onChange={(next) => void updatePreferences({ tailorLetter: next })}
        />
      </View>

      <View style={{ flex: 1 }} />
      <Button fullWidth loading={busy} onPress={() => void finish()}>
        {strings.onboarding.threshold.cta}
      </Button>
    </>
  );
}

const styles = StyleSheet.create({
  dropzone: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.gold,
    paddingVertical: 44,
    paddingHorizontal: space[3],
    alignItems: 'center',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[2],
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingBottom: space[1],
  },
  progressTrack: { height: 1, backgroundColor: color.graphite2 },
  progressFill: { height: 1, backgroundColor: color.gold },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  thresholdRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
});
