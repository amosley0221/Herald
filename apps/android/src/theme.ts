import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { color, leading, motion, shape, space, text, tracking } from '@herald/core';

/**
 * The Crowned Pixel tokens, expressed as React Native styles.
 *
 * Every value traces back to `@herald/core/tokens`; nothing is invented here.
 * React Native wants letter-spacing in absolute points rather than `em`, so the
 * helpers below do that conversion at each size.
 */

export { color, space, shape, motion };

/** PostScript names of the bundled faces. Android matches on these exactly. */
const CINZEL = {
  500: 'Cinzel-Medium',
  600: 'Cinzel-SemiBold',
  700: 'Cinzel-Bold',
} as const;

const JOST = {
  300: 'Jost-Light',
  400: 'Jost-Regular',
  500: 'Jost-Medium',
} as const;

export type DisplayWeight = keyof typeof CINZEL;
export type BodyWeight = keyof typeof JOST;

/** Cinzel: headings, the wordmark, scores, numerals and dates. */
export function display(size: number, weight: DisplayWeight = 500, extra?: TextStyle): TextStyle {
  return {
    fontFamily: CINZEL[weight],
    fontSize: size,
    letterSpacing: size * tracking.display,
    lineHeight: Math.round(size * leading.display),
    color: color.bone,
    ...extra,
  };
}

/** Jost: body copy and UI. */
export function body(size: number, weight: BodyWeight = 300, extra?: TextStyle): TextStyle {
  return {
    fontFamily: JOST[weight],
    fontSize: size,
    lineHeight: Math.round(size * leading.body),
    color: color.bone,
    ...extra,
  };
}

/** The uppercase label style: Jost 12, .18em tracking. */
export function label(size: number = text.label, extra?: TextStyle): TextStyle {
  return {
    fontFamily: JOST[500],
    fontSize: size,
    letterSpacing: size * tracking.label,
    textTransform: 'uppercase',
    color: color.stone,
    ...extra,
  };
}

/** The tighter label used inside dense rows (meta lines, field keys). */
export function labelTight(size: number, extra?: TextStyle): TextStyle {
  return {
    fontFamily: JOST[500],
    fontSize: size,
    letterSpacing: size * tracking.labelTight,
    textTransform: 'uppercase',
    color: color.stone,
    ...extra,
  };
}

/** A 1px rule in the gold line colour — the only divider in the product. */
export const hairline = {
  top: { borderTopWidth: 1, borderTopColor: color.line } as ViewStyle,
  bottom: { borderBottomWidth: 1, borderBottomColor: color.line } as ViewStyle,
  left: { borderLeftWidth: 1, borderLeftColor: color.line } as ViewStyle,
  right: { borderRightWidth: 1, borderRightColor: color.line } as ViewStyle,
  all: { borderWidth: 1, borderColor: color.line } as ViewStyle,
};

export const screen = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.onyx,
  },
  padded: {
    paddingHorizontal: space[3],
  },
  /** Standard screen header block: title plus its meta line. */
  header: {
    paddingTop: space[4],
    paddingBottom: space[3],
    paddingHorizontal: space[3],
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
});

export const typography = { display, body, label, labelTight };
