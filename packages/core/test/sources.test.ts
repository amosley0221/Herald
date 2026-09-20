import { test } from 'node:test';
import assert from 'node:assert/strict';
// The built barrel, as the other suites do: these modules import each other
// with .js specifiers, and the artifact that ships is the better thing to test.
import {
  SOURCE_PRESETS, defineSource, findPreset, jsonAdapter, missingCredentials, testSource,
  type RawPosting, type SearchTerms,
} from '../dist/index.js';

/**
 * These cover the half that is ours: the templating, the mapping and the
 * reporting. The live services are not reachable from CI and could change their
 * shapes anyway, so what is asserted here is that a given payload maps to a
 * given posting -- which is exactly what breaks silently when a preset is wrong.
 */

const silent = { error() {}, warn() {}, info() {}, debug() {} };

/** An http client that records every URL and replays canned payloads. */
function stubHttp(responses: unknown[] | ((url: string) => unknown)) {
  const urls: string[] = [];
  const headers: Array<Record<string, string> | undefined> = [];
  let index = 0;
  return {
    urls,
    headers,
    client: {
      async json<T>(url: string, init?: RequestInit): Promise<T> {
        urls.push(url);
        headers.push(init?.headers as Record<string, string> | undefined);
        if (typeof responses === 'function') return responses(url) as T;
        return (responses[index++] ?? []) as T;
      },
      async text(url: string): Promise<string> {
        urls.push(url);
        return '';
      },
    },
  };
}

async function collect(
  source: ReturnType<typeof defineSource>,
  http: { json<T>(u: string, i?: RequestInit): Promise<T>; text(u: string): Promise<string> },
  search?: SearchTerms,
  since = new Date('2020-01-01T00:00:00Z'),
): Promise<RawPosting[]> {
  const out: RawPosting[] = [];
  for await (const posting of jsonAdapter.fetch(source, {
    since, search, log: silent, http, signal: new AbortController().signal,
  })) out.push(posting);
  return out;
}

test('a query source asks once per role, with the terms URL-encoded', async () => {
  const stub = stubHttp(() => ({ jobs: [] }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api?what={query}&where={location}', listPath: 'jobs', maxQueries: 3 },
    fieldMap: { title: 'title', url: 'url' },
  });

  await collect(source, stub.client, {
    queries: ['C++ engineer', 'Product Manager'], location: 'Charlotte, NC', remote: true,
  });

  assert.deepEqual(stub.urls, [
    'https://x.test/api?what=C%2B%2B%20engineer&where=Charlotte%2C%20NC',
    'https://x.test/api?what=Product%20Manager&where=Charlotte%2C%20NC',
  ]);
});

test('maxQueries caps the requests a single source can make', async () => {
  const stub = stubHttp(() => ({ jobs: [] }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api?q={query}', listPath: 'jobs', maxQueries: 2 },
    fieldMap: { title: 'title', url: 'url' },
  });

  await collect(source, stub.client, { queries: ['a', 'b', 'c', 'd'], location: '', remote: false });

  assert.equal(stub.urls.length, 2);
});

test('a query source with nothing to search for does not run', async () => {
  const stub = stubHttp(() => ({ jobs: [] }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api?q={query}', listPath: 'jobs' },
    fieldMap: { title: 'title', url: 'url' },
  });

  // An empty term would ask an aggregator for every job it holds.
  await collect(source, stub.client, { queries: [], location: '', remote: false });
  assert.deepEqual(stub.urls, []);

  await collect(source, stub.client, undefined);
  assert.deepEqual(stub.urls, []);
});

test('string options fill placeholders, so a key in the query string needs no new mechanism', async () => {
  const stub = stubHttp(() => ({ results: [] }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: {
      appId: 'abc', appKey: 'sec ret',
      url: 'https://x.test/v1/{page}?app_id={appId}&app_key={appKey}',
      listPath: 'results',
    },
    fieldMap: { title: 'title', url: 'url' },
  });

  await collect(source, stub.client);

  assert.equal(stub.urls[0], 'https://x.test/v1/1?app_id=abc&app_key=sec%20ret');
});

test('configured headers are templated but not URL-encoded', async () => {
  const stub = stubHttp(() => ({ items: [] }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: {
      authKey: 'k3y', userAgent: 'a person@example.com',
      url: 'https://x.test/api',
      listPath: 'items',
      headers: { 'Authorization-Key': '{authKey}', 'User-Agent': '{userAgent}' },
    },
    fieldMap: { title: 'title', url: 'url' },
  });

  await collect(source, stub.client);

  // Percent-encoding here would send a User-Agent the service does not accept.
  assert.deepEqual(stub.headers[0], {
    'Authorization-Key': 'k3y',
    'User-Agent': 'a person@example.com',
  });
});

test('a posted date given as epoch seconds is read as a date, not as now', async () => {
  const posted = Math.floor(Date.parse('2024-03-04T05:06:07Z') / 1000);
  const stub = stubHttp(() => ({
    data: [{ slug: 'a', title: 'Engineer', company_name: 'Acme', url: 'https://x.test/a', created_at: posted }],
  }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api', listPath: 'data' },
    fieldMap: { id: 'slug', title: 'title', company: 'company_name', url: 'url', postedAt: 'created_at' },
  });

  const [posting] = await collect(source, stub.client);

  // Falling back to `new Date()` would date every posting to the scan, so
  // nothing would ever age out of the window.
  assert.equal(posting!.postedAt, '2024-03-04T05:06:07.000Z');
});

test('a failing page ends that query without ending the source', async () => {
  const stub = stubHttp((url) => {
    if (url.includes('q=bad')) throw new Error('500');
    return { jobs: [{ title: 'Kept', url: 'https://x.test/1' }] };
  });
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api?q={query}', listPath: 'jobs' },
    fieldMap: { title: 'title', url: 'url' },
  });

  const postings = await collect(source, stub.client, {
    queries: ['bad', 'good'], location: '', remote: false,
  });

  assert.equal(postings.length, 1);
  assert.equal(postings[0]!.title, 'Kept');
});

test('every preset is a usable source definition', () => {
  for (const preset of SOURCE_PRESETS) {
    const source = preset.build();
    assert.equal(source.id, preset.id, `${preset.id}: id must match the preset`);
    assert.equal(source.adapter, 'json', `${preset.id}: presets are definitions, not code`);
    assert.equal(source.enabled, false, `${preset.id}: nothing turns itself on`);
    assert.ok(source.fieldMap?.title, `${preset.id}: needs a title mapping`);
    assert.ok(source.fieldMap?.url, `${preset.id}: needs a url mapping`);
    assert.ok(typeof source.options.url === 'string', `${preset.id}: needs a url`);

    // A preset that says it searches must actually use the user's terms, and
    // one that says it does not must not silently ignore them.
    const url = String(source.options.url);
    const usesQuery = url.includes('{query}');
    assert.equal(usesQuery, preset.searches, `${preset.id}: searches flag must match the url`);

    // Every placeholder must be fillable, or the request goes out malformed.
    for (const [, name] of url.matchAll(/\{(\w+)\}/g)) {
      const known = ['page', 'query', 'location', 'since', 'sinceDate'];
      assert.ok(
        known.includes(name!) || name! in source.options,
        `${preset.id}: {${name}} is neither built in nor an option`,
      );
    }

    // Anything the user must supply starts empty and is declared, so the UI can
    // refuse to enable a source that would only 401.
    for (const credential of preset.credentials ?? []) {
      assert.equal(source.options[credential.option], '', `${preset.id}: ${credential.option} must start empty`);
    }
    assert.deepEqual(
      missingCredentials(preset, source).sort(),
      (preset.credentials ?? []).map((c) => c.option).sort(),
      `${preset.id}: a fresh preset is missing all of its credentials`,
    );
  }
});

test('findPreset round-trips every preset and refuses an unknown one', () => {
  for (const preset of SOURCE_PRESETS) {
    assert.equal(findPreset(preset.id)?.name, preset.name);
  }
  assert.equal(findPreset('indeed'), undefined);
});

test('testSource reports a mapping that produced nothing', async () => {
  const stub = stubHttp(() => ({ jobs: [{ name: 'Engineer', link: 'https://x.test/1' }] }));
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api', listPath: 'jobs' },
    fieldMap: { title: 'title', url: 'url' },  // wrong: the feed says name/link
  });

  const result = await testSource(source, { http: stub.client });

  assert.equal(result.ok, false);
  assert.equal(result.read, 0);
  assert.match(result.problems.join(' '), /no postings came back/);
});

test('testSource names the fields a mapping left empty', async () => {
  const stub = stubHttp(() => ({
    jobs: [
      { title: 'A', url: 'https://x.test/1', employer: 'Acme' },
      { title: 'B', url: 'https://x.test/2', employer: 'Acme' },
    ],
  }));
  const source = defineSource({
    id: 's', adapter: 'json', company: '',
    options: { url: 'https://x.test/api', listPath: 'jobs' },
    fieldMap: { title: 'title', url: 'url', company: 'company_name' },
  });

  const result = await testSource(source, { http: stub.client });

  assert.equal(result.ok, true);
  assert.equal(result.samples.length, 2);
  // Every sample missing the same field is a mapping bug, not a quiet employer.
  assert.ok(result.missingFields.includes('company'), result.missingFields.join(','));
});

test('testSource surfaces the reason a source could not be reached', async () => {
  const source = defineSource({
    id: 's', adapter: 'json',
    options: { url: 'https://x.test/api', listPath: 'jobs' },
    fieldMap: { title: 'title', url: 'url' },
  });

  const result = await testSource(source, {
    http: {
      async json() { throw new Error('getaddrinfo ENOTFOUND x.test'); },
      async text() { return ''; },
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.problems.join(' '), /ENOTFOUND/);
});

test('testSource rejects an adapter this device cannot run', async () => {
  const source = defineSource({ id: 's', adapter: 'command', options: { url: 'x' } });
  const result = await testSource(source, {
    http: { async json() { return {}; }, async text() { return ''; } },
  });

  assert.equal(result.ok, false);
  assert.match(result.problems[0]!, /No adapter named "command"/);
});
