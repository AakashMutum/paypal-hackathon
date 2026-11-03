/**
 * End-to-end tests of the demo flow through createApp(), with no PayPal credentials and no network.
 *
 * Three fictional stores are used, named by the store ids the API knows:
 *   genuine      -> store id "pulseaudio"      (agent scenario A, expected ALLOW)
 *   heavy discount -> store id "mega-deals"    (agent scenario B, expected WARN)
 *   impersonator -> store id "luxaura-outlet"  (agent scenario C, payee mismatch, expected PAUSE)
 *
 * A test marked `todo` asserts the correct behaviour and currently fails because of a defect
 * listed in docs/e2e-report.md. It keeps CI green and keeps the defect visible.
 */
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../src/app.js';
import { setPaypalConfig, setDatabaseUrl } from '../src/config/env.js';

const STORES = {
  genuine: { storeId: 'pulseaudio', url: 'pulseaudio-store.com', verdict: 'ALLOW' },
  discount: { storeId: 'mega-deals', url: 'mega-dealsoutlet.net', verdict: 'WARN' },
  impersonator: { storeId: 'luxaura-outlet', url: 'luxaura-outletdeals.com', verdict: 'BLOCK' },
} as const;
type StoreKey = keyof typeof STORES;

let app: Application;

before(() => {
  setDatabaseUrl('');
  setPaypalConfig({ paypalClientId: '', paypalClientSecret: '' });
  app = createApp();
});

beforeEach(async () => {
  await request(app).post('/api/demo/reset');
});

async function placeOrder(store: StoreKey) {
  const res = await request(app)
    .post('/api/orders')
    .send({ storeId: STORES[store].storeId, items: [{ sku: 'sku-1', name: 'Test item', price: 50, qty: 1 }], buyerEmail: 'buyer@shop.example' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { orderId: string; paypalOrderId: string; investigationId: string };
}

async function investigation(id: string) {
  const res = await request(app).get(`/api/investigations/${id}`);
  assert.equal(res.status, 200);
  return res.body as { id: string; verdict: string; captureState: string; status: string; evidence: unknown[]; reviewRequested?: boolean };
}

// ---------------------------------------------------------------------------------------------
// Frontend routes
// ---------------------------------------------------------------------------------------------

for (const key of Object.keys(STORES) as StoreKey[]) {
  test(`POST /api/scan returns a verdict and four evidence nodes (${key})`, async () => {
    const res = await request(app).post('/api/scan').send({ url: STORES[key].url });
    assert.equal(res.status, 200);
    assert.equal(res.body.verdict, STORES[key].verdict);
    assert.equal(res.body.status, 'COMPLETE');
    assert.equal(res.body.evidence.length, 4);
  });
}

test('POST /api/scan rejects a missing or non-string url with 400', async () => {
  assert.equal((await request(app).post('/api/scan').send({})).status, 400);
  assert.equal((await request(app).post('/api/scan').send({ url: 42 })).status, 400);
});

test('POST /api/orders creates an order and a pending investigation (ids for all three stores)', async () => {
  for (const key of Object.keys(STORES) as StoreKey[]) {
    const order = await placeOrder(key);
    assert.ok(order.orderId && order.paypalOrderId && order.investigationId);
    const inv = await investigation(order.investigationId);
    assert.equal(inv.verdict, STORES[key].verdict);
    assert.equal(inv.captureState, 'PENDING');
  }
});

test('ALLOW leads to CAPTURED after the buyer approves', async () => {
  const order = await placeOrder('genuine');
  const res = await request(app).post(`/api/orders/${order.orderId}/approved`);
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, 'ALLOW');
  assert.equal(res.body.captureState, 'CAPTURED');
  assert.equal((await investigation(order.investigationId)).captureState, 'CAPTURED');
});

test('WARN never reaches CAPTURED', async () => {
  const order = await placeOrder('discount');
  const res = await request(app).post(`/api/orders/${order.orderId}/approved`);
  assert.equal(res.status, 200);
  assert.notEqual(res.body.captureState, 'CAPTURED');
  assert.equal(res.body.captureState, 'HELD');
});

test('PAUSE never reaches CAPTURED, and a payee mismatch is never CAPTURED', async () => {
  const order = await placeOrder('impersonator');
  const res = await request(app).post(`/api/orders/${order.orderId}/approved`);
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, 'BLOCK');
  assert.equal(res.body.captureState, 'HELD');
  assert.notEqual((await investigation(order.investigationId)).captureState, 'CAPTURED');
});

test('approving an unknown order gives 404', async () => {
  assert.equal((await request(app).post('/api/orders/NOPE-123/approved')).status, 404);
});

test('GET /api/investigations lists the new investigations and GET /:id returns one', async () => {
  const order = await placeOrder('genuine');
  const list = await request(app).get('/api/investigations');
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body));
  assert.ok(list.body.some((i: { id: string }) => i.id === order.investigationId));
  assert.equal((await request(app).get('/api/investigations/INV-DOES-NOT-EXIST')).status, 404);
});

test('POST /api/orders/:id/cancel voids the authorization (VOIDED) and unknown ids give 404', async () => {
  const order = await placeOrder('impersonator');
  await request(app).post(`/api/orders/${order.orderId}/approved`);
  const res = await request(app).post(`/api/orders/${order.investigationId}/cancel`);
  assert.equal(res.status, 200);
  assert.equal(res.body.captureState, 'VOIDED');
  assert.equal((await investigation(order.investigationId)).captureState, 'VOIDED');
  assert.equal((await request(app).post('/api/orders/INV-NOPE/cancel')).status, 404);
});

test('POST /api/orders/:id/review marks the investigation and unknown ids give 404', async () => {
  const order = await placeOrder('discount');
  const res = await request(app).post(`/api/orders/${order.investigationId}/review`);
  assert.equal(res.status, 200);
  assert.equal(res.body.reviewRequested, true);
  assert.equal((await request(app).post('/api/orders/INV-NOPE/review')).status, 404);
});

test('POST /api/demo/reset removes investigations created since the last reset', async () => {
  const order = await placeOrder('genuine');
  const reset = await request(app).post('/api/demo/reset');
  assert.equal(reset.status, 200);
  assert.equal((await request(app).get(`/api/investigations/${order.investigationId}`)).status, 404);
  const list = await request(app).get('/api/investigations');
  assert.ok(list.body.every((i: { id: string }) => i.id.startsWith('INV-SEED')), 'only the built-in seed cases remain');
});

test('POST /api/reports and /api/merchants answer', async () => {
  assert.equal((await request(app).post('/api/reports').send({ domain: 'scam-shop.example', reason: 'test' })).status, 200);
  const merchant = await request(app).post('/api/merchants').send({ type: 'INDIVIDUAL' });
  assert.equal(merchant.status, 200);
  assert.equal(merchant.body.status, 'SUSPECT');
});

// ---------------------------------------------------------------------------------------------
// Known defects: these assert the correct behaviour and are expected to fail today.
// ---------------------------------------------------------------------------------------------

test('DEFECT E1: POST /api/orders validates its body (400 for a malformed order)', { todo: 'E1: no input validation on /api/orders' }, async () => {
  const res = await request(app).post('/api/orders').send({ storeId: 123, items: 'not-a-list', buyerEmail: 5 });
  assert.equal(res.status, 400);
});

test('DEFECT E2: a captured payment cannot be voided afterwards', { todo: 'E2: cancel sets VOIDED even after CAPTURED' }, async () => {
  const order = await placeOrder('genuine');
  await request(app).post(`/api/orders/${order.orderId}/approved`);
  const res = await request(app).post(`/api/orders/${order.investigationId}/cancel`);
  assert.equal(res.status, 409);
  assert.equal((await investigation(order.investigationId)).captureState, 'CAPTURED');
});

test('DEFECT E3: the verdict comes from the agent evidence, not from a canned profile', { todo: 'E3: evidence cards and reasons are canned' }, async () => {
  const res = await request(app).post('/api/scan').send({ url: STORES.impersonator.url });
  const text = JSON.stringify(res.body.evidence);
  // The agent found a payee mismatch for this store; the card should say so from real evidence.
  assert.match(text, /mismatch/i);
});

test('DEFECT E4: a scan of an unknown store is decided by evidence, not by words in the domain', { todo: 'E4: unknown domains are classified by keyword' }, async () => {
  const calm = await request(app).post('/api/scan').send({ url: 'boutique-deals-clearance.example' });
  const same = await request(app).post('/api/scan').send({ url: 'garden-tools-supply.example' });
  // Two unknown stores with no evidence should get the same verdict.
  assert.equal(calm.body.verdict, same.body.verdict);
});

// ---------------------------------------------------------------------------------------------
// Agent routes (request shapes from apps/mcp/src/apiClient.ts)
// ---------------------------------------------------------------------------------------------

const investigatePayload = (store: StoreKey) => ({
  orderId: `ORD-${store}`,
  merchantUrl: `https://${STORES[store].url}`,
  claimedBrand: 'Test Brand',
  transactionAmount: 120,
  currency: 'USD',
  payee: { merchantId: 'MERCH-TEST', email: 'billing@shop.example' },
});

test('DEFECT E6: POST /api/v1/investigations accepts the MCP request shape (merchantUrl) and returns a verdict', { todo: 'E6: the API requires `domain`; the MCP client sends merchantUrl' }, async () => {
  const res = await request(app).post('/api/v1/investigations').send(investigatePayload('genuine'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.success, true);
  assert.ok(['ALLOW', 'WARN', 'PAUSE'].includes(res.body.data.decision));
});

test('POST /api/v1/investigations rejects a body with no merchant with 400', async () => {
  const res = await request(app).post('/api/v1/investigations').send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

test('POST /api/v1/investigations also answers the legacy `domain` field', async () => {
  const res = await request(app).post('/api/v1/investigations').send({ domain: STORES.genuine.url, amount: 120 });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('POST /api/v1/checkout/orders creates a checkout awaiting approval (MCP shape)', async () => {
  const res = await request(app).post('/api/v1/checkout/orders').send({
    merchantUrl: `https://${STORES.genuine.url}`,
    amount: 120,
    currency: 'USD',
    merchantId: 'MERCH-TEST',
    claimedBrand: 'Test Brand',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'AWAITING_APPROVAL');
  assert.ok(res.body.data.checkoutId);
});

test('POST /api/v1/checkout/orders/:id/finalize: unknown id gives 404', async () => {
  const res = await request(app).post('/api/v1/checkout/orders/CHK-NOPE/finalize').send({});
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('PUT /api/v1/policies/:agentId stores and echoes the policy', async () => {
  const policy = { perOrderCap: 100, dailyCap: 300, currency: 'USD' };
  const res = await request(app).put('/api/v1/policies/agent-1').send(policy);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.policy, policy);
});

test('DEFECT E5: checkout create records the merchant the MCP client sends', { todo: 'E5: the API reads merchant.domain, the MCP client sends merchantUrl' }, async () => {
  const created = await request(app).post('/api/v1/checkout/orders').send({
    merchantUrl: `https://${STORES.impersonator.url}`,
    amount: 149,
    currency: 'USD',
    merchantId: 'MERCH-FAKE',
    claimedBrand: 'Test Brand',
  });
  const finalized = await request(app).post(`/api/v1/checkout/orders/${created.body.data.checkoutId}/finalize`).send({});
  // The impersonator must not be captured.
  assert.notEqual(finalized.body.data?.status, 'CAPTURED');
});

test('DEFECT E7: PUT /api/v1/policies/:agentId validates the policy (400 for a bad body)', { todo: 'E7: policies are stored unvalidated and never enforced' }, async () => {
  const res = await request(app).put('/api/v1/policies/agent-2').send({ perOrderCap: 'lots' });
  assert.equal(res.status, 400);
});

test('DEFECT E8: demo reset and cancel require authentication', { todo: 'E8: /api/demo/reset and /cancel are open' }, async () => {
  const res = await request(app).post('/api/demo/reset');
  assert.ok(res.status === 401 || res.status === 403);
});

// ---------------------------------------------------------------------------------------------
// PayPal ids: what the API sends to PayPal when credentials are configured (fake fetch)
// ---------------------------------------------------------------------------------------------

test('DEFECT E9: capture and void use the authorize-then-capture flow and the authorization id', { todo: 'E9: capture/void are sent with the ORDER id and authorize is never called' }, async () => {
  const { setCustomFetch } = await import('../src/services/paypal/paypalAuth.service.js');
  const { setCustomOrdersFetch } = await import('../src/services/paypal/paypalOrders.service.js');
  const calls: string[] = [];
  setPaypalConfig({ paypalClientId: 'test-client', paypalClientSecret: 'test-secret' });
  setCustomFetch(async () =>
    new Response(JSON.stringify({ access_token: 'T', token_type: 'Bearer', expires_in: 3600 }), { status: 200 }),
  );
  setCustomOrdersFetch(async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/v2/checkout/orders')) {
      return new Response(JSON.stringify({ id: 'ORDER-1', status: 'CREATED', intent: 'AUTHORIZE', purchase_units: [] }), { status: 201 });
    }
    if (url.includes('/authorize')) {
      return new Response(
        JSON.stringify({ id: 'ORDER-1', status: 'COMPLETED', intent: 'AUTHORIZE', purchase_units: [{ payments: { authorizations: [{ id: 'AUTH-1', status: 'CREATED' }] } }] }),
        { status: 201 },
      );
    }
    return new Response(JSON.stringify({ id: 'X', status: 'COMPLETED', intent: 'AUTHORIZE', purchase_units: [] }), { status: 200 });
  });
  try {
    const order = await placeOrder('genuine');
    await request(app).post(`/api/orders/${order.orderId}/approved`);
    assert.ok(calls.some((u) => u.includes('/authorize')), 'the order is authorized first');
    assert.ok(calls.some((u) => u.includes('/v2/payments/authorizations/') && u.endsWith('/capture')), 'capture uses the authorization id');
    assert.equal(calls.some((u) => u.includes('/v2/checkout/orders/') && u.endsWith('/capture')), false, 'capture is not sent to the order');
  } finally {
    setPaypalConfig({ paypalClientId: '', paypalClientSecret: '' });
    setCustomFetch(null);
    setCustomOrdersFetch(null);
  }
});
