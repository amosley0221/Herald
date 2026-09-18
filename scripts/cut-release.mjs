#!/usr/bin/env node
/**
 * Cuts a release from the CHANGELOG.
 *
 * Turns `## [Unreleased]` into `## [x.y.z] — YYYY-MM-DD`, then writes the
 * machine-readable feeds every updater reads:
 *
 *   releases/<version>.json  one release, with its notes and Android versionCode
 *   releases/index.json      the whole history, newest first
 *   releases/latest.json     the Tauri updater manifest
 *   releases/notes.md        the GitHub Release body
 *
 * Run it from CI on a tag, or by hand to preview:
 *
 *   node scripts/cut-release.mjs 1.4.2 [--dry-run]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidVersionCode, compareVersions, formatVersion, parseVersion } from '../packages/core/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = resolve(root, 'CHANGELOG.md');
const releasesDir = resolve(root, 'releases');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = formatVersion(args.find((arg) => !arg.startsWith('--')) ?? readRootVersion());

if (!parseVersion(version)) {
  console.error(`Not a semantic version: ${version}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const changelog = readFileSync(changelogPath, 'utf8');

// ── Cut the Unreleased section ──────────────────────────────────────────────

/** Returns the body of a `## [heading]` section, or null when it is absent. */
function sectionBody(text, heading) {
  const match = heading.exec(text);
  if (!match) return null;
  const start = match.index + match[0].length;
  const next = text.slice(start).search(/^## /m);
  return (next === -1 ? text.slice(start) : text.slice(start, start + next)).trim();
}

const unreleasedHeading = /^## \[Unreleased\].*$/m;
const versionHeading = new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\].*$`, 'm');

// A release that was already cut — because an earlier run got this far and a
// later job failed — must be re-runnable. Reuse the existing section rather
// than failing on an Unreleased block that is now legitimately empty.
const alreadyCut = versionHeading.test(changelog);

let body;
let cut = changelog;

if (alreadyCut) {
  body = sectionBody(changelog, versionHeading);
  console.log(`${version} was already cut; reusing its notes and regenerating the feeds.`);
  if (!body) {
    console.error(`CHANGELOG.md has a [${version}] heading but no notes under it.`);
    process.exit(1);
  }
} else {
  if (!unreleasedHeading.test(changelog)) {
    console.error('CHANGELOG.md has no "## [Unreleased]" heading to cut.');
    process.exit(1);
  }
  body = sectionBody(changelog, unreleasedHeading);
  if (!body) {
    console.error(
      'The Unreleased section is empty. Every release needs notes — that is the point of the release-notes requirement.',
    );
    process.exit(1);
  }
  cut = changelog.replace(
    unreleasedHeading,
    `## [Unreleased]\n\n## [${version}] — ${today}`,
  );
}

// ── Build the feeds ─────────────────────────────────────────────────────────

const previous = existing0(version);
const entry = {
  version,
  // Keep the date the release was first cut on; a re-run is not a new release.
  date: previous?.date ?? today,
  notesMarkdown: body,
  androidVersionCode: androidVersionCode(version),
  // Builds older than this are refused an update path and told to reinstall.
  // Same major, minor zero: a major bump is where a clean break belongs.
  minSupported: `${parseVersion(version).major}.0.0`,
  // Filled in by build-updater-manifest.mjs once the APK has been uploaded.
  androidApkUrl: null,
  patches: [],
};

function existing0(v) {
  const path = resolve(releasesDir, `${v}.json`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

mkdirSync(releasesDir, { recursive: true });

const existing = readdirSync(releasesDir)
  .filter((name) => /^\d+\.\d+\.\d+\.json$/.test(name))
  .map((name) => JSON.parse(readFileSync(resolve(releasesDir, name), 'utf8')))
  .filter((release) => release.version !== version);

const all = [entry, ...existing].sort((a, b) => compareVersions(b.version, a.version));

const index = {
  latest: all[0].version,
  androidVersionCode: all[0].androidVersionCode,
  minSupported: all[0].minSupported,
  releases: all,
};

/**
 * The Tauri updater manifest.
 *
 * Signatures and platform URLs are filled in by the release workflow once the
 * installers exist; this writes the shape so the file is valid either way.
 */
const latest = {
  version,
  notes: body,
  pub_date: new Date().toISOString(),
  platforms: {},
};

if (dryRun) {
  console.log(`--- ${version} — ${today} ---\n`);
  console.log(body);
  console.log(`\nAndroid versionCode: ${entry.androidVersionCode}`);
  console.log(`Releases in index after this cut: ${all.length}`);
  process.exit(0);
}

writeFileSync(changelogPath, cut, 'utf8');
writeFileSync(resolve(releasesDir, `${version}.json`), `${JSON.stringify(entry, null, 2)}\n`);
writeFileSync(resolve(releasesDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
writeFileSync(resolve(releasesDir, 'latest.json'), `${JSON.stringify(latest, null, 2)}\n`);
// The GitHub Release body, so CI does not have to re-parse the changelog.
writeFileSync(resolve(releasesDir, 'notes.md'), `${body}\n`);

console.log(`Cut ${version} — ${today}`);
console.log(`  CHANGELOG.md updated`);
console.log(`  releases/${version}.json`);
console.log(`  releases/index.json (${all.length} releases)`);
console.log(`  releases/latest.json`);
console.log(`  releases/notes.md`);

function readRootVersion() {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
}
