/** Formatting helpers. Every display string in the apps routes through here. */

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

/** 2026 -> "MMXXVI". Returns the plain number for values outside 1–3999. */
export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  let rest = n;
  let out = '';
  for (const [value, numeral] of ROMAN) {
    while (rest >= value) {
      out += numeral;
      rest -= value;
    }
  }
  return out;
}

/**
 * Today's date in the Herald dateline style: `18 · IX · MMXXVI`.
 * Day stays arabic; month and year are roman, per the Today screen.
 */
export function heraldDate(date: Date, timeZone?: string): string {
  const { day, month, year } = zonedParts(date, timeZone);
  return `${day} · ${toRoman(month)} · ${toRoman(year)}`;
}

/** `Friday · September 18` — the notification lock-screen dateline. */
export function longDate(date: Date, timeZone?: string, locale = 'en-US'): string {
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(date);
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', timeZone }).format(date);
  const { day } = zonedParts(date, timeZone);
  return `${weekday} · ${monthName} ${day}`;
}

/** `Sep 16` — Tracker rows. */
export function shortDate(date: Date, timeZone?: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(date);
}

/** `7:00` — digest hour and clock displays. 24h, zero-padded minutes. */
export function clockTime(hour: number, minute = 0): string {
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

/** `2h ago`, `3d ago`, `now`. Used for the "Posted" meta line. */
export function relativeTime(from: Date, now: Date = new Date()): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** `2,418` — stat cells and the crawl footer. */
export function thousands(n: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** `$128k – $146k` from a min/max pair; falls back to whatever the source published. */
export function payRange(
  min: number | null,
  max: number | null,
  currency: string | null,
  raw: string | null,
): string | null {
  if (min == null && max == null) return raw;
  const symbol = currencySymbol(currency);
  const part = (v: number) => (v >= 1000 ? `${symbol}${Math.round(v / 1000)}k` : `${symbol}${thousands(v)}`);
  if (min != null && max != null) return `${part(min)} – ${part(max)}`;
  const only = (min ?? max) as number;
  return `${min != null ? 'From ' : 'Up to '}${part(only)}`;
}

function currencySymbol(currency: string | null): string {
  switch ((currency ?? 'USD').toUpperCase()) {
    case 'USD': case 'CAD': case 'AUD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    default: return '';
  }
}

/** `Company · Location` and friends — drops empty parts so no stray interpuncts. */
export function joinMeta(...parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim().length > 0).join(' · ');
}

/** Uppercase label text. Tracking is applied by the component, not here. */
export function label(value: string): string {
  return value.toUpperCase();
}

function zonedParts(date: Date, timeZone?: string): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { day: pick('day'), month: pick('month'), year: pick('year') };
}
