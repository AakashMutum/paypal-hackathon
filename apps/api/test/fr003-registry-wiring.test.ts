import test, { beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import dotenv from 'dotenv';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { closeDatabase } from '../src/database/connection.js';
import { setCustomFetch, clearTokenCache } from '../src/services/paypal/paypalAuth.service.js';
import { setCustomOrdersFetch } from '../src/services/paypal/paypalOrders.service.js';
import { setPaypalConfig } from '../src/config/env.js';
import { clearInMemoryStore } from '../src/services/orders/orderOrchestration.service.js';

dotenv.config({ path: path.resolve(process.cwd(), '..', '..', '.env') });

const app = createApp();
const DATA_GOV_IN_HOST = 'api.data.gov.in';
const originalFetch = globalThis.fetch;

type RocResponse = { status: number; body: unknown };

let rocResponse: RocResponse = { status: 200, body: { records: [] } };

after(async () => {
  await closeDatabase();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  rocResponse = { status: 200, body: { records: [] } };
});

const rocCompany = {
  cin: 'CIN-MOCK-001',
  company_name: 'Mock Merchant Private Limited',
  company_status: 'Active',
  date_of_registration: '2021-01-01',
  registered_address: 'Mock Address, Maharashtra',
};

function mockRoc(status: number, body: unknown): void {
  rocResponse = { status, body };
}

beforeEach(() => {
  clearTokenCache();
  clearInMemoryStore();
  setPaypalConfig({
    paypalClientId: 'client_fr003_test',
    paypalClientSecret: 'secret_fr003_test',
    paypalMode: 'sandbox',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    paypalTimeoutMs: 5000,
  });

  // OAuth
  setCustomFetch(async () =>
    new Response(
      JSON.stringify({ access_token: 'token_fr003', token_type: 'Bearer', expires_in: 3600 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  );

  let createdOrderId = '';
  setCustomOrdersFetch(async (input, init) => {
    const url = String(input);
    if (String(init?.method).toUpperCase() === 'POST' && url.includes('/v2/checkout/orders')) {
      createdOrderId = `ORDER-FR003-${Date.now()}`;
      return new Response(
        JSON.stringify({ id: createdOrderId, status: 'CREATED', intent: 'CAPTURE', purchase_units: [] }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // GET order
    return new Response(
      JSON.stringify({
        id: createdOrderId || url,
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: '50.00' }, payee: { email_address: 'payee@example.com' } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  // data.gov.in via global fetch (only lookupCorporateRegistry uses global fetch)
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(DATA_GOV_IN_HOST)) {
      return new Response(JSON.stringify(rocResponse.body), {
        status: rocResponse.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('unexpected global fetch', { status: 500 });
  }) as typeof fetch;
});

test('wiring: evaluateOrderRisk invokes data.gov.in and propagates corporate registry evidence on MATCH', async () => {
  mockRoc(200, { records: [rocCompany] });

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({ storefrontUrl: 'https://mock-merchant.example/checkout', amount: 50, currency: 'USD', merchantId: 'CIN-MOCK-001' });
  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  const decRes = await request(app).get(`/api/v1/orders/${orderId}/decision`);
  assert.equal(decRes.status, 200);
  assert.equal(decRes.body.success, true);

  const evidence = decRes.body.data.evidence as Record<string, unknown>;
  assert.ok(evidence, 'evidence must be present');
  assert.ok('corporateRegistry' in evidence, 'corporateRegistry evidence must be wired into decision');

  const registry = evidence.corporateRegistry as Record<string, unknown>;
  assert.equal(registry.provider, 'data.gov.in');
  assert.equal(registry.configured, true);
  assert.equal(registry.status, 'MATCH');
  assert.ok(String(registry.lookedUpAt).match(/^\d{4}-\d{2}-\d{2}T/), 'lookedUpAt timestamp must be present');
  const records = registry.records as unknown[];
  assert.equal(records.length, 1);
  const record = records[0] as Record<string, unknown>;
  assert.equal(record.cin, 'CIN-MOCK-001');
  assert.equal(record.legalName, 'Mock Merchant Private Limited');
  assert.ok(String(record.source).includes('data.gov.in'), 'record source must identify data.gov.in');
  assert.ok(String(record.fetchedAt).match(/^\d{4}-\d{2}-\d{2}T/), 'record fetchedAt timestamp must be present');

  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('CORPORATE_REGISTRY_API_KEY'), false, 'API key must not leak into evidence');
  assert.equal(serialized.includes('secret_fr003_test'), false, 'secrets must not leak into evidence');
});

test('wiring: UNKNOWN fallback when data.gov.in returns no matching record', async () => {
  mockRoc(200, { records: [rocCompany] }); // different cin than queried

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({ storefrontUrl: 'https://no-match.example/checkout', amount: 50, currency: 'USD', merchantId: 'CIN-NOPE-999' });
  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  const decRes = await request(app).get(`/api/v1/orders/${orderId}/decision`);
  assert.equal(decRes.status, 200);

  const registry = (decRes.body.data.evidence as Record<string, unknown>).corporateRegistry as Record<string, unknown>;
  assert.equal(registry.status, 'UNKNOWN');
  assert.deepEqual(registry.records, []);
  assert.ok(String(registry.lookedUpAt).match(/^\d{4}-\d{2}-\d{2}T/));
});

test('wiring: UNKNOWN fallback on malformed data.gov.in response without crashing', async () => {
  mockRoc(200, { records: [{ company_name: 'Missing CIN' }] });

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({ storefrontUrl: 'https://malformed.example/checkout', amount: 50, currency: 'USD', merchantId: 'CIN-XYZ' });
  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  const decRes = await request(app).get(`/api/v1/orders/${orderId}/decision`);
  assert.equal(decRes.status, 200);

  const registry = (decRes.body.data.evidence as Record<string, unknown>).corporateRegistry as Record<string, unknown>;
  assert.equal(registry.status, 'UNKNOWN');
  assert.deepEqual(registry.records, []);
  assert.ok(registry.error, 'error must be recorded for malformed response');
  assert.equal((registry.error as string).includes('CORPORATE_REGISTRY_API_KEY'), false, 'error must not leak API key');
});

test('wiring: UNKNOWN fallback on data.gov.in timeout without crashing', async () => {
  globalThis.fetch = (async () => {
    return new Promise<Response>((_resolve, reject) => {
      const timer = setTimeout(() => { clearTimeout(timer); reject(new Error('aborted')); }, 50);
    });
  }) as typeof fetch;

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({ storefrontUrl: 'https://timeout.example/checkout', amount: 50, currency: 'USD', merchantId: 'CIN-TIMEOUT' });
  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  const decRes = await request(app).get(`/api/v1/orders/${orderId}/decision`);
  assert.equal(decRes.status, 200);

  const registry = (decRes.body.data.evidence as Record<string, unknown>).corporateRegistry as Record<string, unknown>;
  assert.equal(registry.status, 'UNKNOWN');
  assert.deepEqual(registry.records, []);
});
