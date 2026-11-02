import assert from 'node:assert/strict';
import test from 'node:test';
import { ElasticPatternStore, hashPayee, patternIndexMapping } from '../src/index.js';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const doc = {
  registrableDomain: 'quickdeal-outlet.example',
  payeeMerchantId: 'MERCH-QD-1',
  decision: 'PAUSE',
  riskScore: 0.9,
  evidenceTypes: ['DOMAIN_AGE'],
  domainAgeBucket: '<7d',
  discountBucket: '>=80',
  patternText: 'A newly registered lookalike store sells far below market price and pays an unrelated business.',
};

interface Recorded {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

function fakeElastic(responses: Array<(rec: Recorded) => Response>) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const rec: Recorded = {
      method: init?.method ?? 'GET',
      url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
    };
    calls.push(rec);
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return next(rec);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (body: unknown = {}) => () => new Response(JSON.stringify(body), { status: 200 });

test('upsert sends an anonymous scripted update', async () => {
  const { calls, fetchImpl } = fakeElastic([ok({ result: 'updated' })]);
  const store = new ElasticPatternStore({ url: 'https://es.example/', apiKey: 'secret', fetchImpl, now: () => NOW });
  const saved = await store.upsert(doc);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /^https:\/\/es\.example\/guardian-scam-memory\/_update\//);
  const text = JSON.stringify(calls[0].body);
  assert.equal(text.includes('MERCH-QD-1'), false);
  assert.ok(text.includes(hashPayee('MERCH-QD-1')));
  assert.equal(saved.payeeHash, hashPayee('MERCH-QD-1'));
});

test('upsert refuses personal data before any request', async () => {
  const { calls, fetchImpl } = fakeElastic([ok()]);
  const store = new ElasticPatternStore({ url: 'https://es.example', apiKey: 'k', fetchImpl });
  await assert.rejects(() => store.upsert({ ...doc, patternText: 'Contact the seller at pat@mail.example about this store.' }));
  assert.equal(calls.length, 0);
});

test('search runs an exact query and a semantic query, filters expired patterns and applies decay', async () => {
  const fresh = new Date(NOW - 60 * 86400000).toISOString();
  const expired = new Date(NOW - 400 * 86400000).toISOString();
  const exactBody = {
    hits: {
      hits: [
        { _id: 'a', _source: { ...doc, payeeMerchantId: undefined, payeeHash: hashPayee('MERCH-QD-1'), timestamp: fresh, seed: false } },
        { _id: 'old', _source: { ...doc, timestamp: expired, seed: false } },
      ],
    },
  };
  const semanticBody = { hits: { hits: [{ _id: 'seed1', _source: { ...doc, timestamp: '2026-01-01T00:00:00.000Z', seed: true } }] } };
  const { calls, fetchImpl } = fakeElastic([
    (rec) =>
      new Response(JSON.stringify(JSON.stringify(rec.body).includes('"semantic"') ? semanticBody : exactBody), {
        status: 200,
      }),
  ]);
  const store = new ElasticPatternStore({ url: 'https://es.example', apiKey: 'k', fetchImpl, now: () => NOW, halfLifeDays: 60 });
  const hits = await store.search({
    patternText: 'lookalike store far below market',
    registrableDomain: 'quickdeal-outlet.example',
    payeeHash: hashPayee('MERCH-QD-1'),
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => JSON.stringify(c.body).includes('"range"')), 'queries filter by age');
  assert.deepEqual(hits.map((h) => h.id), ['a', 'seed1']);
  assert.equal(hits[0].matchType, 'exact_payee');
  assert.ok(Math.abs(hits[0].score - 0.5) < 0.01);
  assert.equal(hits[1].score, 1);
});

test('search falls back to a keyword query when semantic search fails', async () => {
  const { calls, fetchImpl } = fakeElastic([
    (rec) =>
      JSON.stringify(rec.body).includes('"semantic"')
        ? new Response('bad', { status: 400 })
        : new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 }),
  ]);
  const store = new ElasticPatternStore({ url: 'https://es.example', apiKey: 'k', fetchImpl, now: () => NOW });
  assert.deepEqual(await store.search({ patternText: 'some pattern text', registrableDomain: 'a.example' }), []);
  assert.ok(calls.some((c) => JSON.stringify(c.body).includes('"match"')));
});

test('ensureIndex creates the index only when it is missing', async () => {
  const missing = fakeElastic([(rec) => (rec.method === 'HEAD' ? new Response(null, { status: 404 }) : new Response('{}', { status: 200 }))]);
  const store = new ElasticPatternStore({ url: 'https://es.example', apiKey: 'k', fetchImpl: missing.fetchImpl, inferenceId: 'my-endpoint' });
  assert.equal(await store.ensureIndex(), true);
  assert.equal(missing.calls[1].method, 'PUT');
  assert.deepEqual(missing.calls[1].body, { mappings: patternIndexMapping('my-endpoint') });

  const present = fakeElastic([() => new Response(null, { status: 200 })]);
  const store2 = new ElasticPatternStore({ url: 'https://es.example', apiKey: 'k', fetchImpl: present.fetchImpl });
  assert.equal(await store2.ensureIndex(), false);
  assert.equal(present.calls.length, 1);
});

const live = process.env.ELASTIC_URL && process.env.ELASTIC_API_KEY;

test('live Elastic round trip', { skip: live ? false : 'ELASTIC_URL and ELASTIC_API_KEY are not set' }, async () => {
  const store = new ElasticPatternStore({
    url: process.env.ELASTIC_URL as string,
    apiKey: process.env.ELASTIC_API_KEY as string,
    index: `guardian-scam-memory-test-${Date.now()}`,
  });
  await store.ensureIndex();
  await store.upsert({ ...doc, registrableDomain: `live-${Date.now()}.example` });
  assert.ok((await store.size()) >= 1);
});
