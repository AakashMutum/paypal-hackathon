
import assert from 'node:assert/strict';
import test from 'node:test';
import { Channel3ApiClient } from '../src/agentPort/channel3Client.js';

test('Channel3 calculates offer statistics', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        products: [
          {
            offers: [
              {
                price: { price: 100, currency: 'USD' },
                url: 'https://store1.example/product',
              },
              {
                price: { price: 200, currency: 'USD' },
                url: 'https://store2.example/product',
              },
              {
                price: { price: 300, currency: 'USD' },
                url: 'https://store3.example/product',
              },
            ],
          },
        ],
      }),
      { status: 200 },
    );

  const client = new Channel3ApiClient('test-key', mockFetch);

  const result = await client.searchOffers(
    { productQuery: 'test product', currency: 'USD' },
    { timeoutMs: 5000 },
  );

  assert.equal(result.offerCount, 3);
  assert.equal(result.medianPrice, 200);
  assert.equal(result.minPrice, 100);
  assert.equal(result.currency, 'USD');
  assert.equal(result.sampleDomains.length, 3);
});

test('Channel3 reports API errors', async () => {
  const mockFetch: typeof fetch = async () =>
    new Response('Unauthorized', { status: 401 });

  const client = new Channel3ApiClient('test-key', mockFetch);

  await assert.rejects(
    () =>
      client.searchOffers(
        { productQuery: 'test product' },
        { timeoutMs: 5000 },
      ),
    /Channel3 API error: 401/,
  );
});
