import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HttpCorporateRegistryProvider,
  corporateRegistryConfig,
  lookupCorporateRegistry,
} from '../src/services/registry/corporateRegistry.js';

const config = { url: 'https://registry.example.test/lookup', apiKey: 'test-key', timeoutMs: 1000 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('corporate provider parses, normalizes, deduplicates and caps records', async () => {
  const records = Array.from({ length: 7 }, (_, i) => ({
    merchantId: `MCH-${i}`,
    legalName: `Example Company ${i}`,
    brandNames: ['Example Brand'],
    domain: `HTTPS://WWW.Shop-${i}.Example/Path`,
    status: 'verified',
    source: 'provider',
  }));
  records.push(records[0]);
  const seen: Array<{ url: string; auth?: string }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({ url, auth: headers.authorization });
    return jsonResponse({ records });
  }) as unknown as typeof fetch;

  const provider = new HttpCorporateRegistryProvider(config, fetchImpl);
  const out = await provider.lookup({ by: 'domain', query: 'shop.example' }, { timeoutMs: 1000 });

  assert.equal(out.length, 5);
  assert.equal(out[0].domain, 'shop-0.example');
  assert.equal(out[0].status, 'verified');
  assert.equal(out[0].source, 'provider');
  assert.match(out[0].fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(seen[0].url, /by=domain/);
  assert.match(seen[0].url, /query=shop\.example/);
  assert.equal(seen[0].auth, 'Bearer test-key');
});

test('corporate provider rejects malformed or non-JSON responses without inventing records', async () => {
  const provider = new HttpCorporateRegistryProvider(
    config,
    (async () => jsonResponse({ records: [{ legalName: 'Missing id' }] })) as unknown as typeof fetch,
  );
  await assert.rejects(() => provider.lookup({ by: 'name', query: 'Example' }, { timeoutMs: 1000 }), /documented schema/);

  const invalid = new HttpCorporateRegistryProvider(
    config,
    (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch,
  );
  await assert.rejects(() => invalid.lookup({ by: 'name', query: 'Example' }, { timeoutMs: 1000 }), /invalid JSON/);
});

test('lookupCorporateRegistry degrades to an explicit empty result on provider failure', async () => {
  const result = await lookupCorporateRegistry(
    { by: 'domain', query: 'shop.example' },
    {
      timeoutMs: 1000,
      env: { CORPORATE_REGISTRY_URL: config.url, CORPORATE_REGISTRY_API_KEY: 'test-key' },
      fetchImpl: (async () => new Response('unavailable', { status: 503 })) as unknown as typeof fetch,
    },
  );
  assert.equal(result.configured, true);
  assert.deepEqual(result.records, []);
  assert.match(result.error ?? '', /HTTP 503/);
});

test('no provider URL means no network call and an explicit local-only result', async () => {
  let called = false;
  const result = await lookupCorporateRegistry(
    { by: 'name', query: 'Example' },
    {
      timeoutMs: 1000,
      env: {},
      fetchImpl: (async () => {
        called = true;
        return jsonResponse({ records: [] });
      }) as unknown as typeof fetch,
    },
  );
  assert.equal(result.configured, false);
  assert.deepEqual(result.records, []);
  assert.equal(called, false);
});

test('only HTTPS provider URLs are accepted', () => {
  assert.equal(corporateRegistryConfig({ CORPORATE_REGISTRY_URL: 'http://registry.example.test' }), null);
  assert.equal(corporateRegistryConfig({ CORPORATE_REGISTRY_URL: 'https://registry.example.test' })?.timeoutMs, 2500);
  assert.equal(corporateRegistryConfig({ CORPORATE_REGISTRY_URL: 'https://registry.example.test', CORPORATE_REGISTRY_TIMEOUT_MS: '10' })?.timeoutMs, 500);
});
