/**
 * Base64 and model-reply helpers that work without Node.
 *
 * React Native has no `Buffer`, and `atob` handles only Latin-1, so a resume
 * with an accent in it decodes to mojibake. These do the whole job in plain
 * TypeScript so the phone and the engine read a file the same way.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 to raw bytes. Whitespace and padding are ignored. */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];

  for (let i = 0; i < clean.length; i += 4) {
    const a = ALPHABET.indexOf(clean[i] ?? 'A');
    const b = ALPHABET.indexOf(clean[i + 1] ?? 'A');
    const c = ALPHABET.indexOf(clean[i + 2] ?? 'A');
    const d = ALPHABET.indexOf(clean[i + 3] ?? 'A');
    const value = (a << 18) | (b << 12) | (c << 6) | d;

    bytes.push((value >> 16) & 0xff);
    // A group shorter than four characters carries fewer than three bytes.
    if (clean[i + 2] !== undefined) bytes.push((value >> 8) & 0xff);
    if (clean[i + 3] !== undefined) bytes.push(value & 0xff);
  }
  return Uint8Array.from(bytes);
}

/** Base64 of UTF-8 text back to the text. */
export function base64ToUtf8(base64: string): string {
  const bytes = base64ToBytes(base64);
  let out = '';

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      out += String.fromCharCode(((byte & 0x1f) << 6) | ((bytes[++i] as number) & 0x3f));
    } else if (byte < 0xf0) {
      out += String.fromCharCode(
        ((byte & 0x0f) << 12) | (((bytes[++i] as number) & 0x3f) << 6) | ((bytes[++i] as number) & 0x3f),
      );
    } else {
      // Outside the basic plane, so it becomes a surrogate pair.
      const code = ((byte & 0x07) << 18)
        | (((bytes[++i] as number) & 0x3f) << 12)
        | (((bytes[++i] as number) & 0x3f) << 6)
        | ((bytes[++i] as number) & 0x3f);
      const adjusted = code - 0x10000;
      out += String.fromCharCode(0xd800 + (adjusted >> 10), 0xdc00 + (adjusted & 0x3ff));
    }
  }
  return out;
}

/**
 * Pulls the JSON object out of a model's reply.
 *
 * Asking for JSON usually gets JSON, but a model may fence it or put a sentence
 * in front. Rejecting those would throw away a perfectly good score, so the
 * bare reply, the unfenced reply and the first balanced object are each tried
 * before giving up. Anything that is not an object — `null`, a number, a bare
 * apology — counts as no answer.
 */
export function parseModelJson<T>(reply: string): T {
  const trimmed = reply.trim();
  const candidates = [trimmed];

  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (unfenced !== trimmed) candidates.push(unfenced);

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      // `null`, a bare number and a quoted string all parse successfully, and
      // would then fail further along as a missing property — which reads as a
      // bug in the caller rather than as the model having answered wrongly.
      if (parsed !== null && typeof parsed === 'object') return parsed as T;
    } catch {
      // Try the next shape.
    }
  }
  throw new Error(`The model did not return JSON: ${trimmed.slice(0, 200)}`);
}
