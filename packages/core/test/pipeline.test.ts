import { strict as assert } from 'node:assert';
import { test } from 'node:test';
// Against the built barrel rather than the sources: these modules import each
// other with .js specifiers, which only resolve after tsc, and testing the
// artifact that actually ships is the better check anyway.
import {
  collapse, dedupeKey, defineSource, greenhouseAdapter, leverAdapter, prefilter,
} from '../dist/index.js';
import type { HttpClient, Logger, Preferences, RawPosting } from '../dist/index.js';

/**
 * The scan, end to end, without a network or a database.
 *
 * This is the path the Android app runs with no engine behind it: adapter ->
 * dedupe -> prefilter -> collapse. It is the same code the engine runs, so this
 * covers both.
 */

const silent: Logger = { error() {}, warn() {}, info() {}, debug() {} };

function stubHttp(routes: Record<string, unknown>): HttpClient {
  return {
    async json<T>(url: string): Promise<T> {
      const match = Object.keys(routes).find((key) => url.includes(key));
      if (!match) throw new Error(`no stub for ${url}`);
      return routes[match] as T;
    },
    async text(): Promise<string> {
      throw new Error('not used');
    },
  };
}

const preferences: Preferences = {
  roles: ['Product Designer'], locations: ['Charlotte'], remote: true, minSalary: 120_000,
  threshold: 85, instant: true, digest: true, digestHour: 7, tailorLetter: true,
  dailySubmitCap: 15, timezone: 'UTC', seniority: [], excludeKeywords: ['unpaid'],
};

const recently = new Date(Date.now() - 60 * 60 * 1000).toISOString();

async function drain(iterable: AsyncIterable<RawPosting>): Promise<RawPosting[]> {
  const out: RawPosting[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

test('a Greenhouse board yields postings the preferences keep', async () => {
  const http = stubHttp({
    '/boards/acme/jobs': {
      jobs: [
        {
          id: 1, title: 'Senior Product Designer', updated_at: recently,
          location: { name: 'Charlotte, NC' }, absolute_url: 'https://acme.example/1',
          content: '&lt;p&gt;Design things. $150,000 - $180,000&lt;/p&gt;', company_name: 'Acme',
        },
        {
          id: 2, title: 'Unpaid Design Intern', updated_at: recently,
          location: { name: 'Charlotte, NC' }, absolute_url: 'https://acme.example/2',
          content: '&lt;p&gt;An unpaid internship.&lt;/p&gt;', company_name: 'Acme',
        },
        {
          id: 3, title: 'Warehouse Associate', updated_at: recently,
          location: { name: 'Charlotte, NC' }, absolute_url: 'https://acme.example/3',
          content: '&lt;p&gt;Lift boxes.&lt;/p&gt;', company_name: 'Acme',
        },
      ],
    },
  });

  const source = defineSource({ id: 'gh', adapter: 'greenhouse', options: { boards: ['acme'] } });
  const postings = await drain(greenhouseAdapter.fetch(source, {
    since: new Date(Date.now() - 24 * 60 * 60 * 1000),
    log: silent, http, signal: new AbortController().signal,
  }));

  assert.equal(postings.length, 3, 'the adapter should yield everything recent');

  const kept = postings.filter((posting) => prefilter(posting, preferences).keep);
  const titles = kept.map((posting) => posting.title);

  assert.ok(titles.includes('Senior Product Designer'), 'the matching role should survive');
  assert.ok(!titles.includes('Unpaid Design Intern'), 'an excluded keyword should drop it');
  assert.ok(!titles.includes('Warehouse Associate'), 'an unrelated role should drop it');
});

test('postings older than the window are not yielded at all', async () => {
  const http = stubHttp({
    '/boards/acme/jobs': {
      jobs: [{
        id: 9, title: 'Senior Product Designer',
        updated_at: new Date('2020-01-01').toISOString(),
        location: { name: 'Charlotte, NC' }, absolute_url: 'https://acme.example/9',
        content: 'Old posting', company_name: 'Acme',
      }],
    },
  });
  const source = defineSource({ id: 'gh', adapter: 'greenhouse', options: { boards: ['acme'] } });
  const postings = await drain(greenhouseAdapter.fetch(source, {
    since: new Date(Date.now() - 24 * 60 * 60 * 1000),
    log: silent, http, signal: new AbortController().signal,
  }));
  assert.deepEqual(postings, [], 'a posting published before the window is not news');
});

test('a dead board does not sink the scan', async () => {
  const http: HttpClient = {
    async json<T>(url: string): Promise<T> {
      if (url.includes('broken')) throw new Error('502 Bad Gateway');
      return { jobs: [] } as T;
    },
    async text(): Promise<string> { throw new Error('not used'); },
  };
  const source = defineSource({
    id: 'gh', adapter: 'greenhouse', options: { boards: ['broken', 'alsofine'] },
  });
  const postings = await drain(greenhouseAdapter.fetch(source, {
    since: new Date(0), log: silent, http, signal: new AbortController().signal,
  }));
  assert.deepEqual(postings, [], 'the failing board is skipped, not thrown');
});

test('the same job on two boards collapses onto the higher-priority source', async () => {
  const shared = {
    title: 'Senior Product Designer', company: 'Acme', location: 'Charlotte, NC',
    remote: false, postedAt: recently,
  };
  const key = dedupeKey(shared);

  const fromAggregator = { ...shared, dedupeKey: key, source: 'aggregator', sourcePriority: 0 };
  const fromAts = { ...shared, dedupeKey: key, source: 'greenhouse', sourcePriority: 10 };

  const [winner] = collapse([fromAggregator, fromAts]);
  assert.equal(winner?.source, 'greenhouse', 'the ATS original should outrank the aggregator');
  assert.equal(collapse([fromAggregator, fromAts]).length, 1, 'duplicates collapse to one');
});

test('two different jobs at the same company do not collapse', async () => {
  const designer = dedupeKey({ title: 'Senior Product Designer', company: 'Acme', location: 'Remote', remote: true });
  const engineer = dedupeKey({ title: 'Staff Engineer', company: 'Acme', location: 'Remote', remote: true });
  assert.notEqual(designer, engineer);
});

test('a Lever site is read by the same pipeline', async () => {
  const http = stubHttp({
    'lever.co': [{
      id: 'abc', text: 'Senior Product Designer', createdAt: Date.now() - 3_600_000,
      categories: { location: 'Charlotte, NC' }, hostedUrl: 'https://jobs.lever.co/acme/abc',
      applyUrl: 'https://jobs.lever.co/acme/abc/apply', descriptionPlain: 'Design things.',
    }],
  });
  const source = defineSource({ id: 'lv', adapter: 'lever', options: { sites: ['acme'] } });
  const postings = await drain(leverAdapter.fetch(source, {
    since: new Date(Date.now() - 24 * 60 * 60 * 1000),
    log: silent, http, signal: new AbortController().signal,
  }));
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.title, 'Senior Product Designer');
  assert.ok(prefilter(postings[0]!, preferences).keep, 'it should survive the prefilter');
});
