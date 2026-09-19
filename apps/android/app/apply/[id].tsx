import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import {
  BUILTIN_FIELD_RULES, DISCOVER_SCRIPT, fillScript, mapFields, parseWebFormMessage, strings,
  type PreparedApplication,
} from '@herald/core';
import { BodyText, Button, Label, Loading } from '../../src/components/primitives';
import { color, display, space } from '../../src/theme';
import { useHerald } from '../../src/state/herald';

/**
 * Applying.
 *
 * Herald opens the real application form, fills in what it knows, and stops.
 * The user reads the page they are actually submitting and presses the site's
 * own Submit button. That is deliberate: filling and sending are different
 * acts, and the second one stays a person's.
 *
 * Nothing here can detect a submission reliably — every ATS confirms
 * differently, and guessing would either lose applications or invent them — so
 * the user says whether it went through, and that is what the tracker records.
 */
type Phase = 'loading' | 'scanning' | 'ready' | 'filled' | 'blocked';

export default function Apply() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { matchById, approve, submit, showToast, profile } = useHerald();
  const insets = useSafeAreaInsets();
  const webview = useRef<WebView>(null);

  const [prepared, setPrepared] = useState<PreparedApplication | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [blockedReason, setBlockedReason] = useState<string | null>(null);
  const [fillable, setFillable] = useState<Array<{ selector: string; value: string }>>([]);
  const [recording, setRecording] = useState(false);

  const match = id ? matchById(id) : undefined;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await approve(id);
        if (!cancelled) setPrepared(result);
      } catch (cause) {
        if (!cancelled) {
          showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
          router.back();
        }
      }
    })();
    return () => { cancelled = true; };
    // Keyed on the id alone; re-preparing on every identity change would pay
    // for a new cover letter on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!id || !match) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Back />
        <BodyText size={15} tone={color.stone} style={{ padding: space[3] }}>
          That match is no longer available.
        </BodyText>
      </View>
    );
  }

  if (!prepared) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <Back />
        <Loading>{strings.detail.preparing}</Loading>
      </View>
    );
  }

  const onMessage = (event: WebViewMessageEvent): void => {
    const message = parseWebFormMessage(event.nativeEvent.data);
    if (!message) return;

    if (message.type === 'herald:scan') {
      if (message.blocked) {
        setBlockedReason(message.blocked);
        setPhase('blocked');
        return;
      }

      // The form's own controls, matched against the rules — which is what
      // keeps the demographic and salary questions blank here too.
      const mapped = mapFields(message.fields, BUILTIN_FIELD_RULES, {
        profile: profile ?? emptyish(),
        coverLetter: prepared.coverLetter,
        resumeFileName: profile?.resumeFileName ?? null,
      });

      // Prefer what the Review screen showed and the user may have corrected,
      // falling back to whatever the rules derived from the profile. Matching on
      // the rule key is what ties the two together.
      const values = mapped
        .filter((field) => !field.skipped && field.selector)
        .map((field) => ({
          selector: field.selector as string,
          value: prepared.fields.find((entry) => entry.key === field.key)?.value || field.value,
        }))
        .filter((entry) => entry.value.length > 0);

      setFillable(values);
      setPhase('ready');
      return;
    }

    if (message.type === 'herald:filled') {
      setPhase('filled');
      const count = message.filled.length;
      showToast(
        count === 0
          ? 'Nothing matched — fill this one in yourself.'
          : `Filled ${count} ${count === 1 ? 'field' : 'fields'}. Check them, then submit on the page.`,
      );
    }
  };

  const record = async (): Promise<void> => {
    setRecording(true);
    try {
      await submit(id);
      router.replace('/(tabs)/tracker');
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : strings.errors.generic, 'danger');
      setRecording(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Back />
        <BodyText size={13} tone={color.stone} numberOfLines={1} style={{ flex: 1 }}>
          {match.posting.company} · {match.posting.title}
        </BodyText>
      </View>

      <WebView
        ref={webview}
        source={{ uri: match.posting.applyUrl }}
        onMessage={onMessage}
        onLoadEnd={() => {
          if (phase === 'loading') {
            setPhase('scanning');
            webview.current?.injectJavaScript(DISCOVER_SCRIPT);
          }
        }}
        style={styles.web}
        // The form is the user's to read; Herald only ever writes into it.
        javaScriptEnabled
        domStorageEnabled
      />

      <View style={[styles.bar, { paddingBottom: insets.bottom + space[2] }]}>
        {phase === 'blocked' ? (
          <>
            <BodyText size={13} tone={color.danger} style={{ lineHeight: 20 }}>
              {blockedReason}
            </BodyText>
            <BodyText size={12} tone={color.stone}>
              Finish this one yourself — Herald will not work around it.
            </BodyText>
          </>
        ) : phase === 'ready' ? (
          <>
            <Button
              fullWidth
              disabled={fillable.length === 0}
              onPress={() => webview.current?.injectJavaScript(fillScript(fillable))}
            >
              {fillable.length === 0
                ? 'Nothing here Herald can fill'
                : `Fill ${fillable.length} ${fillable.length === 1 ? 'field' : 'fields'}`}
            </Button>
            <BodyText size={12} tone={color.stone}>
              Herald never attaches your resume file or presses Submit.
            </BodyText>
          </>
        ) : phase === 'filled' ? (
          <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
            Check what was filled, attach your resume, and submit on the page
            itself. Then tell Herald below.
          </BodyText>
        ) : (
          <Label>Reading the form…</Label>
        )}

        <View style={styles.actions}>
          <Button variant="outline" loading={recording} onPress={() => void record()}>
            I submitted this
          </Button>
          <Button variant="ghost" onPress={() => void Linking.openURL(match.posting.applyUrl)}>
            Open in browser
          </Button>
        </View>
      </View>
    </View>
  );
}

function Back() {
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/matches'))}
      accessibilityRole="button"
      hitSlop={12}
      style={{ paddingHorizontal: space[3], paddingVertical: space[2] }}
    >
      <Label>{strings.detail.back}</Label>
    </Pressable>
  );
}

/** A profile shaped object for the rare case the profile has not loaded yet. */
function emptyish() {
  return {
    fullName: null, email: null, phone: null, location: null, portfolio: null,
    linkedin: null, summary: null, skills: [], titles: [], years: null,
    workAuthorization: null, availability: null, resumeFileName: null,
    resumeUpdatedAt: null,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingRight: space[3] },
  web: { flex: 1, backgroundColor: color.bone },
  bar: {
    paddingHorizontal: space[3], paddingTop: space[2], gap: space[2],
    borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.onyx,
  },
  actions: { flexDirection: 'row', gap: space[2] },
});
