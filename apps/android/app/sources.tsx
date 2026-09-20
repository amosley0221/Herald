import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Linking } from 'react-native';
import {
  SOURCE_PRESETS, createHttpClient, defineSource, findPreset, missingCredentials, strings,
  testSource, type SourceConfig, type SourcePreset, type SourceTestResult,
} from '@herald/core';
import {
  BodyText, Button, Hairline, Label, Loading, Switch, Tag,
} from '../src/components/primitives';
import { body, color, display, space } from '../src/theme';
import { getSources, setSources } from '../src/engine/settings';

/**
 * Which boards Herald watches.
 *
 * Engine-side this is a JSON file; here it is a screen, because a phone has no
 * file to edit. The adapters are the same either way, so a board added here
 * behaves exactly as one added there.
 *
 * Each adapter wants a different kind of name, and getting that wrong is the
 * likeliest mistake, so each one says what it expects and shows an example
 * rather than leaving the user to guess from the URL.
 */

interface AdapterInfo {
  adapter: SourceConfig['adapter'];
  title: string;
  /** Which key in `options` holds the list of things to read. */
  listKey: string;
  hint: string;
  example: string;
}

const ADAPTERS: AdapterInfo[] = [
  {
    adapter: 'greenhouse', title: 'Greenhouse', listKey: 'boards',
    hint: 'The board name in the careers URL, e.g. boards.greenhouse.io/**stripe**',
    example: 'stripe',
  },
  {
    adapter: 'lever', title: 'Lever', listKey: 'sites',
    hint: 'The site name in the careers URL, e.g. jobs.lever.co/**figma**',
    example: 'figma',
  },
  {
    adapter: 'ashby', title: 'Ashby', listKey: 'boards',
    hint: 'The board name in the careers URL, e.g. jobs.ashbyhq.com/**notion**',
    example: 'notion',
  },
];

export default function Sources() {
  const insets = useSafeAreaInsets();
  const [sources, setLocal] = useState<SourceConfig[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    void getSources().then(setLocal);
  }, []);

  if (!sources) {
    return <View style={styles.screen}><Loading>Loading sources</Loading></View>;
  }

  const persist = async (next: SourceConfig[]): Promise<void> => {
    setLocal(next);
    await setSources(next);
  };

  const entriesFor = (info: AdapterInfo): string[] => {
    const source = sources.find((entry) => entry.adapter === info.adapter);
    const value = source?.options[info.listKey];
    return Array.isArray(value) ? (value as string[]) : [];
  };

  const update = async (info: AdapterInfo, entries: string[]): Promise<void> => {
    const rest = sources.filter((entry) => entry.adapter !== info.adapter);
    const existing = sources.find((entry) => entry.adapter === info.adapter);
    const next = defineSource({
      ...(existing ?? { id: info.adapter, adapter: info.adapter }),
      // ATS originals outrank aggregators so a duplicate collapses onto the
      // real posting rather than the other way round.
      priority: 10,
      options: { ...(existing?.options ?? {}), [info.listKey]: entries },
    });
    await persist([...rest, next]);
  };

  const add = async (info: AdapterInfo): Promise<void> => {
    const raw = (drafts[info.adapter] ?? '').trim().toLowerCase();
    if (!raw) return;
    const entries = entriesFor(info);
    if (entries.includes(raw)) return;
    setDrafts((current) => ({ ...current, [info.adapter]: '' }));
    await update(info, [...entries, raw]);
  };

  const total = ADAPTERS.reduce((count, info) => count + entriesFor(info).length, 0)
    + sources.filter((entry) => entry.enabled && findPreset(entry.id)).length;

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
        <BodyText style={display(22, 500)}>JOB SOURCES</BodyText>
        <BodyText size={14} tone={color.stone} style={{ lineHeight: 22 }}>
          {total === 0
            ? 'Nothing is being watched yet. Turn on a job site below to search broadly, or add a company board to follow one employer.'
            : `Herald reads ${total} ${total === 1 ? 'source' : 'sources'} on every scan.`}
        </BodyText>
      </View>

      <Hairline />
      <View style={styles.section}>
        <Label size={11}>Job sites</Label>
        <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
          These search across employers rather than following one. The ones that
          search use the roles and location from Preferences.
        </BodyText>
      </View>

      {SOURCE_PRESETS.map((preset) => (
        <PresetRow
          key={preset.id}
          preset={preset}
          source={sources.find((entry) => entry.id === preset.id) ?? null}
          onChange={(next) => void persist([
            ...sources.filter((entry) => entry.id !== preset.id), next,
          ])}
        />
      ))}

      <Hairline />
      <View style={styles.section}>
        <Label size={11}>Company boards</Label>
        <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
          Follow one employer's own listings. These are the original postings,
          so when a job shows up on a job site too, this is the one Herald keeps.
        </BodyText>
      </View>

      {ADAPTERS.map((info) => (
        <View key={info.adapter}>
          <Hairline />
          <View style={styles.section}>
            <Label size={11}>{info.title}</Label>

            {entriesFor(info).length > 0 ? (
              <View style={styles.tags}>
                {entriesFor(info).map((entry) => (
                  <Tag
                    key={entry}
                    onRemove={() => void update(info, entriesFor(info).filter((item) => item !== entry))}
                  >
                    {entry}
                  </Tag>
                ))}
              </View>
            ) : null}

            <View style={styles.row}>
              <TextInput
                value={drafts[info.adapter] ?? ''}
                onChangeText={(next) => setDrafts((current) => ({ ...current, [info.adapter]: next }))}
                placeholder={info.example}
                placeholderTextColor={color.stone}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => void add(info)}
                style={[body(15, 400), styles.input]}
              />
              <Button
                variant="outline"
                onPress={() => void add(info)}
                disabled={!(drafts[info.adapter] ?? '').trim()}
              >
                Add
              </Button>
            </View>

            <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
              {info.hint}
            </BodyText>
          </View>
        </View>
      ))}

      <Hairline />
      <View style={styles.section}>
        <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
          Indeed and LinkedIn are missing on purpose: neither offers a way to
          search them that does not involve scraping, which their terms forbid
          and which would break silently. Adzuna covers much of the same ground
          through an interface meant to be used.
        </BodyText>
        <BodyText size={13} tone={color.stone} style={{ lineHeight: 21 }}>
          Workday and hand-written JSON sources run on the same engine but need
          more than a name, so they are configured on a hosted engine.
        </BodyText>
      </View>
    </ScrollView>
  );
}

/**
 * One job site, with whatever it needs before it can run.
 *
 * The test button is the point of this row. These sources are definitions
 * pointing at somebody else's API, and the failure that matters is not an error
 * -- it is a mapping that reads nothing and looks exactly like a quiet day. One
 * tap answers it, against the live service, on the device that will do the
 * scanning.
 */
function PresetRow({ preset, source, onChange }: {
  preset: SourcePreset;
  source: SourceConfig | null;
  onChange: (next: SourceConfig) => void;
}) {
  const current = source ?? preset.build();
  const [result, setResult] = useState<SourceTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const missing = missingCredentials(preset, current);

  const setOption = (option: string, value: string) => {
    onChange(defineSource({ ...current, options: { ...current.options, [option]: value } }));
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const http = createHttpClient({
        rateLimitPerMinute: current.rateLimitPerMinute,
        log: { error() {}, warn() {}, info() {}, debug() {} },
        signal: new AbortController().signal,
      });
      setResult(await testSource(current, {
        http,
        // The same terms a scan would use, so a pass here means a pass there.
        search: { queries: ['engineer'], location: '', remote: true },
      }));
    } catch (cause) {
      setResult({
        ok: false, samples: [], read: 0, missingFields: [],
        problems: [cause instanceof Error ? cause.message : String(cause)],
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <View>
      <Hairline />
      <View style={styles.section}>
        <Switch
          label={preset.name}
          value={current.enabled}
          onChange={(next) => onChange(defineSource({ ...current, enabled: next }))}
          hint={preset.covers}
        />

        {missing.length > 0 && current.enabled ? (
          <BodyText size={12} tone={color.danger} style={{ lineHeight: 19 }}>
            This will not run until you fill in the {missing.length === 1 ? 'field' : 'fields'} below.
          </BodyText>
        ) : null}

        {(preset.credentials ?? []).map((credential) => (
          <View key={credential.option} style={{ gap: 6 }}>
            <Label size={11}>{credential.label}</Label>
            <TextInput
              defaultValue={String(current.options[credential.option] ?? '')}
              onEndEditing={(event) => setOption(credential.option, event.nativeEvent.text.trim())}
              placeholder={credential.label}
              placeholderTextColor={color.stone}
              autoCapitalize="none"
              autoCorrect={false}
              style={[body(15, 400), styles.input]}
            />
            <Pressable onPress={() => void Linking.openURL(credential.signupUrl)} hitSlop={8}>
              <BodyText size={12} tone={color.stone} style={{ lineHeight: 19 }}>
                {credential.help} <BodyText size={12} tone={color.gold}>Get one</BodyText>
              </BodyText>
            </Pressable>
          </View>
        ))}

        <View style={styles.row}>
          <Button variant="outline" loading={testing} onPress={() => void runTest()}>
            {testing ? 'Testing…' : 'Test'}
          </Button>
          {result ? (
            <BodyText size={12} tone={result.ok ? color.success : color.danger} style={{ flex: 1 }}>
              {result.ok
                ? `Read ${result.read} ${result.read === 1 ? 'posting' : 'postings'}.`
                : 'Nothing came back.'}
            </BodyText>
          ) : null}
        </View>

        {result?.samples[0] ? (
          <View style={styles.sample}>
            <Label size={11}>First posting, as Herald read it</Label>
            <BodyText size={14}>{result.samples[0].title}</BodyText>
            <BodyText size={13} tone={color.stone}>
              {result.samples[0].company || '(no company)'}
              {result.samples[0].location ? ` · ${result.samples[0].location}` : ''}
            </BodyText>
          </View>
        ) : null}

        {result && result.missingFields.length > 0 ? (
          <BodyText size={12} tone={color.danger} style={{ lineHeight: 19 }}>
            Every posting came back with no {result.missingFields.join(', ')}. That
            is a mapping problem rather than a quiet day — worth reporting.
          </BodyText>
        ) : null}

        {result?.problems.map((problem) => (
          <BodyText key={problem} size={12} tone={color.stone} style={{ lineHeight: 19 }}>
            {problem}
          </BodyText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.onyx },
  back: { paddingHorizontal: space[3], paddingTop: space[3], paddingBottom: space[2] },
  header: { paddingHorizontal: space[3], paddingBottom: space[3], gap: 6 },
  section: { padding: space[3], gap: space[2] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  input: {
    flex: 1, color: color.bone, borderWidth: 1, borderColor: color.line,
    paddingHorizontal: space[2], paddingVertical: 10,
  },
  sample: { borderWidth: 1, borderColor: color.line, padding: space[2], gap: 4 },
});
