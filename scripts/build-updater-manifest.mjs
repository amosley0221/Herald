#!/usr/bin/env node
/**
 * Assembles the Tauri updater manifest from a published GitHub Release.
 *
 * `tauri-action` uploads one installer and one `.sig` per platform. This reads
 * the release's assets, pairs each installer with its signature, and writes
 * `releases/latest.json` — the file the desktop app polls to decide whether a
 * new build exists.
 *
 *   GH_TOKEN=... node scripts/build-updater-manifest.mjs 1.4.2
 *
 * The signature is what makes the update safe: the app verifies it against the
 * public key in `tauri.conf.json` and refuses anything that does not match, so
 * a compromised host cannot serve a build of its own.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('Usage: build-updater-manifest.mjs <version>');
  process.exit(1);
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
if (!repository || !token) {
  console.error('GITHUB_REPOSITORY and GH_TOKEN must be set.');
  process.exit(1);
}

/** Maps an asset file name to the Tauri platform key it belongs to. */
function platformFor(name) {
  if (/\.app\.tar\.gz$/.test(name)) {
    // A universal macOS build serves both architectures.
    return name.includes('aarch64') ? ['darwin-aarch64']
      : name.includes('x64') || name.includes('x86_64') ? ['darwin-x86_64']
        : ['darwin-aarch64', 'darwin-x86_64'];
  }
  if (/\.nsis\.zip$/.test(name) || /-setup\.exe$/.test(name)) return ['windows-x86_64'];
  if (/\.AppImage(\.tar\.gz)?$/.test(name)) return ['linux-x86_64'];
  return [];
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'herald-release',
};

const response = await fetch(
  `https://api.github.com/repos/${repository}/releases/tags/v${version}`,
  { headers },
);
if (!response.ok) {
  console.error(`Could not read release v${version}: ${response.status}`);
  process.exit(1);
}

const release = await response.json();
const assets = release.assets ?? [];
const signatures = new Map(
  assets.filter((asset) => asset.name.endsWith('.sig')).map((asset) => [asset.name, asset]),
);

const platforms = {};
for (const asset of assets) {
  if (asset.name.endsWith('.sig')) continue;
  const keys = platformFor(asset.name);
  if (keys.length === 0) continue;

  const signatureAsset = signatures.get(`${asset.name}.sig`);
  if (!signatureAsset) {
    // An unsigned artifact would be rejected by the client anyway; leaving it
    // out of the manifest is clearer than shipping an entry that cannot work.
    console.warn(`  skipping ${asset.name}: no signature was uploaded`);
    continue;
  }

  const signature = await fetch(signatureAsset.url, {
    headers: { ...headers, Accept: 'application/octet-stream' },
  }).then((res) => res.text());

  for (const key of keys) {
    platforms[key] = { signature: signature.trim(), url: asset.browser_download_url };
    console.log(`  ${key} -> ${asset.name}`);
  }
}

// The Android APK ships as a release asset too. Recording its real URL in the
// feed means the in-app updater downloads what CI actually published rather
// than guessing a path from the feed's own location.
const apk = assets.find((asset) => asset.name.endsWith('.apk'));
for (const name of [`${version}.json`, 'index.json']) {
  const path = resolve(root, 'releases', name);
  if (!existsSync(path)) continue;
  const feed = JSON.parse(readFileSync(path, 'utf8'));
  const entries = Array.isArray(feed.releases) ? feed.releases : [feed];
  for (const entry of entries) {
    if (entry.version === version) entry.androidApkUrl = apk?.browser_download_url ?? null;
  }
  writeFileSync(path, `${JSON.stringify(feed, null, 2)}\n`);
  console.log(`  ${name} -> androidApkUrl ${apk ? 'set' : 'cleared'}`);
}

const notesPath = resolve(root, 'releases/notes.md');
const manifest = {
  version,
  notes: existsSync(notesPath) ? readFileSync(notesPath, 'utf8').trim() : release.body ?? '',
  pub_date: release.published_at ?? new Date().toISOString(),
  platforms,
};

writeFileSync(resolve(root, 'releases/latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (Object.keys(platforms).length === 0) {
  console.warn('\nNo signed installers were found. Desktop updates will not be offered.');
} else {
  console.log(`\nWrote releases/latest.json for ${version}.`);
}
