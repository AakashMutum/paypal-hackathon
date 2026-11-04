import assert from 'node:assert/strict';
import test from 'node:test';
import { Channel3ApiClient } from '../src/agentPort/channel3Client.js';

const KEY = 'c3-secret-key-123';
const opts = { timeoutMs: 5000 };

const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const offer = (price: number, currency = 'USD', domain = 'store.example') => ({
  url: `https://${domain}/p`,
  domain,
  price: { price, compare_at_price: null, currency },
  availability: 'InStock',
});

test('computes offer statistics from the documented response shape', async () => {
  const client = new Channel3ApiClient(
    KEY,
    json({
      products: [{ title: 'Jacket', offers: [offer(100, 'USD', 'a.example'), offer(200, 'USD', 'b.example'), offer(300, 'USD', 'c.example')] }],
      next_page_token: null,
    }),
  );
  const result = await client.searchOffers({ productQuery: 'jacket', currency: 'USD' }, opts);
  assert.equal(result.offerCount, 3);
  assert.equal(result.medianPrice, 200);
  assert.equal(result.minPrice, 100);
  assert.equal(result.currency, 'USD');
  assert.deepEqual(result.sampleDomains, ['a.example', 'b.example', 'c.example']);
  assert.equal(result.source, 'channel3');
  assert.equal(result.provider, 'channel3');
  assert.equal(result.history, 'unavailable');
  assert.match(result.fetchedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('normalizes currency and supports a configured endpoint', async () => {
  let requested = '';
  const fetchImpl = (async (url: string) => {
    requested = url;
    return new Response(JSON.stringify({ products: [{ offers: [offer(50, 'usd')] }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await new Channel3ApiClient(KEY, fetchImpl, 'https://channel3.example.test/v1/search').searchOffers(
    { productQuery: 'x', currency: 'USD' },
    opts,
  );
  assert.equal(requested, 'https://channel3.example.test/v1/search');
  assert.equal(result.offerCount, 1);
  assert.equal(result.currency, 'USD');
});

test('median of an even count is the mean of the middle two', async () => {
  const client = new Channel3ApiClient(KEY, json({ products: [{ offers: [offer(10), offer(20), offer(30), offer(40)] }] }));
  assert.equal((await client.searchOffers({ productQuery: 'x' }, opts)).medianPrice, 25);
});

test('accepts a plain numeric price and takes the domain from the url', async () => {
  const client = new Channel3ApiClient(KEY, json({ products: [{ offers: [{ price: 50, currency: 'EUR', url: 'https://shop.example/x' }] }] }));
  const result = await client.searchOffers({ productQuery: 'x' }, opts);
  assert.equal(result.minPrice, 50);
  assert.deepEqual(result.sampleDomains, ['shop.example']);
});

test('filters by currency and by maximum price', async () => {
  const body = { products: [{ offers: [offer(100, 'USD'), offer(90, 'EUR'), offer(500, 'USD')] }] };
  const byCurrency = await new Channel3ApiClient(KEY, json(body)).searchOffers({ productQuery: 'x', currency: 'EUR' }, opts);
  assert.equal(byCurrency.offerCount, 1);
  assert.equal(byCurrency.currency, 'EUR');
  const byPrice = await new Channel3ApiClient(KEY, json(body)).searchOffers({ productQuery: 'x', maxPrice: 150 }, opts);
  assert.equal(byPrice.offerCount, 2);
});

test('sends the key in x-api-key and the filters in the body', async () => {
  let request: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    request = { url, init };
    return new Response(JSON.stringify({ products: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  await new Channel3ApiClient(KEY, fetchImpl).searchOffers({ productQuery: 'jacket', maxPrice: 99 }, opts);
  assert.equal(request?.url, 'https://api.trychannel3.com/v1/search');
  assert.equal((request?.init.headers as Record<string, string>)['x-api-key'], KEY);
  assert.deepEqual(JSON.parse(String(request?.init.body)), { query: 'jacket', filters: { price: { max_price: 99 } }, limit: 20 });
});

test('empty results give a zero count', async () => {
  for (const body of [{ products: [] }, {}, { products: [{}] }, { products: [{ offers: [] }] }, null]) {
    const result = await new Channel3ApiClient(KEY, json(body)).searchOffers({ productQuery: 'x' }, opts);
    assert.equal(result.offerCount, 0);
    assert.equal(result.medianPrice, undefined);
    assert.deepEqual(result.sampleDomains, []);
  }
});

test('an empty or non-JSON response is a clear error', async () => {
  const empty = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(() => new Channel3ApiClient(KEY, empty).searchOffers({ productQuery: 'x' }, opts), /empty response/);
  const html = (async () => new Response('<html>Bad gateway</html>', { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(() => new Channel3ApiClient(KEY, html).searchOffers({ productQuery: 'x' }, opts), /not valid JSON/);
});

test('error statuses are reported by code without the body', async () => {
  for (const status of [400, 401, 403, 429, 500, 503]) {
    const fetchImpl = (async () => new Response(`denied for ${KEY}`, { status })) as unknown as typeof fetch;
    await assert.rejects(
      () => new Channel3ApiClient(KEY, fetchImpl).searchOffers({ productQuery: 'x' }, opts),
      (error: Error) => {
        assert.match(error.message, new RegExp(String(status)));
        assert.equal(error.message.includes(KEY), false);
        return true;
      },
    );
  }
});

test('the API key never appears in errors from a failing fetch', async () => {
  const failing = (async () => {
    throw new Error(`connect failed with header x-api-key: ${KEY}`);
  }) as unknown as typeof fetch;
  await assert.rejects(
    () => new Channel3ApiClient(KEY, failing).searchOffers({ productQuery: 'x' }, opts),
    (error: Error) => {
      assert.equal(error.message.includes(KEY), false);
      assert.match(error.message, /Channel3 request failed/);
      return true;
    },
  );
});

test('honours an abort signal', async () => {
  const slow = ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      if (init?.signal?.aborted) reject(new Error('aborted'));
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  const controller = new AbortController();
  const pending = new Channel3ApiClient(KEY, slow).searchOffers({ productQuery: 'x' }, { timeoutMs: 5000, signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending);
});
