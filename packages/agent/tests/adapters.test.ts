import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createFixtureSignals, createHttpSignals } from '../src/adapters/signalsAdapter.js';
import { createFixtureRegistry, createHttpRegistry } from '../src/adapters/registryAdapter.js';
import { SCENARIOS, loadScenario } from '../src/fixtures/index.js';
import { scenarioA } from '../src/fixtures/scenario-a.js';
import { scenarioB } from '../src/fixtures/scenario-b.js';
import type { RegistryRecord } from '../src/ports.js';

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
  });
}

// ------------------------------------------------------------- fixtures

test('the fixture signals split evidence by tool', async () => {
  const signals = createFixtureSignals(scenarioA);
  const opts = { timeoutMs: 1000 };

  const domain = await signals.getDomainReport('veloura-outdoor.example', opts);
  assert.deepEqual(domain.map((entry) => entry.type), ['DOMAIN_AGE']);

  const price = await signals.getPriceReport({ claims: scenarioA.claims }, opts);
  assert.deepEqual(price.map((entry) => entry.type), ['PRICE_DEVIATION']);

  const binding = await signals.checkPayeeBinding({ domain: 'veloura-outdoor.example' }, opts);
  assert.deepEqual(binding.map((entry) => entry.type), ['PAYEE_BINDING']);
});

test('the fixture signals serve sections and offers when recorded', async () => {
  const signals = createFixtureSignals(scenarioB);
  const section = await signals.fetchPageSection(
    { baseUrl: scenarioB.claims.finalUrl, hint: 'about' },
    { timeoutMs: 1000 }
  );
  assert.equal(section.found, true);

  const missing = await signals.fetchPageSection({ baseUrl: '', hint: 'terms' }, { timeoutMs: 1000 });
  assert.equal(missing.found, false);

  const offers = await signals.compareOffers({ productQuery: 'jacket' }, { timeoutMs: 1000 });
  assert.equal(offers.offerCount, 0);
});

test('the fixture registry is case insensitive and returns nothing for unknown queries', async () => {
  const registry = createFixtureRegistry(scenarioA);
  const opts = { timeoutMs: 1000 };

  const byName = await registry.lookup({ by: 'name', query: 'VELOURA' }, opts);
  assert.equal(byName.length, 1);
  assert.equal(byName[0].merchantId, 'MERCH-A');

  const unknown = await registry.lookup({ by: 'name', query: 'Nobody' }, opts);
  assert.deepEqual(unknown, []);
});

test('the fixture registry never returns more than five records', async () => {
  const many: RegistryRecord[] = Array.from({ length: 7 }, (_, index) => ({
    merchantId: `MERCH-${index}`,
    legalName: `Merchant ${index}`,
    brandNames: [],
    domain: `merchant-${index}.example`,
    status: 'verified',
  }));
  const fixture = structuredClone(scenarioA);
  fixture.registry.byName = { many };

  const registry = createFixtureRegistry(fixture);
  const records = await registry.lookup({ by: 'name', query: 'many' }, { timeoutMs: 1000 });
  assert.equal(records.length, 5);
});

test('fixture failures are counted per tool', async () => {
  const signals = createFixtureSignals(scenarioA, { failures: { getPageClaims: 1 } });
  await assert.rejects(() => signals.getPageClaims('x', { timeoutMs: 1000 }));
  const second = await signals.getPageClaims('x', { timeoutMs: 1000 });
  assert.equal(second.domain, scenarioA.claims.domain);
});

test('every shipped scenario loads by name', () => {
  for (const name of Object.keys(SCENARIOS)) {
    assert.equal(loadScenario(name).name, name);
  }
  assert.equal(loadScenario('d2').name, 'D2');
  assert.throws(() => loadScenario('Z'), /Unknown scenario/);
});

// ------------------------------------------------------------- live adapters

test('the live registry adapter posts the lookup and returns records', async () => {
  let captured: { url?: string; body?: unknown } = {};
  const record: RegistryRecord = {
    merchantId: 'MERCH-A',
    legalName: 'Veloura Outdoor Pvt Ltd',
    brandNames: ['Veloura'],
    domain: 'veloura-outdoor.example',
    status: 'verified',
  };

  const server = await startServer(async (req, res) => {
    captured = { url: req.url, body: JSON.parse(await readBody(req)) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify([record]));
  });

  try {
    const registry = createHttpRegistry(server.url);
    const records = await registry.lookup({ by: 'merchantId', query: 'MERCH-A' }, { timeoutMs: 1000 });
    assert.deepEqual(records, [record]);
    assert.equal(captured.url, '/registry/lookup');
    assert.deepEqual(captured.body, { by: 'merchantId', query: 'MERCH-A' });
  } finally {
    await server.close();
  }
});

test('the live signals adapter posts the url and returns page claims', async () => {
  let captured: { url?: string; body?: unknown } = {};

  const server = await startServer(async (req, res) => {
    captured = { url: req.url, body: JSON.parse(await readBody(req)) };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(scenarioA.claims));
  });

  try {
    const signals = createHttpSignals(server.url);
    const claims = await signals.getPageClaims('https://veloura-outdoor.example', { timeoutMs: 1000 });
    assert.equal(claims.domain, 'veloura-outdoor.example');
    assert.equal(captured.url, '/signals/page-claims');
    assert.deepEqual(captured.body, { url: 'https://veloura-outdoor.example' });
  } finally {
    await server.close();
  }
});

test('a non-2xx response is turned into a rejected promise', async () => {
  const server = await startServer((_req, res) => {
    res.statusCode = 500;
    res.end('boom');
  });

  try {
    const signals = createHttpSignals(server.url);
    await assert.rejects(() => signals.getDomainReport('x.example', { timeoutMs: 1000 }));
  } finally {
    await server.close();
  }
});
