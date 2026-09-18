#!/usr/bin/env node
/**
 * The CI guard from the release spec: a pull request that changes user-facing
 * code must add a line to the CHANGELOG's Unreleased section.
 *
 * Run with the base ref to diff against:
 *
 *   node scripts/check-changelog.mjs origin/main
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'origin/main';

/** Paths whose changes the user can see, and which therefore need notes. */
const USER_FACING = [
  /^apps\//,
  /^packages\/core\//,
];

/** Changes under a user-facing path that nobody would read notes about. */
const EXEMPT = [
  /^apps\/[^/]+\/(README|\.gitignore)/,
  /\.test\.(ts|tsx)$/,
  /^apps\/[^/]+\/assets\/fonts\//,
];

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

let changed;
try {
  changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
} catch (cause) {
  console.error(`Could not diff against ${base}: ${cause.message}`);
  console.error('Make sure the workflow checks out with fetch-depth: 0.');
  process.exit(1);
}

if (changed.length === 0) {
  console.log('No changes to check.');
  process.exit(0);
}

const needsNotes = changed.filter(
  (path) => USER_FACING.some((re) => re.test(path)) && !EXEMPT.some((re) => re.test(path)),
);

if (needsNotes.length === 0) {
  console.log('No user-facing changes; a CHANGELOG entry is not required.');
  process.exit(0);
}

if (!changed.includes('CHANGELOG.md')) {
  console.error('This pull request changes user-facing code but does not touch CHANGELOG.md:\n');
  for (const path of needsNotes.slice(0, 20)) console.error(`  ${path}`);
  console.error('\nAdd a line under "## [Unreleased]" describing what changed for the user.');
  process.exit(1);
}

// Touching the file is not enough — the entry has to land under Unreleased,
// since that is the section a release actually cuts from.
const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8');
const heading = /^## \[Unreleased\].*$/m.exec(changelog);
if (!heading) {
  console.error('CHANGELOG.md has no "## [Unreleased]" heading.');
  process.exit(1);
}

const after = changelog.slice(heading.index + heading[0].length);
const nextHeading = after.search(/^## /m);
const section = (nextHeading === -1 ? after : after.slice(0, nextHeading)).trim();

if (!section) {
  console.error('CHANGELOG.md was changed, but the Unreleased section is still empty.');
  process.exit(1);
}

console.log('CHANGELOG entry found under Unreleased.');
