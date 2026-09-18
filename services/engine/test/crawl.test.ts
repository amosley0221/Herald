import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, test } from 'node:test';
import type { Match, Preferences } from '@herald/core';
import { loadConfig, type LoadedConfig } from '../src/config.js';
import { openDatabase, Repository } from '../src/db.js';
import { createLogger } from '../src/log.js';
import type { Notifier } from '../src/notify/index.js';
import { Crawler } from '../src/pipeline/crawl.js';
import type { Scorer, ScoreResult } from '../src/pipeline/score.js';
import { defaultPreferences, emptyProfile } from '../src/server.js';
import type { RawPosting } from '../src/sources/types.js';

/**
 * End-to-end test of a crawl.
 *
 * Uses the real `command` adapter against a script that prints fixture
 * postings, a real SQLite database, and the real dedupe and prefilter stages.
 * Only the model call is faked, because that is the one part of the pipeline
 * that cannot run without credentials — everything else is the code that ships.
 */

const workspaces: string[] = [];

after(() => {
  for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
});

/** Postings the fake source emits: two duplicates and one that is filtered out. */
const FIXTURES = [
  {
    id: 'gh-1',
    title: 'Senior Product Designer',
    company: 'Duke Energy',
    location: 'Charlotte, NC',
    remote: false,
    payMin: 128000,
    payMax: 146000,
    payCurrency: 'USD',
    url: 'https://boards.greenhouse.io/duke/jobs/1',
    applyUrl: 'https://boards.greenhouse.io/duke/jobs/1',
    postedAt: new Date().toISOString(),
    description: 'Lead our design system across web and mobile.',
  },
  {
    // The same job, scraped by an aggregator. Must collapse onto the original.
    id: 'agg-1',
    title: 'Sr. Product Designer (Hybrid)',
    company: 'Duke Energy, Inc.',
    location: 'Charlotte, NC',
    remote: false,
    payMin: 128000,
    payMax: 146000,
    payCurrency: 'USD',
    url: 'https://aggregator.example/jobs/999',
    applyUrl: 'https://aggregator.example/jobs/999',
    postedAt: new Date().toISOString(),
    description: 'Lead our design system across web and mobile.',
  },
  {
    // Wrong role: the prefilter must drop this before it is ever scored.
    id: 'gh-2',
    title: 'Staff Backend Engineer',
    company: 'Truist',
    location: 'Charlotte, NC',
    remote: false,
    payMin: 150000,
    payMax: 180000,
    payCurrency: 'USD',
    url: 'https://boards.greenhouse.io/truist/jobs/2',
    applyUrl: 'https://boards.greenhouse.io/truist/jobs/2',
    postedAt: new Date().toISOString(),
    description: 'Own our payments backend.',
  },
];

function buildWorkspace(): { config: LoadedConfig; repo: Repository; close: () => void } {
  const dir = mkdtempSync(resolve(tmpdir(), 'herald-crawl-'));
  workspaces.push(dir);

  // A script the `command` adapter runs, so the real subprocess path is
  // exercised rather than a stubbed adapter.
  const feedScript = resolve(dir, 'feed.mjs');
  writeFileSync(
    feedScript,
    `const rows = ${JSON.stringify(FIXTURES)};\nfor (const row of rows) console.log(JSON.stringify(row));\n`,
  );

  writeFileSync(resolve(dir, 'herald.config.json'), JSON.stringify({
    auth: { token: 'test-token' },
    storage: { dataDir: './data' },
    schedule: { enabled: false },
    llm: { promptDir: resolve(process.cwd(), 'config/prompts'), concurrency: 2 },
    matching: { feedFloor: 60, initialLookbackHours: 48, maxPostingAgeDays: 30 },
    notifications: { enabled: false },
    sources: [
      {
        id: 'ats',
        adapter: 'command',
        priority: 10,
        options: { command: process.execPath, args: [feedScript], format: 'ndjson' },
      },
      {
        // Same rows, lower priority: every posting here is a duplicate.
        id: 'aggregator',
        adapter: 'command',
        priority: 1,
        options: { command: process.execPath, args: [feedScript], format: 'ndjson' },
      },
    ],
  }));

  const config = loadConfig(resolve(dir, 'herald.config.json'));
  const db = openDatabase(config.paths.database);
  return { config, repo: new Repository(db), close: () => db.close() };
}

/** A scorer that returns a fixed verdict without calling any model. */
function fakeScorer(scored: RawPosting[]): Scorer {
  const result: ScoreResult = {
    score: 91,
    why: ['Six years leading a design system is the first requirement listed.'],
    gaps: ['Asks for an accessibility credential.'],
    payEstimate: null,
  };
  return {
    available: true,
    async score(posting: RawPosting) {
      scored.push(posting);
      return result;
    },
    async scoreAll(
      postings: RawPosting[],
      _resume: string,
      _profile: unknown,
      _preferences: unknown,
      onResult: (posting: RawPosting, result: ScoreResult) => void | Promise<void>,
    ) {
      for (const posting of postings) {
        scored.push(posting);
        await onResult(posting, result);
      }
      return { scored: postings.length, failed: 0 };
    },
  } as unknown as Scorer;
}

function silentNotifier(pushed: Match[]): Notifier {
  return {
    enabled: false,
    async notifyInstant(match: Match) { pushed.push(match); },
    async notifyDigest() {},
    async notifyNeedsYou() {},
  } as unknown as Notifier;
}

const PREFERENCES: Preferences = {
  ...defaultPreferences({} as LoadedConfig),
  roles: ['Product Designer'],
  locations: ['Charlotte, NC'],
  minSalary: 110_000,
  threshold: 85,
  timezone: 'UTC',
};

test('a crawl ingests, dedupes, filters, scores and routes', async () => {
  const { config, repo, close } = buildWorkspace();
  try {
    repo.saveProfile(
      { ...emptyProfile(), fullName: 'Ada Lovelace', email: 'ada@example.com' },
      null,
      'Six years leading design systems across web and mobile. Figma, React, tokens.',
    );
    repo.savePreferences(PREFERENCES);

    const scored: RawPosting[] = [];
    const pushed: Match[] = [];
    const crawler = new Crawler(
      config, repo, fakeScorer(scored), silentNotifier(pushed),
      createLogger('fatal'),
    );

    const counts = await crawler.run();
    assert.ok(counts, 'the crawl should have run');

    // Six rows arrive (three fixtures from each of two sources); the backend
    // role is filtered, and the duplicates collapse to one posting.
    assert.equal(counts.read, 6, 'every row from both sources is read');
    assert.equal(counts.filtered, 2, 'the backend role is dropped once per source');
    assert.equal(scored.length, 1, 'only the surviving unique posting is scored');
    assert.equal(counts.matched, 1, 'one match is created');

    const matches = repo.listMatches();
    assert.equal(matches.length, 1);
    const match = matches[0]!;
    assert.equal(match.posting.company, 'Duke Energy');
    assert.equal(match.score, 91);
    assert.equal(match.status, 'pending');

    // The higher-priority source wins the collapse.
    assert.equal(match.posting.source, 'ats');
    assert.match(match.posting.url, /greenhouse/);

    // 91 is above the threshold of 85, so it pushes immediately.
    assert.equal(pushed.length, 1, 'a match above the threshold pushes at once');
    assert.equal(pushed[0]!.id, match.id);
  } finally {
    close();
  }
});

test('a second crawl re-reads the sources but creates no duplicate matches', async () => {
  const { config, repo, close } = buildWorkspace();
  try {
    repo.saveProfile({ ...emptyProfile() }, null, 'Six years leading design systems.');
    repo.savePreferences(PREFERENCES);

    const scored: RawPosting[] = [];
    const crawler = new Crawler(
      config, repo, fakeScorer(scored), silentNotifier([]), createLogger('fatal'),
    );

    await crawler.run();
    const afterFirst = repo.listMatches().length;

    await crawler.run();
    const afterSecond = repo.listMatches().length;

    assert.equal(afterFirst, 1);
    assert.equal(afterSecond, 1, 'a posting already stored never becomes a second match');
    assert.equal(scored.length, 1, 'and it is never scored twice');
  } finally {
    close();
  }
});

test('a crawl with no resume does nothing rather than scoring against nothing', async () => {
  const { config, repo, close } = buildWorkspace();
  try {
    repo.savePreferences(PREFERENCES);
    const crawler = new Crawler(
      config, repo, fakeScorer([]), silentNotifier([]), createLogger('fatal'),
    );
    assert.equal(await crawler.run(), null);
    assert.equal(repo.listMatches().length, 0);
  } finally {
    close();
  }
});

test('a match below the threshold is stored but not pushed', async () => {
  const { config, repo, close } = buildWorkspace();
  try {
    repo.saveProfile({ ...emptyProfile() }, null, 'Six years leading design systems.');
    repo.savePreferences({ ...PREFERENCES, threshold: 95 });

    const pushed: Match[] = [];
    const crawler = new Crawler(
      config, repo, fakeScorer([]), silentNotifier(pushed), createLogger('fatal'),
    );
    await crawler.run();

    assert.equal(repo.listMatches().length, 1, 'it still appears in the feed');
    assert.equal(pushed.length, 0, 'but 91 is below a threshold of 95, so no push');

    // And it is exactly what the digest job would pick up.
    const digest = repo.pendingForDigest(95, 60);
    assert.equal(digest.length, 1);
  } finally {
    close();
  }
});
