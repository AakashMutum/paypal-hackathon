import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../src/app.js';
import { setDatabaseUrl } from '../src/config/env.js';
import { resetAgentPorts, setCustomSignalsClients } from '../src/services/agent/agentPorts.js';
import { closeDatabase } from '../src/database/connection.js';

const originalEnv = { ...process.env };
let app: Application;

const goodCert = {
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  issuer: 'Test CA',
  daysToExpiry: 200,
  authorized: true,
};

const challengeHtml = `<!doctype html><html><head><title>Amazon.in</title></head><body>
  <h4>Click the button below to continue shopping</h4>
  <button>Continue shopping</button>
  <p>Conditions of Use &amp; Sale</p>
</body></html>`;

const productHtml = `<!doctype html><html><head><title>Echo Dot</title>
  <meta property="og:site_name" content="Amazon.com">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Echo Dot (4th Gen)",
    "brand": { "@type": "Brand", "name": "Amazon" },
    "offers": {
      "@type": "Offer",
      "price": "49.99",
      "priceCurrency": "USD",
      "availability": "https://schema.org/InStock"
    }
  }
  </script></head><body><h1>Echo Dot (4th Gen)</h1><p>In stock.</p></body></html>`;

const lookalikeHtml = `<!doctype html><html><head><title>Amazon</title>
  <meta property="og:site_name" content="Amazon">
  <meta property="og:title" content="Echo Dot">
  <meta property="product:price:amount" content="49.99">
  <meta property="product:price:currency" content="USD">
  </head><body><p>Great deal on Echo Dot.</p></body></html>`;

const emptyHtml = '<!doctype html><html><head><title></title></head><body></body></html>';

function rdapBody(): string {
  const registered = new Date(Date.now() - 4000 * 86400000).toISOString();
  return JSON.stringify({ events: [{ eventAction: 'registration', eventDate: registered }] });
}

function fakeFetch(input: string | URL, _init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === 'https://data.iana.org/rdap/dns.json') {
    // Force the known registry fallback used for .com and .in.
    return Promise.resolve(new Response('not found', { status: 404 }));
  }
  if (
    url.startsWith('https://rdap.org/domain/') ||
    url.startsWith('https://rdap.verisign.com/') ||
    url.startsWith('https://rdap.nixiregistry.in/')
  ) {
    return Promise.resolve(
      new Response(rdapBody(), { status: 200, headers: { 'content-type': 'application/rdap+json' } }),
    );
  }
  if (url === 'https://www.amazon.in/dp/B08N5WRWNW') {
    return Promise.resolve(new Response(challengeHtml, { status: 200, headers: { 'content-type': 'text/html' } }));
  }
  if (url === 'https://www.amazon.com/dp/B08N5WRWNW') {
    return Promise.resolve(new Response(productHtml, { status: 200, headers: { 'content-type': 'text/html' } }));
  }
  if (url === 'https://www.amazon.in/dp/EMPTY') {
    return Promise.resolve(new Response(emptyHtml, { status: 200, headers: { 'content-type': 'text/html' } }));
  }
  if (url === 'https://www.amazon.in/dp/LIMITED') {
    return Promise.resolve(new Response('rate limited', { status: 429 }));
  }
  if (url === 'https://amaz0n-example.com/dp/X') {
    return Promise.resolve(new Response(lookalikeHtml, { status: 200, headers: { 'content-type': 'text/html' } }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

before(() => {
  setDatabaseUrl('');
  app = createApp();
});

after(async () => {
  await closeDatabase();
});

beforeEach(() => {
  // Tests must never call a real LLM; the Gemini provider is exercised in its own tests.
  process.env = { ...originalEnv, SIGNALS_MODE: 'live', LLM_MODE: 'none' };
  delete process.env.KERNEL_API_KEY;
  delete process.env.CHANNEL3_API_KEY;
  resetAgentPorts();
  setCustomSignalsClients({
    fetchImpl: fakeFetch as typeof fetch,
    lookupImpl: async () => ['93.184.216.34'],
    tlsProbe: async () => goodCert,
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
  resetAgentPorts();
});

test('Amazon India with a bot-check page is recognised and explained, not marked fraudulent', async () => {
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://www.amazon.in/dp/B08N5WRWNW' })
    .expect(200);

  assert.equal(res.body.domain, 'www.amazon.in');
  assert.equal(res.body.claimedBrand, 'Amazon');
  assert.equal(res.body.verdict, 'WARN');
  assert.ok(res.body.riskScore < 75, `risk score was ${res.body.riskScore}`);
  assert.ok(res.body.confidence <= 60, `confidence was ${res.body.confidence}`);
  assert.equal(res.body.payeeMismatch, false);
  assert.deepEqual(res.body.hardRules, []);
  assert.equal(res.body.evidence.length, 4);
  assert.equal(res.body.domainAgeDays, 4000);
  assert.equal(res.body.registryRecords, null);
  assert.equal(res.body.payeeName, null);
  assert.equal(res.body.signalAvailability.page, 'blocked');
  assert.equal(res.body.signalAvailability.domainAge, 'known');
  assert.equal(res.body.signalAvailability.payee, 'not_provided');
  assert.equal(res.body.signalAvailability.registrarReputation, 'not_assessed');
  assert.deepEqual(
    res.body.evidence.map((e: { node: string }) => e.node),
    ['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'],
  );
  assert.notEqual(res.body.evidence[0].badge, 'NO DATA');
  assert.ok(
    res.body.evidence[0].fields.some(
      (f: { label: string; value: string }) => f.label === 'Page Blocked' && /bot-check/.test(f.value),
    ),
  );
  assert.ok(
    res.body.evidence[1].fields.some(
      (f: { label: string; value: string }) => f.label === 'Merchant Recognized' && /amazon\.in/.test(f.value),
    ),
  );
  assert.match(res.body.reasons[0], /bot-check|could not be read/);
  assert.ok(res.body.reasons.every((reason: string) => !/consistent/.test(reason)));
  assert.equal(res.body.provenance.signals, 'live');
});

test('Amazon US with structured product metadata exposes the product fields', async () => {
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://www.amazon.com/dp/B08N5WRWNW' })
    .expect(200);

  assert.equal(res.body.domain, 'www.amazon.com');
  assert.equal(res.body.claimedBrand, 'Amazon');
  assert.equal(res.body.productName, 'Echo Dot (4th Gen)');
  assert.equal(res.body.domainAgeDays, 4000);
  assert.equal(res.body.registryRecords, null);
  assert.equal(res.body.payeeName, null);
  assert.equal(res.body.signalAvailability.domainAge, 'known');
  assert.equal(res.body.signalAvailability.payee, 'not_provided');
  assert.ok(res.body.confidence <= 80);
  assert.ok(res.body.reasons.some((reason: string) => /merchant-level scan/.test(reason)));
  assert.notEqual(res.body.verdict, 'PAUSE');
  assert.ok(res.body.riskScore < 75);

  const priceCard = res.body.evidence.find((e: { node: string }) => e.node === 'PRICE');
  assert.ok(priceCard.fields.some((f: { label: string }) => f.label === 'Product Metadata'));
  const product = priceCard.fields.find((f: { label: string }) => f.label === 'Product Metadata');
  assert.match(product.value, /Echo Dot \(4th Gen\)/);
  assert.match(product.value, /USD 49\.99/);
  assert.ok(priceCard.fields.some((f: { label: string }) => f.label === 'Price Unknown'));
});

test('a readable page with no grounding evidence does not claim consistency', async () => {
  setCustomSignalsClients({
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('https://data.iana.org/') || url.startsWith('https://rdap.')) {
        return new Response('not found', { status: 404 });
      }
      return fakeFetch(input as string | URL, init);
    }) as typeof fetch,
  });

  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://www.amazon.com/dp/B08N5WRWNW' })
    .expect(200);

  assert.equal(res.body.verdict, 'WARN');
  assert.equal(res.body.domainAgeDays, null);
  assert.equal(res.body.registryRecords, null);
  assert.equal(res.body.signalAvailability.domainAge, 'unavailable');
  assert.match(res.body.reasons[0], /Not enough evidence/);
  assert.ok(res.body.reasons.every((reason: string) => !/consistent/.test(reason)));
  assert.ok(res.body.confidence <= 60, `confidence was ${res.body.confidence}`);
  assert.equal(res.body.productName, 'Echo Dot (4th Gen)');
});

test('a lookalike domain claiming Amazon is still flagged', async () => {
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://amaz0n-example.com/dp/X' })
    .expect(200);

  // The deterministic engine scores a lone lookalike at 30 (ALLOW band); HF2 needs a payee
  // binding. The point here is that the lookalike is still flagged, not recognised as official.
  assert.ok(res.body.riskScore >= 30, `risk score was ${res.body.riskScore}`);
  assert.notEqual(res.body.verdict, 'PAUSE');
  assert.deepEqual(res.body.hardRules, []);
  assert.ok(
    res.body.evidence[0].fields.some(
      (f: { label: string; value: string }) => f.label === 'Lookalike Domain',
    ),
  );
});

test('HTTP 429 is reported as rate limited and empty HTML as empty', async () => {
  const limited = await request(app)
    .post('/api/scan')
    .send({ url: 'https://www.amazon.in/dp/LIMITED' })
    .expect(200);
  assert.equal(limited.body.verdict, 'WARN');
  assert.ok(
    limited.body.evidence[0].fields.some(
      (f: { label: string; value: string }) => f.label === 'Page Blocked' && /rate-limited/.test(f.value),
    ),
  );

  const empty = await request(app)
    .post('/api/scan')
    .send({ url: 'https://www.amazon.in/dp/EMPTY' })
    .expect(200);
  assert.equal(empty.body.verdict, 'WARN');
  assert.ok(
    empty.body.evidence[0].fields.some(
      (f: { label: string; value: string }) => f.label === 'Page Empty' && /no readable content/.test(f.value),
    ),
  );
});

test('invalid and unsupported URLs are rejected with an explicit reason', async () => {
  for (const url of ['not a url', 'ftp://www.amazon.in/dp/X', 'javascript:alert(1)', 'localhost']) {
    const res = await request(app).post('/api/scan').send({ url }).expect(400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'INVALID_URL');
    assert.match(res.body.error.message, /valid website address/);
  }
});

test('replay mode recognises the brand and says that no recording exists', async () => {
  process.env.SIGNALS_MODE = 'replay';
  resetAgentPorts();

  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://www.amazon.in/dp/B08N5WRWNW' })
    .expect(200);

  assert.equal(res.body.verdict, 'WARN');
  assert.ok(res.body.confidence <= 60);
  assert.equal(res.body.domainAgeDays, null);
  assert.equal(res.body.registryRecords, null);
  assert.equal(res.body.provenance.signalsMode, 'replay');
  assert.equal(res.body.provenance.signals, 'replay');
  assert.ok(
    res.body.evidence[0].fields.some(
      (f: { label: string; value: string }) =>
        f.label === 'Page Unavailable' && /replaying recorded signals/.test(f.value),
    ),
  );
  assert.ok(
    res.body.evidence[1].fields.some(
      (f: { label: string; value: string }) => f.label === 'Merchant Recognized',
    ),
  );
  assert.ok(res.body.reasons.every((reason: string) => !/consistent/.test(reason)));
  assert.notEqual(res.body.evidence[0].badge, 'NO DATA');
});
