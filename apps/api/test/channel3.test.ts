import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHANNEL3_PROVIDER,
  channel3Config,
  compareChannel3Prices,
  type Channel3PriceLookup,
} from '../src/services/pricing/channel3.js';

const baseUrl = 'https://api.trychannel3.com';
const env = {
  CHANNEL3_BASE_URL: baseUrl,
  CHANNEL3_API_KEY: 'unit-test-placeholder',
  CHANNEL3_TIMEOUT_MS: '1000',
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const productWithOffers = {
  id: 'ch3_af1_001',
  title: 'Nike Air Force 1',
  brands: [{ name: 'Nike' }],
  url: 'https://api.trychannel3.com/products/ch3_af1_001',
  offers: [
    { domain: 'nike.com', url: 'https://nike.com/af1', price: { price: 100, currency: 'USD', compare_at_price: 120 }, availability: 'InStock', condition: 'new', variants: { selected: [{ name: 'Size', value: '10' }] } },
    { domain: 'footlocker.com', url: 'https://footlocker.com/af1', price: { price: 110, currency: 'USD' }, availability: 'InStock', variants: { selected: [{ name: 'Size', value: '10' }] } },
    { domain: 'jdsports.com', url: 'https://jdsports.com/af1', price: { price: 130, currency: 'USD' }, availability: 'InStock', variants: { selected: [{ name: 'Size', value: '10' }] } },
    { domain: 'example.eu', url: 'https://example.eu/af1', price: { price: 90, currency: 'EUR' }, availability: 'InStock', variants: { selected: [{ name: 'Size', value: '10' }] } },
    { domain: 'outlet.com', url: 'https://outlet.com/af1', price: { price: 2000, currency: 'USD' }, availability: 'OutOfStock', variants: { selected: [{ name: 'Size', value: '10' }] } },
    { domain: 'bad.com', url: 'https://bad.com/af1', price: { price: 'not-a-number', currency: 'USD' }, availability: 'InStock', variants: { selected: [{ name: 'Size', value: '10' }] } },
  ],
};

const lookup = (
  input: Channel3PriceLookup,
  fetchImpl: typeof fetch,
  timeoutMs = 1000,
) => compareChannel3Prices(input, { env, fetchImpl, timeoutMs });

test('requires HTTPS api.trychannel3.com URL and server-side API key', () => {
  assert.equal(channel3Config({ CHANNEL3_BASE_URL: baseUrl }), null);
  assert.equal(channel3Config({ CHANNEL3_BASE_URL: 'http://api.trychannel3.com', CHANNEL3_API_KEY: 'k' }), null);
  assert.equal(channel3Config({ CHANNEL3_BASE_URL: 'https://other.example', CHANNEL3_API_KEY: 'k' }), null);
  assert.equal(channel3Config(env)?.timeoutMs, 1000);
  assert.equal(channel3Config(env)?.baseUrl, baseUrl);
});

test('maps live search response: provider, source, timestamps, and normalized offers', async () => {
  let capturedUrl: URL | undefined;
  let capturedHeaders: Record<string, string> | undefined;
  const result = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 120, observedCurrency: 'usd' },
    (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = new URL(String(input));
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({ products: [productWithOffers] });
    }) as typeof fetch,
  );

  assert.equal(result.status, 'PRICE_UNKNOWN'); // 9.09% deviation < 25% threshold
  assert.equal(result.provider, CHANNEL3_PROVIDER);
  assert.ok(String(result.lookedUpAt).match(/^\d{4}-\d{2}-\d{2}T/));
  assert.ok(result.product);
  assert.equal(result.product?.id, 'ch3_af1_001');
  assert.equal(result.product?.title, 'Nike Air Force 1');
  assert.equal(result.product?.brand, 'Nike');

  // Only USD InStock Size 10 offers: nike 100, footlocker 110, jdsports 130
  assert.equal(result.offers.length, 3);
  const prices = result.offers.map((o) => o.price).sort();
  assert.deepEqual(prices, [100, 110, 130]);
  for (const offer of result.offers) {
    assert.equal(offer.currency, 'USD');
    assert.equal(offer.availability, 'InStock');
    assert.ok(offer.merchant);
    assert.ok(offer.merchantUrl);
  }

  // API key sent server-side in x-api-key header, never in URL
  assert.equal(capturedUrl?.pathname, '/v1/search');
  assert.equal(capturedUrl?.searchParams.get('api-key'), null);
  assert.equal(String(capturedUrl).includes('api-key'), false);
  assert.ok(capturedHeaders, 'headers must be captured');
  assert.equal(capturedHeaders!['x-api-key'], env.CHANNEL3_API_KEY);
  assert.equal(capturedHeaders!['Content-Type'], 'application/json');

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(env.CHANNEL3_API_KEY), false, 'API key must not leak into result');
});

test('emits PRICE_DEVIATION with genuine evidence when deviation exceeds threshold', async () => {
  const result = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 200, observedCurrency: 'USD' },
    (async () => jsonResponse({ products: [productWithOffers] })) as typeof fetch,
  );

  assert.equal(result.status, 'PRICE_DEVIATION');
  assert.equal(result.provider, CHANNEL3_PROVIDER);
  assert.ok(result.deviation, 'deviation evidence must be present');
  const d = result.deviation!;
  assert.equal(d.observedPrice, 200);
  assert.equal(d.observedCurrency, 'USD');
  assert.equal(d.marketLow, 100);
  assert.equal(d.marketHigh, 130);
  assert.equal(d.marketMedian, 110);
  assert.equal(d.direction, 'above');
  assert.equal(d.comparableOfferCount, 3);
  assert.ok(d.deviationPct >= 25);
  assert.ok(String(result.lookedUpAt).match(/^\d{4}-\d{2}-\d{2}T/));
});

test('currency normalization: only comparable same-currency offers counted', async () => {
  const result = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 120, observedCurrency: 'USD' },
    (async () => jsonResponse({ products: [productWithOffers] })) as typeof fetch,
  );
  assert.equal(result.offers.length, 3); // EUR and OutOfStock and bad price excluded
  assert.equal(result.status, 'PRICE_UNKNOWN');
});

test('invalid observed currency returns PRICE_UNKNOWN without provider call', async () => {
  let called = false;
  const result = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 120, observedCurrency: 'NOTACURRENCY' },
    (async () => { called = true; return jsonResponse({ products: [productWithOffers] }); }) as typeof fetch,
  );
  assert.equal(called, false);
  assert.equal(result.status, 'PRICE_UNKNOWN');
  assert.equal(result.offers.length, 0);
});

test('variant safety: only matching variants compared', async () => {
  const result = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 120, observedCurrency: 'USD', variant: { name: 'Size', value: '10' } },
    (async () => jsonResponse({ products: [productWithOffers] })) as typeof fetch,
  );
  assert.equal(result.offers.length, 3);

  const mismatched = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 120, observedCurrency: 'USD', variant: { name: 'Size', value: '9' } },
    (async () => jsonResponse({ products: [productWithOffers] })) as typeof fetch,
  );
  assert.equal(mismatched.offers.length, 0); // no Size 9 offers
  assert.equal(mismatched.status, 'PRICE_UNKNOWN');
});

test('returns PRICE_UNKNOWN when no products or no comparable offers', async () => {
  const empty = await lookup(
    { productName: 'Nothing', observedPrice: 10, observedCurrency: 'USD' },
    (async () => jsonResponse({ products: [] })) as typeof fetch,
  );
  assert.equal(empty.status, 'PRICE_UNKNOWN');
  assert.deepEqual(empty.offers, []);

  const noOffers = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 10, observedCurrency: 'USD' },
    (async () => jsonResponse({ products: [{ id: 'x', title: 'y', offers: [] }] })) as typeof fetch,
  );
  assert.equal(noOffers.status, 'PRICE_UNKNOWN');
  assert.deepEqual(noOffers.offers, []);
});

test('returns PRICE_UNKNOWN for malformed response and invalid JSON without crashing', async () => {
  const invalidJson = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 10, observedCurrency: 'USD' },
    (async () => new Response('not json')) as typeof fetch,
  );
  assert.equal(invalidJson.status, 'PRICE_UNKNOWN');
  assert.deepEqual(invalidJson.offers, []);
  assert.match(invalidJson.error ?? '', /invalid JSON/);

  const badSchema = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 10, observedCurrency: 'USD' },
    (async () => jsonResponse({ not_products: [] })) as typeof fetch,
  );
  assert.equal(badSchema.status, 'PRICE_UNKNOWN');
  assert.match(badSchema.error ?? '', /products schema/);

  const serialized = JSON.stringify(badSchema);
  assert.equal(serialized.includes(env.CHANNEL3_API_KEY), false);
});

test('returns PRICE_UNKNOWN for HTTP errors and timeouts without leaking key', async () => {
  const httpError = await lookup(
    { productName: 'Nike Air Force 1', observedPrice: 10, observedCurrency: 'USD' },
    (async () => new Response('unavailable', { status: 503 })) as typeof fetch,
  );
  assert.equal(httpError.status, 'PRICE_UNKNOWN');
  assert.equal(httpError.error, 'Channel3 returned HTTP 503');
  assert.equal(httpError.error?.includes(env.CHANNEL3_API_KEY), false);

  const controller = new AbortController();
  controller.abort();
  const timeout = await compareChannel3Prices(
    { productName: 'Nike Air Force 1', observedPrice: 10, observedCurrency: 'USD' },
    {
      env,
      timeoutMs: 1000,
      signal: controller.signal,
      fetchImpl: (async (_input, init) => {
        if (init?.signal?.aborted) throw new DOMException('aborted');
        return new Response('never');
      }) as typeof fetch,
    },
  );
  assert.equal(timeout.status, 'PRICE_UNKNOWN');
  assert.match(timeout.error ?? '', /timed out or was cancelled/);
  assert.equal(timeout.error?.includes(env.CHANNEL3_API_KEY), false);
});
