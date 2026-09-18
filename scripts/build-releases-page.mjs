#!/usr/bin/env node
/**
 * Renders the public release-notes page from `releases/index.json`.
 *
 * This is the web half of the release-notes requirement: the same entries the
 * in-app "What's new" screen shows, at a URL that can be linked to. It is a
 * single self-contained file so GitHub Pages can serve the `releases/` folder
 * with no build step of its own.
 *
 *   node scripts/build-releases-page.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { color, toRoman } from '../packages/core/dist/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = resolve(root, 'releases/index.json');

if (!existsSync(indexPath)) {
  console.error('No releases/index.json yet. Cut a release first.');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));

const escape = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** `2026-09-18` -> `18 · IX · MMXXVI`, matching the app's dateline. */
function romanDate(iso) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!parts) return escape(iso);
  return `${Number(parts[3])} · ${toRoman(Number(parts[2]))} · ${toRoman(Number(parts[1]))}`;
}

/** The Keep-a-Changelog subset the notes actually use. */
function renderNotes(markdown) {
  const out = [];
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      out.push(`<p class="label">${escape(line.replace(/^#+\s*/, ''))}</p>`);
    } else if (line.startsWith('-') || line.startsWith('*')) {
      out.push(`<li>${inline(line.replace(/^[-*]\s*/, ''))}</li>`);
    } else {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  // Wrap runs of <li> so the bullets are a real list for screen readers.
  return out
    .join('\n')
    .replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (run) => `<ul>\n${run.trim()}\n</ul>`);
}

function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

const sections = index.releases.map((release) => `
      <section class="release">
        <header>
          <h2>${escape(release.version)}</h2>
          <span class="label">${romanDate(release.date)}</span>
        </header>
        ${renderNotes(release.notesMarkdown)}
        ${(release.patches ?? []).map((patch) => `
        <div class="patch">
          <p class="label label--gold">Patch ${patch.number} · ${romanDate(patch.date)}</p>
          ${renderNotes(patch.notesMarkdown)}
        </div>`).join('')}
      </section>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Herald · Releases</title>
<meta name="description" content="Release notes for Herald, the automated job application engine.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --onyx: ${color.onyx};
    --graphite: ${color.graphite};
    --gold: ${color.gold};
    --bone: ${color.bone};
    --stone: ${color.stone};
    --line: ${color.line};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--onyx);
    color: var(--bone);
    font-family: 'Jost', system-ui, sans-serif;
    font-weight: 300;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 88px 24px 120px; }
  header.masthead { border-bottom: 1px solid var(--line); padding-bottom: 24px; margin-bottom: 44px; }
  .emblem { display: block; margin-bottom: 24px; }
  h1 {
    font-family: 'Cinzel', Georgia, serif;
    font-weight: 500;
    font-size: 40px;
    letter-spacing: .02em;
    margin: 0;
    line-height: 1.15;
  }
  .label {
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: .18em;
    color: var(--stone);
    margin: 8px 0;
  }
  .label--gold { color: var(--gold); }
  .release { border-bottom: 1px solid var(--line); padding: 24px 0; }
  .release header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
  .release h2 {
    font-family: 'Cinzel', Georgia, serif;
    font-weight: 500;
    font-size: 28px;
    letter-spacing: .02em;
    margin: 0;
  }
  .release:first-of-type h2 { color: var(--gold); }
  ul { list-style: none; padding: 0; margin: 8px 0 16px; }
  li { padding-left: 24px; position: relative; margin-bottom: 8px; font-size: 15px; }
  li::before { content: '·'; color: var(--gold); position: absolute; left: 8px; }
  p { font-size: 15px; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
    color: var(--gold);
  }
  a { color: var(--bone); }
  a:hover { color: var(--gold); }
  .patch { border-left: 1px solid var(--line); padding-left: 16px; margin: 16px 0; }
  footer { margin-top: 44px; color: var(--stone); font-size: 13px; }
  @media (max-width: 600px) {
    .wrap { padding: 44px 16px 88px; }
    h1 { font-size: 28px; }
    .release h2 { font-size: 20px; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="masthead">
      <svg class="emblem" width="40" height="14" viewBox="0 12 188 68" aria-hidden="true">
        ${[[12, 12], [60, 12], [108, 12], [156, 12],
          ...[36, 60].flatMap((y) => [12, 36, 60, 84, 108, 132, 156].map((x) => [x, y]))]
          .map(([x, y]) => `<rect x="${x}" y="${y}" width="20" height="20" fill="${color.gold}"/>`).join('')}
      </svg>
      <h1>HERALD</h1>
      <p class="label">Releases · Current ${escape(index.latest)}</p>
    </header>

${sections}

    <footer>
      <p>Updates arrive in the app on their own. Preferences → About → What's new
      shows the same notes on your phone and desktop.</p>
    </footer>
  </div>
</body>
</html>
`;

writeFileSync(resolve(root, 'releases/index.html'), html, 'utf8');
console.log(`Wrote releases/index.html (${index.releases.length} releases, latest ${index.latest}).`);
