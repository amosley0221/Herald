import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '@herald/core';
import { color, label, space } from '../../src/theme';
import { Toast } from '../../src/components/primitives';
import { useHerald } from '../../src/state/herald';

const TAB_HEIGHT = 56;

const TABS = [
  { name: 'today', title: strings.nav.today },
  { name: 'matches', title: strings.nav.matches },
  { name: 'tracker', title: strings.nav.tracker },
  { name: 'preferences', title: strings.nav.preferences },
] as const;

/**
 * The bottom tab bar: gold text plus a 1px gold top rule on the active tab,
 * stone on the rest. No icons — the design uses none, and adding any would
 * introduce the one second visual language in the product.
 *
 * The bar is drawn by hand rather than configured, because the active rule has
 * to sit flush on the bar's own top border, which the default renderer cannot
 * express.
 */
export default function TabsLayout() {
  const { toast } = useHerald();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => <HeraldTabBar {...(props as unknown as TabBarProps)} />}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: color.onyx },
          animation: 'none',
        }}
      >
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
        ))}
      </Tabs>

      <Toast message={toast?.message ?? null} tone={toast?.tone} offset={TAB_HEIGHT + insets.bottom} />
    </View>
  );
}

/**
 * Typed structurally rather than against `BottomTabBarProps`, because
 * expo-router bundles its own copy of the navigation types and importing the
 * package directly resolves to a second, incompatible one.
 */
interface TabBarProps {
  state: {
    index: number;
    routes: Array<{ key: string; name: string }>;
  };
  navigation: {
    emit(event: { type: 'tabPress'; target: string; canPreventDefault: true }): { defaultPrevented: boolean };
    navigate(name: string): void;
  };
}

function HeraldTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { height: TAB_HEIGHT + insets.bottom, paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const tab = TABS.find((candidate) => candidate.name === route.name);
        if (!tab) return null;
        const focused = state.index === index;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.title}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
            style={({ pressed }) => [
              styles.item,
              // The active rule overlays the bar's border, so it reads as one
              // continuous hairline broken only under the selected tab.
              focused && styles.itemActive,
              pressed && { backgroundColor: color.graphite },
            ]}
          >
            <Text style={label(12, { color: focused ? color.gold : color.stone })}>
              {tab.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.onyx },
  bar: {
    flexDirection: 'row',
    backgroundColor: color.onyx,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
  itemActive: {
    borderTopWidth: 1,
    borderTopColor: color.gold,
    marginTop: -1,
  },
});
