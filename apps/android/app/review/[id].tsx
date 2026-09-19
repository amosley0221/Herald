import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PreparedApplication } from '@herald/core';
import { strings } from '@herald/core';
import {
  BodyText, Button, EmptyState, Label, Loading,
} from '../../src/components/primitives';
import { body, color, display, space } from '../../src/theme';
import { useHerald } from '../../src/state/herald';

/**
 * Review before submitting.
 *
 * This is the guardrail the whole product is built around: approving only
 * prepares an application, and nothing reaches a company until the user reads
 * this screen and presses Submit. Every field is editable here, and what is
 * shown is exactly what gets sent.
 */
export default function Review() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matchById, approve, submit, mode } = useHerald();
  const insets = useSafeAreaInsets();

  const [prepared, setPrepared] = useState<PreparedApplication | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [letter, setLetter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const match = id ? matchById(id) : undefined;

  // `approve` is idempotent on the engine: a match that is already approved
  // returns its stored preparation rather than paying for a second one.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await approve(id);
        if (cancelled) return;
        setPrepared(result);
        setLetter(result.coverLetter ?? '');
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : strings.errors.generic);
      }
    })();
    return () => { cancelled = true; };
    // Deliberately keyed on the id alone: re-running this on every `approve`
    // identity change would re-prepare the application on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id || !match) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <BackLink />
        <EmptyState>That match is no longer available.</EmptyState>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <BackLink />
        <EmptyState>{error}</EmptyState>
      </View>
    );
  }

  if (!prepared) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <BackLink />
        <Loading>{strings.detail.preparing}</Loading>
      </View>
    );
  }

  // Running on this device, Herald fills the real form in a web view and the
  // user submits it there. Paired with an engine, the engine drives a browser
  // and submits on their say-so. Either way nothing is sent from this screen.
  const onContinue = (): void => {
    router.push(`/apply/${id}`);
  };

  const onSubmit = async () => {
    setSubmitting(true);
    try {
      await submit(id, edits, letter || undefined);
      router.replace('/(tabs)/tracker');
    } catch {
      // `submit` already raised the danger toast and rolled the status back.
      setSubmitting(false);
    }
  };

  const missingRequired = prepared.fields.some(
    (field) => field.required && !(edits[field.key] ?? field.value).trim(),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + space[3] }}
      keyboardShouldPersistTaps="handled"
    >
      <BackLink />

      <View style={styles.header}>
        <BodyText style={display(22, 500)}>{strings.review.title.toUpperCase()}</BodyText>
        <BodyText size={14} tone={color.stone}>
          {strings.review.subtitle(match.posting.title, match.posting.company, match.posting.source)}
        </BodyText>
      </View>

      {prepared.manualOnly ? (
        <Notice tone="danger">
          {prepared.manualReason ?? strings.review.manualOnly}
        </Notice>
      ) : prepared.degraded ? (
        <Notice tone="warning">{strings.review.degraded}</Notice>
      ) : null}

      <View style={styles.fields}>
        {prepared.fields.map((field) => (
          <View key={field.key} style={styles.fieldRow}>
            <Label size={11} style={{ flex: 1, paddingTop: 4 }}>
              {field.label}{field.required ? ' *' : ''}
            </Label>
            <TextInput
              defaultValue={field.value}
              onChangeText={(next) => setEdits((current) => ({ ...current, [field.key]: next }))}
              placeholder={field.kind === 'file' ? 'No file' : '—'}
              placeholderTextColor={color.stone}
              editable={field.kind !== 'file'}
              multiline={field.kind === 'textarea'}
              keyboardType={
                field.kind === 'email' ? 'email-address'
                  : field.kind === 'tel' ? 'phone-pad'
                    : field.kind === 'url' ? 'url' : 'default'
              }
              autoCapitalize={field.kind === 'email' || field.kind === 'url' ? 'none' : 'sentences'}
              style={[body(13, 400), styles.fieldInput]}
            />
          </View>
        ))}
      </View>

      {prepared.coverLetter != null ? (
        <View style={styles.letterBlock}>
          <Label size={11}>{strings.review.coverLetter}</Label>
          <View style={styles.letterRule}>
            <TextInput
              value={letter}
              onChangeText={setLetter}
              multiline
              style={[body(14, 300), styles.letterInput]}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.actions}>
        {prepared.manualOnly ? (
          <Button fullWidth onPress={() => void Linking.openURL(match.posting.applyUrl)}>
            {strings.review.openPosting}
          </Button>
        ) : (
          <Button
            fullWidth
            loading={submitting}
            disabled={missingRequired}
            onPress={() => (mode === 'local' ? onContinue() : void onSubmit())}
          >
            {mode === 'local'
              ? 'Open the form'
              : submitting ? strings.review.submitting : strings.review.submit}
          </Button>
        )}
        <Button variant="ghost" fullWidth disabled={submitting} onPress={() => router.back()}>
          {strings.review.back}
        </Button>
      </View>
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

function Notice({ children, tone }: { children: React.ReactNode; tone: 'danger' | 'warning' }) {
  return (
    <View style={[styles.notice, { borderColor: tone === 'danger' ? color.danger : color.gold }]}>
      <BodyText size={13} tone={tone === 'danger' ? color.danger : color.gold}>{children}</BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  back: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  header: { paddingHorizontal: space[3], paddingBottom: space[3], gap: 6 },
  notice: {
    marginHorizontal: space[3],
    marginBottom: space[2],
    padding: space[2],
    borderWidth: 1,
  },
  fields: { paddingHorizontal: space[3] },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  fieldInput: {
    flex: 2,
    color: color.bone,
    textAlign: 'right',
    padding: 0,
    minHeight: 20,
  },
  letterBlock: { paddingHorizontal: space[3], paddingTop: space[3], gap: space[1] },
  letterRule: { borderLeftWidth: 1, borderLeftColor: color.line, paddingLeft: space[2] },
  letterInput: { color: color.bone, padding: 0, textAlignVertical: 'top' },
  actions: { paddingHorizontal: space[3], paddingTop: space[4], gap: space[1] },
});
