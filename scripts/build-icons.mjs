#!/usr/bin/env node
/**
 * Generates every app icon from the one mark in the design handoff.
 *
 * The emblem is a pixel crown: a 7×3 grid of 20px squares on a 24px pitch, with
 * the top row reduced to four merlons. Drawing it arithmetically rather than
 * rasterising the SVG keeps the output crisp at any size and means the icons can
 * be regenerated from nothing.
 *
 *   node scripts/build-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Crowned Pixel tokens. Kept in sync with packages/core/src/tokens.ts.
const ONYX = [0x0c, 0x0a, 0x09];
const GOLD = [0xc6, 0xa7, 0x5e];

/** The emblem's cells, in grid coordinates on a 7-wide, 3-tall board. */
function emblemCells() {
  const cells = [];
  // Top row: merlons at columns 0, 2, 4, 6.
  for (const column of [0, 2, 4, 6]) cells.push([column, 0]);
  // The two solid rows beneath them.
  for (let row = 1; row <= 2; row++) {
    for (let column = 0; column < 7; column++) cells.push([column, row]);
  }
  return cells;
}

/**
 * Renders the emblem into an RGBA buffer.
 *
 * `coverage` is how much of the canvas the crown spans, which is what keeps the
 * mark inside Android's adaptive-icon safe zone.
 */
function render({ size, background, foreground, coverage }) {
  const pixels = new Uint8Array(size * size * 4);

  if (background) {
    for (let i = 0; i < size * size; i++) {
      pixels[i * 4] = background[0];
      pixels[i * 4 + 1] = background[1];
      pixels[i * 4 + 2] = background[2];
      pixels[i * 4 + 3] = 255;
    }
  }

  // The source grid is 7 columns × 3 rows on a 24px pitch with 20px squares.
  const columns = 7;
  const rows = 3;
  const pitch = (size * coverage) / columns;
  const square = pitch * (20 / 24);
  // The last cell in each direction contributes a square, not a whole pitch,
  // so the drawn extent is one gutter shorter than `pitch * count`.
  const drawnWidth = (columns - 1) * pitch + square;
  const drawnHeight = (rows - 1) * pitch + square;
  const originX = (size - drawnWidth) / 2;
  const originY = (size - drawnHeight) / 2;

  for (const [column, row] of emblemCells()) {
    const left = Math.round(originX + column * pitch);
    const top = Math.round(originY + row * pitch);
    const right = Math.min(size, Math.round(left + square));
    const bottom = Math.min(size, Math.round(top + square));
    for (let y = Math.max(0, top); y < bottom; y++) {
      for (let x = Math.max(0, left); x < right; x++) {
        const i = (y * size + x) * 4;
        pixels[i] = foreground[0];
        pixels[i + 1] = foreground[1];
        pixels[i + 2] = foreground[2];
        pixels[i + 3] = foreground[3] ?? 255;
      }
    }
  }

  return pixels;
}

/** Minimal PNG encoder — RGBA, no filtering, one IDAT. */
function encodePng(pixels, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, rowStart + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const TARGETS = [
  // Store/launcher icon: gold crown on the onyx field.
  { path: 'apps/android/assets/icon.png', size: 1024, background: ONYX, foreground: GOLD, coverage: 0.62 },
  // Adaptive foreground: transparent, and smaller so the system mask cannot
  // crop the crown whatever shape the launcher applies.
  { path: 'apps/android/assets/adaptive-icon.png', size: 1024, background: null, foreground: GOLD, coverage: 0.44 },
  { path: 'apps/android/assets/splash.png', size: 1024, background: ONYX, foreground: GOLD, coverage: 0.30 },
  // Android renders the status-bar icon as a silhouette and tints it itself,
  // so this one is pure white on transparent.
  { path: 'apps/android/assets/notification-icon.png', size: 96, background: null, foreground: [255, 255, 255, 255], coverage: 0.72 },
  { path: 'apps/android/assets/favicon.png', size: 64, background: ONYX, foreground: GOLD, coverage: 0.7 },
  { path: 'apps/desktop/public/icon.png', size: 1024, background: ONYX, foreground: GOLD, coverage: 0.62 },
  { path: 'apps/desktop/src-tauri/icons/icon.png', size: 1024, background: ONYX, foreground: GOLD, coverage: 0.62 },
  { path: 'apps/desktop/src-tauri/icons/128x128.png', size: 128, background: ONYX, foreground: GOLD, coverage: 0.62 },
  { path: 'apps/desktop/src-tauri/icons/128x128@2x.png', size: 256, background: ONYX, foreground: GOLD, coverage: 0.62 },
  { path: 'apps/desktop/src-tauri/icons/32x32.png', size: 32, background: ONYX, foreground: GOLD, coverage: 0.7 },
];

for (const target of TARGETS) {
  const absolute = resolve(root, target.path);
  mkdirSync(dirname(absolute), { recursive: true });
  const pixels = render(target);
  writeFileSync(absolute, encodePng(pixels, target.size));
  console.log(`  ${target.path} (${target.size}px)`);
}

console.log(`\nGenerated ${TARGETS.length} icons from the emblem.`);
