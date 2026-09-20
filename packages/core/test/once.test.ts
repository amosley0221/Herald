import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from '../dist/index.js';

test('concurrent callers share one run', async () => {
  let runs = 0;
  const open = once(async () => {
    runs++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { id: runs };
  });

  // The shape that broke it: several screens asking at once on first paint.
  const handles = await Promise.all([open(), open(), open(), open()]);

  assert.equal(runs, 1);
  for (const handle of handles) assert.equal(handle, handles[0]);
});

test('later callers reuse the finished result', async () => {
  let runs = 0;
  const open = once(async () => { runs++; return runs; });

  assert.equal(await open(), 1);
  assert.equal(await open(), 1);
  assert.equal(runs, 1);
});

test('a failure is not cached, so the next caller may try again', async () => {
  let attempts = 0;
  const open = once(async () => {
    attempts++;
    if (attempts === 1) throw new Error('disk busy');
    return 'opened';
  });

  await assert.rejects(open(), /disk busy/);
  // A poisoned singleton would leave the app permanently broken over one
  // transient failure, which is worse than the failure.
  assert.equal(await open(), 'opened');
  assert.equal(attempts, 2);
});

test('concurrent callers all see the same failure', async () => {
  let attempts = 0;
  const open = once(async () => {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw new Error('nope');
  });

  const results = await Promise.allSettled([open(), open(), open()]);

  assert.equal(attempts, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 3);
});
