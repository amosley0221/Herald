import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Llm } from '../dist/index.js';

/**
 * What actually goes over the wire.
 *
 * `temperature: 0` looked harmless and was rejected outright by the model —
 * `400 \`temperature\` is deprecated for this model` — which only showed up
 * against the real API, after a release. The client takes an injected fetch, so
 * the request can be captured and checked here instead.
 */

interface Captured {
  url: string;
  body: Record<string, unknown>;
}

/** A fetch that records the request and answers with a plausible reply. */
function capturing(captured: Captured[], reply: string): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({
        id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5',
        content: [{ type: 'text', text: reply }],
        stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
}

const preferences = {
  roles: ['Designer'], locations: [], remote: true, minSalary: null, threshold: 85,
  instant: true, digest: true, digestHour: 7, tailorLetter: true, dailySubmitCap: 15,
  timezone: 'UTC', seniority: [], excludeKeywords: [],
};

const posting = {
  externalId: '1', title: 'Senior Product Designer', company: 'Acme', location: 'Remote',
  remote: true, pay: null, payMin: null, payMax: null, payCurrency: null,
  url: 'https://acme.example/1', applyUrl: 'https://acme.example/1/apply',
  postedAt: new Date().toISOString(), description: 'Design things.', raw: null,
};

const SAMPLING = ['temperature', 'top_p', 'top_k'];

test('scoring sends no sampling parameters', async () => {
  const captured: Captured[] = [];
  const llm = new Llm('sk-ant-test', undefined, capturing(captured, '{"score":90,"why":["a"],"gaps":[]}'));

  await llm.score(posting, 'Ada Lovelace, designer.', preferences);

  assert.equal(captured.length, 1);
  for (const parameter of SAMPLING) {
    assert.ok(
      !(parameter in (captured[0] as Captured).body),
      `${parameter} is rejected by current models and must not be sent`,
    );
  }
  assert.equal((captured[0] as Captured).body.model, 'claude-sonnet-5');
});

test('reading a resume sends no sampling parameters', async () => {
  const captured: Captured[] = [];
  const llm = new Llm('sk-ant-test', undefined, capturing(captured, '{"profile":{},"text":"x","warnings":[]}'));

  await llm.parseResume({
    base64: Buffer.from('Ada Lovelace', 'utf8').toString('base64'),
    mimeType: 'text/plain',
    name: 'resume.txt',
  });

  for (const parameter of SAMPLING) {
    assert.ok(!(parameter in (captured[0] as Captured).body), `${parameter} must not be sent`);
  }
});

test('a cover letter sends no sampling parameters', async () => {
  const captured: Captured[] = [];
  const llm = new Llm('sk-ant-test', undefined, capturing(captured, 'Dear team,'));

  await llm.coverLetter(posting, {
    fullName: 'Ada Lovelace', email: null, phone: null, location: null, portfolio: null,
    linkedin: null, summary: null, skills: [], titles: [], years: null,
    workAuthorization: null, availability: null, resumeFileName: null, resumeUpdatedAt: null,
  }, 'Leads with design systems, which this role asks for.');

  for (const parameter of SAMPLING) {
    assert.ok(!(parameter in (captured[0] as Captured).body), `${parameter} must not be sent`);
  }
});

test('a PDF resume is sent as a document, not as decoded text', async () => {
  const captured: Captured[] = [];
  const llm = new Llm('sk-ant-test', undefined, capturing(captured, '{"profile":{},"text":"x"}'));

  const pdf = Buffer.from('%PDF-1.4 fake', 'utf8').toString('base64');
  await llm.parseResume({ base64: pdf, mimeType: 'application/pdf', name: 'resume.pdf' });

  const content = ((captured[0] as Captured).body.messages as Array<{ content: unknown }>)[0]?.content;
  const blocks = content as Array<{ type: string }>;
  assert.equal(blocks[0]?.type, 'document', 'a PDF goes to the model as a document');
});
