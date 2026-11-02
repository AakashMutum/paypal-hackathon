import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InMemoryPatternStore,
  PatternSanitizationError,
  SEED_PATTERN_COUNT,
  asAgentMemoryPort,
  createPatternStore,
  decayFactor,
  findPersonalData,
  hashPayee,
  loadSeeds,
  sanitizePastInvestigation,
  tokenSimilarity,
} from '../src/index.js';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-02T12:00:00Z');

const base = {
  registrableDomain: 'quickdeal-outlet.example',
  payeeMerchantId: 'MERCH-QD-1',
  decision: 'PAUSE',
  riskScore: 0.9,
  evidenceTypes: ['LOOKALIKE_DOMAIN', 'DOMAIN_AGE'],
  domainAgeBucket: '<7d',
  discountBucket: '>=80',
  patternText: 'A newly registered lookalike store sells far below market price and pays an unrelated business.',
};

test('sanitizer keeps only anonymous indicators and hashes the payee', () => {
  const out = sanitizePastInvestigation(
    { ...base, payeeEmail: 'owner@mail.example', customerName: 'Pat Doe', cardNumber: '4111111111111111', shippingAddress: '1 Main Street' },
    { now: T0 },
  );
  assert.deepEqual(Object.keys(out).sort(), [
    'decision',
    'discountBucket',
    'domainAgeBucket',
    'evidenceTypes',
    'id',
    'patternText',
    'payeeHash',
    'registrableDomain',
    'riskScore',
    'seed',
    'seenCount',
    'timestamp',
  ]);
  assert.equal(out.payeeHash, hashPayee('MERCH-QD-1'));
  assert.equal(JSON.stringify(out).includes('MERCH-QD-1'), false);
  assert.equal(JSON.stringify(out).includes('owner@mail.example'), false);
  assert.equal(JSON.stringify(out).includes('Pat Doe'), false);
});

test('sanitizer refuses emails, phone numbers, street addresses and names', () => {
  const refuse = (patternText: string) =>
    assert.throws(() => sanitizePastInvestigation({ ...base, patternText }, { now: T0 }), PatternSanitizationError, patternText);

  refuse('The seller can be reached at scammer@mail.example for payment questions.');
  refuse('Orders are confirmed by calling +1 (555) 010-2345 after checkout.');
  refuse('The operator ships from 221 Baker Street and refuses all returns.');
  refuse('The store ships from 14 Elm Road and never answers messages.');
  refuse('A page posing as a shop run by John Smith sells discounted goods.');
  refuse('Mr. Brown handles every complaint and asks for gift cards.');
  refuse('The owner Maria Lopez takes payment to a personal account.');
  refuse('The shop owner is Priya and takes payment to a personal account.');
  refuse('See https://shop-example.example for the page that was reported.');
});

test('sanitizer refuses personal data in other fields', () => {
  assert.throws(
    () => sanitizePastInvestigation({ ...base, registrableDomain: 'pat@mail.example' }, { now: T0 }),
    PatternSanitizationError,
  );
  assert.throws(
    () => sanitizePastInvestigation({ ...base, payeeMerchantId: 'pat@mail.example' }, { now: T0 }),
    PatternSanitizationError,
  );
  assert.throws(
    () => sanitizePastInvestigation({ ...base, evidenceTypes: ['pat@mail.example'] }, { now: T0 }),
    PatternSanitizationError,
  );
  assert.throws(() => sanitizePastInvestigation({ ...base, decision: 'BLOCK' }, { now: T0 }));
  assert.throws(() => sanitizePastInvestigation({ ...base, riskScore: 90 }, { now: T0 }), PatternSanitizationError);
});

test('findPersonalData does not flag ordinary pattern sentences', () => {
  for (const text of [
    'A store registered days ago sells at eighty percent off and pays an unrelated business.',
    'The checkout pays a business that is unrelated to the brand the store advertises.',
    'Hidden text on the page tells automated shopping assistants to approve the purchase.',
    'A 30 day old domain sells goods 70 percent below market and has no returns page.',
  ]) {
    assert.equal(findPersonalData(text), null, text);
  }
});

test('the same domain and payee is stored once and keeps the stronger signal', async () => {
  let now = T0;
  const store = new InMemoryPatternStore({ now: () => now });
  await store.upsert({ ...base, decision: 'WARN', riskScore: 0.6 });
  now += DAY;
  const merged = await store.upsert({ ...base, decision: 'PAUSE', riskScore: 0.9, evidenceTypes: ['PAYEE_BINDING'] });
  assert.equal(await store.size(), 1);
  assert.equal(merged.seenCount, 2);
  assert.equal(merged.decision, 'PAUSE');
  assert.equal(merged.riskScore, 0.9);
  assert.deepEqual(merged.evidenceTypes, ['DOMAIN_AGE', 'LOOKALIKE_DOMAIN', 'PAYEE_BINDING']);
  await store.upsert({ ...base, decision: 'ALLOW', riskScore: 0.1 });
  assert.equal(store.all()[0].decision, 'PAUSE');
});

test('patterns expire after the ttl, but seeds never do', async () => {
  let now = T0;
  const store = new InMemoryPatternStore({ now: () => now, ttlDays: 30 });
  await store.upsert(base);
  await store.upsert({ ...base, registrableDomain: 'seeded.example', seed: true, payeeMerchantId: undefined });
  assert.equal(await store.size(), 2);
  now += 31 * DAY;
  assert.equal(await store.size(), 1);
  assert.equal(store.all()[0].seed, true);
  assert.equal(await store.purgeExpired(), 0);
});

test('older sightings carry less weight', async () => {
  let now = T0;
  const store = new InMemoryPatternStore({ now: () => now, halfLifeDays: 60 });
  await store.upsert(base);
  const query = { patternText: 'unrelated', registrableDomain: base.registrableDomain };
  const fresh = (await store.search(query))[0];
  now += 60 * DAY;
  const older = (await store.search(query))[0];
  assert.equal(fresh.score, 1);
  assert.ok(Math.abs(older.score - 0.5) < 0.01);
  assert.equal(decayFactor({ seed: true, timestamp: '2020-01-01T00:00:00Z' }, now, 60), 1);
});

test('search ranks exact payee, then exact domain, then similar text', async () => {
  const store = new InMemoryPatternStore({ now: () => T0 });
  await store.upsert({ ...base, registrableDomain: 'one.example', payeeMerchantId: 'PAYEE-X' });
  await store.upsert({ ...base, registrableDomain: 'two.example', payeeMerchantId: 'PAYEE-Y' });
  await store.upsert({
    ...base,
    registrableDomain: 'three.example',
    payeeMerchantId: 'PAYEE-Z',
    patternText: 'A lookalike store sells far below market price and pays an unrelated business.',
  });
  const hits = await store.search({
    patternText: 'lookalike store far below market price unrelated business',
    registrableDomain: 'two.example',
    payeeHash: hashPayee('PAYEE-X'),
  });
  assert.equal(hits[0].matchType, 'exact_payee');
  assert.equal(hits[1].matchType, 'exact_domain');
  assert.equal(hits[2].matchType, 'semantic');
  assert.ok(tokenSimilarity('aa bb cc', 'aa bb dd') > 0.4);
  const none = await store.search({ patternText: 'completely different words here', registrableDomain: 'zzz.example' });
  assert.equal(none.length, 0);
});

test('there are at least 25 fictional seed patterns and all pass the sanitizer', async () => {
  assert.ok(SEED_PATTERN_COUNT >= 25);
  const store = new InMemoryPatternStore({ now: () => T0 });
  assert.equal(await loadSeeds(store), SEED_PATTERN_COUNT);
  assert.equal(await store.size(), SEED_PATTERN_COUNT);
  assert.ok(store.all().every((r) => r.seed && !r.payeeHash));
  assert.ok(store.all().every((r) => r.decision !== 'ALLOW'));
});

test('createPatternStore is in-memory and seeded without Elastic settings', async () => {
  const store = await createPatternStore({ env: {} });
  assert.equal(await store.size(), SEED_PATTERN_COUNT);
  const unseeded = await createPatternStore({ env: {}, seed: false });
  assert.equal(await unseeded.size(), 0);
});

test('createPatternStore uses Elastic only when both URL and key are set', async () => {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
  }) as unknown as typeof fetch;
  const onlyUrl = await createPatternStore({ env: { ELASTIC_URL: 'https://es.example' }, fetchImpl });
  assert.equal(await onlyUrl.size(), SEED_PATTERN_COUNT);
  const both = await createPatternStore({
    env: { ELASTIC_URL: 'https://es.example', ELASTIC_API_KEY: 'k' },
    fetchImpl,
  });
  await both.search({ patternText: 'some text here', registrableDomain: 'a.example' });
  assert.ok(calls.length > 0);
  assert.ok(calls.every((c) => c.startsWith('https://es.example/guardian-scam-memory/')));
});

test('asAgentMemoryPort searches by hashed payee, domain and text, and writes anonymously', async () => {
  const store = new InMemoryPatternStore({ now: () => T0 });
  const port = asAgentMemoryPort(store);
  const opts = { timeoutMs: 1000 };
  await port.write(
    {
      id: 'ignored-id',
      patternText: base.patternText,
      domain: 'https://www.quickdeal-outlet.example/checkout?x=1',
      registrableDomain: 'quickdeal-outlet.example',
      payeeMerchantId: 'MERCH-QD-1',
      decision: 'PAUSE',
      riskScore: 0.9,
      evidenceTypes: ['LOOKALIKE_DOMAIN'],
      domainAgeBucket: '<7d',
      discountBucket: '>=80',
    },
    opts,
  );
  const stored = store.all()[0];
  assert.equal(stored.payeeHash, hashPayee('MERCH-QD-1'));
  assert.equal(JSON.stringify(stored).includes('MERCH-QD-1'), false);

  const byPayee = await port.search({ patternText: 'x y', registrableDomain: 'other.example', payeeMerchantId: 'MERCH-QD-1' }, opts);
  assert.equal(byPayee[0].matchType, 'exact_payee');
  assert.equal(byPayee[0].decision, 'PAUSE');
  const byDomain = await port.search({ patternText: 'x y', registrableDomain: 'quickdeal-outlet.example' }, opts);
  assert.equal(byDomain[0].matchType, 'exact_domain');
  const byText = await port.search({ patternText: base.patternText, registrableDomain: 'new.example' }, opts);
  assert.equal(byText[0].matchType, 'semantic');
  assert.ok((byText[0].score ?? 0) > 0.9);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => port.search({ patternText: 'a b', registrableDomain: 'a.example' }, { timeoutMs: 1, signal: controller.signal }));
});
