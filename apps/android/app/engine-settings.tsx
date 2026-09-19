import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '@herald/core';
import { BodyText, Button, Hairline, Label, Loading } from '../src/components/primitives';
import { body, color, display, space } from '../src/theme';
import { DEFAULT_MODELS } from '../src/engine/llm';
import {
  DEFAULT_FEED_FLOOR, getApiKey, getFeedFloor, getModels, setApiKey, setFeedFloor, setModels,
} from '../src/engine/settings';
import { getReleasesIndexUrl, setReleasesIndexUrl } from '../src/engine/releases';

/**
 * The settings that only matter when this device is doing the work.
 *
 * The key is write-only on purpose: it is shown as present or absent and can be
 * replaced, but never displayed back. Reading it out of the keystore to put it
 * on screen would be the one place it could be shoulder-surfed, and nothing
 * here needs to see it.
 */
export default function EngineSettings() {
  const insets = useSafeAreaInsets();

  const [loaded, setLoaded] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [scoreModel, setScoreModel] = useState(DEFAULT_MODELS.scoreModel);
  const [writeModel, setWriteModel] = useState(DEFAULT_MODELS.writeModel);
  const [floor, setFloor] = useState(String(DEFAULT_FEED_FLOOR));
  const [feedUrl, setFeedUrl] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [key, models, feedFloor, releases] = await Promise.all([
        getApiKey(), getModels(), getFeedFloor(), getReleasesIndexUrl(),
      ]);
      setHasKey(Boolean(key));
      setScoreModel(models.scoreModel);
      setWriteModel(models.writeModel);
      setFloor(String(feedFloor));
      setFeedUrl(releases ?? '');
      setLoaded(true);
    })();
  }, []);

  if (!loaded) {
    return <View style={styles.screen}><Loading>Loading settings</Loading></View>;
  }

  const flash = (message: string): void => {
    setSaved(message);
    setTimeout(() => setSaved(null), 2400);
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + space[4] }}
      keyboardShouldPersistTaps="handled"
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
        <BodyText style={display(22, 500)}>KEY AND MODELS</BodyText>
      </View>

      <Hairline />
      <View style={styles.section}>
        <Label size={11}>{strings.setup.apiKey}</Label>
        <BodyText size={13} tone={hasKey ? color.stone : color.danger}>
          {hasKey
            ? 'A key is stored in this phone’s keystore. Enter a new one to replace it.'
            : 'No key is stored. Herald cannot score anything without one.'}
        </BodyText>
        <TextInput
          value={keyDraft}
          onChangeText={setKeyDraft}
          placeholder="sk-ant-..."
          placeholderTextColor={color.stone}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={[body(15, 400), styles.input]}
        />
        <View style={styles.row}>
          <Button
            variant="outline"
            disabled={!keyDraft.trim()}
            onPress={() => void (async () => {
              await setApiKey(keyDraft);
              setKeyDraft('');
              setHasKey(true);
              flash('Key saved');
            })()}
          >
            Save key
          </Button>
          {hasKey ? (
            <Button
              variant="ghost"
              onPress={() => void (async () => {
                await setApiKey('');
                setHasKey(false);
                flash('Key removed');
              })()}
            >
              Remove
            </Button>
          ) : null}
        </View>
      </View>

      <Hairline />
      <View style={styles.section}>
        <Label size={11}>Models</Label>
        <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
          Scoring runs once per posting that survives your filters, so a cheaper
          model costs less per scan. Writing covers cover letters and reading
          your resume.
        </BodyText>
        <Labelled label="Scoring" value={scoreModel} onChange={setScoreModel} />
        <Labelled label="Writing" value={writeModel} onChange={setWriteModel} />
        <Button
          variant="outline"
          onPress={() => void (async () => {
            await setModels({ scoreModel: scoreModel.trim(), writeModel: writeModel.trim() });
            flash('Models saved');
          })()}
        >
          Save models
        </Button>
      </View>

      <Hairline />
      <View style={styles.section}>
        <Label size={11}>Score floor</Label>
        <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
          Anything scoring below this never becomes a match, so lowering your
          threshold later cannot bring it back. Raising the floor spends less on
          storage and shows you less.
        </BodyText>
        <View style={styles.row}>
          <TextInput
            value={floor}
            onChangeText={setFloor}
            keyboardType="number-pad"
            placeholderTextColor={color.stone}
            style={[body(15, 400), styles.input, { flex: 0, width: 96 }]}
          />
          <Button
            variant="outline"
            onPress={() => void (async () => {
              const parsed = Number(floor);
              const clamped = Number.isFinite(parsed) ? Math.min(99, Math.max(0, parsed)) : DEFAULT_FEED_FLOOR;
              setFloor(String(clamped));
              await setFeedFloor(clamped);
              flash('Floor saved');
            })()}
          >
            Save
          </Button>
        </View>
      </View>

      <Hairline />
      <View style={styles.section}>
        <Label size={11}>Release feed</Label>
        <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
          Where Herald checks for new versions of itself. Leave it as it is
          unless you publish your own builds.
        </BodyText>
        <TextInput
          value={feedUrl}
          onChangeText={setFeedUrl}
          placeholder="https://…/releases/index.json"
          placeholderTextColor={color.stone}
          autoCapitalize="none"
          autoCorrect={false}
          style={[body(14, 400), styles.input]}
        />
        <Button
          variant="outline"
          onPress={() => void (async () => {
            await setReleasesIndexUrl(feedUrl);
            flash('Feed saved');
          })()}
        >
          Save feed
        </Button>
      </View>

      {saved ? (
        <View style={styles.section}>
          <BodyText size={13} tone={color.gold}>{saved}</BodyText>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Labelled({ label, value, onChange }: {
  label: string; value: string; onChange: (next: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Label size={11}>{label}</Label>
      <TextInput
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={color.stone}
        style={[body(15, 400), styles.input]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  back: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  header: { paddingHorizontal: space[3], paddingBottom: space[3] },
  section: { padding: space[3], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  input: {
    color: color.bone, borderWidth: 1, borderColor: color.line,
    paddingHorizontal: space[2], paddingVertical: 10,
  },
});
