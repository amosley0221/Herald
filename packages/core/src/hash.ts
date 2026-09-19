/**
 * SHA-256 and UUIDs that behave identically on a server and on a phone.
 *
 * The pipeline hashes postings to decide what it has already seen, so the same
 * posting must produce the same key wherever the pipeline runs. `node:crypto`
 * does not exist in React Native, and `expo-crypto`'s digest is asynchronous,
 * which would make `dedupeKey` async and infect every caller. This is the
 * algorithm itself, in about eighty lines, so both platforms agree by
 * construction and the call sites stay synchronous.
 *
 * It is used for content identity, never for secrets.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** UTF-8 encodes without TextEncoder, which older React Native runtimes lack. */
function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // A surrogate pair is one code point; combine it before encoding.
      const low = text.charCodeAt(i + 1);
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      i++;
      out.push(
        0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f),
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** The hex SHA-256 digest of a string. */
export function sha256(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;

  // Pad to a multiple of 64 bytes: a 1 bit, zeroes, then the length as 64 bits.
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  // The high word of the length; a string long enough to need it cannot be held
  // in memory anyway, so only the low 32 bits are written.
  view.setUint32(padded.length - 4, bitLength >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);

  // The eight state words are kept as named locals rather than an array: every
  // indexed read would otherwise be `number | undefined` under
  // noUncheckedIndexedAccess, and asserting on each one would bury the
  // algorithm. `at` does that assertion in the one place it is unavoidable.
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  /** A Uint32Array read at an index this function has already bounded. */
  const at = (array: Uint32Array, index: number): number => array[index] as number;

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = at(w, i - 15);
      const y = at(w, i - 2);
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = (at(w, i - 16) + s0 + at(w, i - 7) + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + at(K, i) + at(w, i)) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
  }

  let hex = '';
  for (const word of [h0, h1, h2, h3, h4, h5, h6, h7]) hex += word.toString(16).padStart(8, '0');
  return hex;
}

/**
 * A random identifier.
 *
 * Uses the platform's CSPRNG where there is one — Node has it natively, and
 * importing expo-crypto installs it in React Native — and otherwise falls back
 * to Math.random, which is fine for a local row id and is never used for a
 * token or anything that has to be unguessable.
 */
export function randomId(): string {
  const bytes = new Uint8Array(16);
  const webCrypto = (globalThis as { crypto?: Crypto }).crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40; // version 4
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80; // variant 1

  const hex: string[] = [];
  for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''), hex.slice(4, 6).join(''), hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''), hex.slice(10, 16).join(''),
  ].join('-');
}
