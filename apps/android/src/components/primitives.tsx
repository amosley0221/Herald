import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch as RNSwitch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import type { BadgeTone } from '@herald/core';
import { motion } from '@herald/core';
import { body, color, display, hairline, label, labelTight, space } from '../theme';

/**
 * The Crowned Pixel component set.
 *
 * Every control in the app is built from these, so the rules the design is
 * strict about — zero rounding, 1px gold hairlines, one solid button per
 * screen, 200ms opacity-and-background transitions only — are enforced in one
 * place rather than re-decided per screen.
 */

// ── Emblem ──────────────────────────────────────────────────────────────────

/** The pixel crown. The only mark in the product. */
export function Emblem({ size = 40, tint = color.gold }: { size?: number; tint?: string }) {
  // Source geometry: a 7×3 grid of 20px squares on a 24px pitch, top row
  // reduced to four merlons. Matches design/assets/emblem-flat-gold.svg.
  const cells: Array<[number, number]> = [
    [12, 12], [60, 12], [108, 12], [156, 12],
    ...[36, 60].flatMap((y) => [12, 36, 60, 84, 108, 132, 156].map((x) => [x, y] as [number, number])),
  ];
  return (
    <Svg width={size} height={(size * 60) / 188} viewBox="0 12 188 68">
      {cells.map(([x, y]) => (
        <Rect key={`${x}-${y}`} x={x} y={y} width={20} height={20} fill={tint} />
      ))}
    </Svg>
  );
}

// ── Text ────────────────────────────────────────────────────────────────────

export function Label({ children, tone = 'stone', size = 12, style }: {
  children: ReactNode; tone?: 'stone' | 'gold' | 'bone'; size?: number; style?: StyleProp<TextStyle>;
}) {
  const tint = tone === 'gold' ? color.gold : tone === 'bone' ? color.bone : color.stone;
  return <Text style={[label(size, { color: tint }), style]}>{children}</Text>;
}

/** A Cinzel numeral — scores, stat values, dates. */
export function Numeral({ children, size = 28, tone = color.gold, style }: {
  children: ReactNode; size?: number; tone?: string; style?: StyleProp<TextStyle>;
}) {
  return <Text style={[display(size, 500, { color: tone }), style]}>{children}</Text>;
}

export function BodyText({ children, size = 14, weight = 300, tone = color.bone, style, numberOfLines }: {
  children: ReactNode; size?: number; weight?: 300 | 400 | 500; tone?: string;
  style?: StyleProp<TextStyle>; numberOfLines?: number;
}) {
  return (
    <Text numberOfLines={numberOfLines} style={[body(size, weight, { color: tone }), style]}>
      {children}
    </Text>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────────

export type ButtonVariant = 'solid' | 'outline' | 'ghost';

/**
 * Solid = gold on onyx, and there is at most one per screen. Outline and ghost
 * carry everything else.
 */
export function Button({
  children, onPress, variant = 'solid', disabled = false, loading = false, fullWidth = false, style,
}: {
  children: ReactNode;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'solid' && styles.buttonSolid,
        variant === 'outline' && styles.buttonOutline,
        variant === 'ghost' && styles.buttonGhost,
        // Press state is a background or opacity change only — no transforms.
        pressed && variant === 'solid' && { backgroundColor: color.goldBright },
        pressed && variant === 'outline' && { backgroundColor: color.gold },
        pressed && variant === 'ghost' && { opacity: 0.7 },
        inactive && styles.buttonDisabled,
        fullWidth && { alignSelf: 'stretch' },
        style,
      ]}
    >
      {({ pressed }) => (
        <View style={styles.buttonInner}>
          {loading ? (
            <ActivityIndicator size="small" color={variant === 'solid' ? color.onyx : color.gold} />
          ) : null}
          <Text
            style={label(12, {
              color: variant === 'solid'
                ? color.onyx
                : variant === 'outline'
                  ? (pressed ? color.onyx : color.gold)
                  : (pressed ? color.goldBright : color.bone),
            })}
          >
            {children}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ── Tag & Badge ─────────────────────────────────────────────────────────────

/** A removable chip — skills on onboarding, roles in preferences. */
export function Tag({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <View style={styles.tag}>
      <Text style={body(13, 400, { color: color.bone, lineHeight: 16 })}>{children}</Text>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${String(children)}`}
          // A 13px glyph is below the 44px touch target, so pad the hit area.
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
        >
          <Text style={body(13, 400, { color: color.stone, lineHeight: 16 })}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const BADGE_TONES: Record<BadgeTone, { background: string; border: string; text: string }> = {
  solid: { background: color.gold, border: color.gold, text: color.onyx },
  gold: { background: 'transparent', border: color.gold, text: color.gold },
  success: { background: 'transparent', border: color.success, text: color.success },
  danger: { background: 'transparent', border: color.danger, text: color.danger },
  muted: { background: 'transparent', border: color.line, text: color.stone },
};

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: BadgeTone }) {
  const palette = BADGE_TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
      <Text style={label(11, { color: palette.text })}>{children}</Text>
    </View>
  );
}

// ── Switch & Slider ─────────────────────────────────────────────────────────

export function Switch({ label: text, value, onChange, hint }: {
  label: string; value: boolean; onChange: (next: boolean) => void; hint?: string;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.fill}>
        <Text style={body(15, 400)}>{text}</Text>
        {hint ? <Text style={body(13, 300, { color: color.stone })}>{hint}</Text> : null}
      </View>
      <RNSwitch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={text}
        trackColor={{ false: color.graphite2, true: color.gold }}
        thumbColor={value ? color.onyx : color.stone}
        ios_backgroundColor={color.graphite2}
      />
    </View>
  );
}

/**
 * A hairline slider drawn from primitives.
 *
 * React Native has no built-in slider and the community one would be the only
 * dependency in the app with rounded corners and a drop shadow, so this draws
 * the track and thumb as the design specifies: a 1px rule with a square thumb.
 */
export function Slider({ value, min, max, onChange }: {
  value: number; min: number; max: number; onChange: (next: number) => void;
}) {
  const width = useRef(0);

  const positionToValue = (x: number) => {
    if (width.current <= 0) return value;
    const ratio = Math.min(1, Math.max(0, x / width.current));
    return Math.round(min + ratio * (max - min));
  };

  const ratio = max > min ? (value - min) / (max - min) : 0;

  return (
    <View
      style={styles.sliderTouchArea}
      onLayout={(event) => { width.current = event.nativeEvent.layout.width; }}
      accessibilityRole="adjustable"
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') onChange(Math.min(max, value + 1));
        if (event.nativeEvent.actionName === 'decrement') onChange(Math.max(min, value - 1));
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => onChange(positionToValue(event.nativeEvent.locationX))}
      onResponderMove={(event) => onChange(positionToValue(event.nativeEvent.locationX))}
    >
      <View style={styles.sliderTrack}>
        <View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} />
      </View>
      <View style={[styles.sliderThumb, { left: `${ratio * 100}%` }]} />
    </View>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.hairline, style]} />;
}

/** A full-width label bar that separates feed sections. */
export function SectionLabel({ children, tone = 'stone' }: { children: ReactNode; tone?: 'gold' | 'stone' }) {
  return (
    <View style={styles.sectionLabel}>
      <Label tone={tone}>{children}</Label>
    </View>
  );
}

/** A 2×2 (or 4-across) grid of stat cells, divided by hairlines. */
export function StatGrid({ stats, columns = 2 }: {
  stats: Array<{ label: string; value: string }>; columns?: number;
}) {
  return (
    <View style={styles.statGrid}>
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          style={[
            styles.statCell,
            { width: `${100 / columns}%` },
            // Hairlines run between cells, never around the outside.
            index % columns !== columns - 1 && hairline.right,
            index < stats.length - columns && hairline.bottom,
          ]}
        >
          <Numeral size={28} tone={color.bone}>{stat.value}</Numeral>
          <Label>{stat.label}</Label>
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={body(14, 300, { color: color.stone, textAlign: 'center' })}>{children}</Text>
    </View>
  );
}

export function Loading({ children }: { children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <ActivityIndicator color={color.gold} />
      {children ? (
        <Text style={[body(13, 300, { color: color.stone }), { marginTop: space[2] }]}>{children}</Text>
      ) : null}
    </View>
  );
}

/** The bottom-anchored toast: graphite-2, hairline border, leading interpunct. */
export function Toast({ message, tone = 'default', offset = 0 }: {
  message: string | null; tone?: 'default' | 'danger'; offset?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: message ? 1 : 0,
      duration: motion.duration,
      useNativeDriver: true,
    }).start();
  }, [message, opacity]);

  if (!message) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.toast, { opacity, bottom: offset + space[2] }]}
    >
      <Text style={body(13, 300, { color: tone === 'danger' ? color.danger : color.gold })}>{'· '}</Text>
      <Text style={[body(13, 300), styles.fill]}>{message}</Text>
    </Animated.View>
  );
}

/** A screen that scrolls, with the app's standard padding already applied. */
export function Screen({ children, contentStyle }: {
  children: ReactNode; contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export { labelTight };

const styles = StyleSheet.create({
  fill: { flex: 1 },

  screen: { flex: 1, backgroundColor: color.onyx },
  screenContent: { paddingBottom: space[4] },

  button: {
    // Zero rounding, everywhere.
    borderRadius: 0,
    paddingVertical: 12,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  buttonSolid: { backgroundColor: color.gold },
  buttonOutline: { borderWidth: 1, borderColor: color.gold, backgroundColor: 'transparent' },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonDisabled: { opacity: 0.4 },

  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  badge: {
    borderWidth: 1,
    paddingVertical: 3,
    paddingHorizontal: 8,
    alignSelf: 'flex-start',
  },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    minHeight: 44,
  },

  sliderTouchArea: { height: 44, justifyContent: 'center' },
  sliderTrack: { height: 1, backgroundColor: color.graphite2 },
  sliderFill: { height: 1, backgroundColor: color.gold },
  sliderThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    marginLeft: -6,
    backgroundColor: color.gold,
  },

  hairline: { height: 1, backgroundColor: color.line },

  sectionLabel: {
    paddingHorizontal: space[3],
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.line,
    backgroundColor: color.onyx,
  },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderColor: color.line,
  },
  statCell: {
    paddingVertical: space[3],
    paddingHorizontal: space[2],
    gap: 6,
  },

  empty: {
    paddingVertical: space[5],
    paddingHorizontal: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },

  toast: {
    position: 'absolute',
    left: space[2],
    right: space[2],
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.graphite2,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 12,
    paddingHorizontal: space[2],
  },
});
