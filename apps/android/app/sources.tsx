import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defineSource, strings, type SourceConfig } from '@herald/core';
import { BodyText, Button, Hairline, Label, Loading, Tag } from '../src/components/primitives';
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

  const total = ADAPTERS.reduce((count, info) => count + entriesFor(info).length, 0);

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
            ? 'Nothing is being watched yet. Add a company board below and Herald will read it on the next scan.'
            : `Herald reads ${total} ${total === 1 ? 'board' : 'boards'} on every scan.`}
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
          Workday and custom JSON boards are supported by the same engine but
          need more than a name, so they are configured on a hosted engine
          rather than here.
        </BodyText>
      </View>
    </ScrollView>
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
});
