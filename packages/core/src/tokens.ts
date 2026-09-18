/**
 * Crowned Pixel design tokens, transcribed from `design-handoff/design/tokens/*.css`.
 *
 * This module is the single source of truth for both clients: the Expo app reads
 * it directly, and `tokens.css` for the desktop app is generated from it by
 * `scripts/generate-css-tokens.mjs`. Change a value here, never in a component.
 */

export const color = {
  /** Primary background. */
  onyx: '#0C0A09',
  /** Raised surfaces. */
  graphite: '#161318',
  /** Cards, panels, toast. */
  graphite2: '#1E1A21',
  /** Primary accent. Target ~8% of any screen. */
  gold: '#C6A75E',
  /** Highlights and hovers. */
  goldBright: '#E3C57E',
  /** Emblem gradient shadow only — never a button or panel. */
  goldDark: '#9A7F42',
  /** Primary text. */
  bone: '#EDE8DC',
  /** Secondary text. */
  stone: '#8F8A80',
  /** Every hairline rule in the product. */
  line: 'rgba(198, 167, 94, 0.25)',
  success: '#7E8F6E',
  danger: '#B05A4A',
} as const;

export const font = {
  /** Headlines, wordmark, numerals, dates. Weights 500–700. */
  display: 'Cinzel',
  /** Body, UI, labels. Weights 300–500. */
  body: 'Jost',
} as const;

/** Font files bundled with both apps, keyed by the family name each app registers. */
export const fontAssets = {
  'Cinzel-Medium': { family: font.display, weight: '500' },
  'Cinzel-SemiBold': { family: font.display, weight: '600' },
  'Cinzel-Bold': { family: font.display, weight: '700' },
  'Jost-Light': { family: font.body, weight: '300' },
  'Jost-Regular': { family: font.body, weight: '400' },
  'Jost-Medium': { family: font.body, weight: '500' },
} as const;

export const tracking = {
  display: 0.02,
  /** Uppercase labels. */
  label: 0.18,
  /** Slightly tighter label used inside dense rows. */
  labelTight: 0.14,
} as const;

export const text = {
  hero: 64,
  h1: 40,
  h2: 28,
  h3: 20,
  bodyLg: 18,
  bodyMd: 16,
  label: 12,
  caption: 13,
} as const;

export const leading = {
  display: 1.15,
  body: 1.6,
} as const;

/** Spacing scale from the brand kit. Use these, not arbitrary numbers. */
export const space = {
  1: 8,
  2: 16,
  3: 24,
  4: 44,
  5: 88,
  6: 120,
} as const;

export const shape = {
  /** Luxury is sharp. Zero rounding everywhere. */
  radius: 0,
  hairline: 1,
} as const;

export const motion = {
  /** All transitions. Opacity and background only — no bounces, no slide-ins. */
  duration: 200,
  ease: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
  /** Toast dwell before auto-dismiss. */
  toastDuration: 2400,
} as const;

/** Letter-spacing in px for a given font size, since RN wants absolute units. */
export function trackingPx(fontSize: number, em: number): number {
  return fontSize * em;
}

export type ColorToken = keyof typeof color;
