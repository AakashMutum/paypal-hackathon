/**
 * End-to-end tests of the demo flow through createApp(), with no PayPal credentials (explicit
 * simulation), no database and no network, plus the PayPal AUTHORIZE flow against a fake fetch.
 *
 * The canonical fictional stores (tests/fixtures):
 *   genuine      -> harborline-outfitters         (expected ALLOW)
 *   discount     -> bargainbarn-outlet            (expected WARN)
 *   impersonator -> harborlyne-outfitters-sale    (payee mismatch, expected PAUSE)
 *
 * A test marked `todo` asserts correct behaviour that a later change in this stack delivers.
 */
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../src/app.js';
import { env, setDatabaseUrl, setPaypalConfig } from '../src/config/env.js';
import { getBackend, resetBackendChoice } from '../src/services/persistence/recordStore.js';
import { setCustomFetch as setAuthFetch } from '../src/services/paypal/paypalAuth.service.js';
import { setCustomOrdersFetch } from '../src/services/paypal/paypalOrders.service.js';

const STORES = {
  genuine: { id: 'harborline-outfitters', domain: 'www.harborline-outfitters.example', verdict: 'ALLOW' },
  discount: { id: 'bargainbarn-outlet', domain: 'www.bargainbarn-outlet.example', verdict: 'WARN' },
  impersonator: { id: 'harborlyne-outfitters-sale', domain: 'www.harborlyne-outfitters-sale.example', verdict: 'PAUSE' },
} as const;
type StoreKey = keyof typeof STORES;

let app: Application;
const original = { ...env };

before(() => {
  setDatabaseUrl('');
  setPaypalConfig({ paypalClientId: '', paypalClientSecret: '' });
  env.demoAdminToken = '';
  env.guardianApiKey = '';
  env.nodeEnv = 'test';
  env.rateLimitMax = 100000; // the suite makes many requests
  resetBackendChoice();
  app = createApp();
});

after(() => {
  Object.assign(env, original);
});

beforeEach(async () => {
  env.demoAdminToken = '';
  env.guardianApiKey = '';
  env.nodeEnv = 'test';
  setPaypalConfig({ paypalClientId: '', paypalClientSecret: '' });
  setAuthFetch(null);
  setCustomOrdersFetch(null);
  await request(app).post('/api/demo/reset');
});

interface Placed {
  orderId: string;
  paypalOrderId: string;
  investigationId: string;
  orderToken: string;
  simulated: boolean;
  mode: string;
}

async function placeOrder(store: StoreKey): Promise<Placed> {
  const res = await request(app)
    .post('/api/orders')
    .send({ storeId: STORES[store].id, items: [{ sku: 'sku-1', name: 'Test item', price: 50, qty: 1 }], buyerEmail: 'buyer@shop.example' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as Placed;
}

const withToken = (req: request.Test, token: string): request.Test => req.set('x-order-token', token);

async function approve(order: Placed) {
  return withToken(request(app).post(`/api/orders/${order.orderId}/approved`), order.orderToken);
}

async function investigation(id: string) {
  const res = await request(app).get(`/api/investigations/${id}`);
  assert.equal(res.status, 200);
  return res.body as { id: string; verdict: string; captureState: string; captureReason?: string; simulated?: boolean; evidence: unknown[]; orderTokenHash?: string };
}

async function states(id: string): Promise<string[]> {
  return (await (await getBackend()).events(id)).map((e) => e.toState);
}

// ---------------------------------------------------------------------------------------------
// Scan and order creation
// ---------------------------------------------------------------------------------------------

for (const key of Object.keys(STORES) as StoreKey[]) {
  test(`POST /api/scan returns a verdict and four evidence nodes (${key})`, async () => {
    const res = await request(app).post('/api/scan').send({ url: STORES[key].domain });
    assert.equal(res.status, 200);
    assert.equal(res.body.verdict, STORES[key].verdict);
    assert.equal(res.body.status, 'COMPLETE');
    assert.equal(res.body.evidence.length, 4);
    assert.equal(res.body.orderTokenHash, undefined, 'the token hash is never exposed');
  });
}

test('POST /api/scan rejects bad bodies with 400 in the error envelope', async () => {
  for (const body of [{}, { url: 42 }, { url: '' }]) {
    const res = await request(app).post('/api/scan').send(body);
    assert.equal(res.status, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

test('POST /api/orders creates a simulated order with a token and a pending investigation', async () => {
  for (const key of Object.keys(STORES) as StoreKey[]) {
    const order = await placeOrder(key);
    assert.ok(order.orderToken.length >= 32);
    assert.equal(order.simulated, true);
    assert.equal(order.mode, 'simulated');
    assert.match(order.paypalOrderId, /^SIM-ORD-/, 'simulated ids are clearly marked');
    const inv = await investigation(order.investigationId);
    assert.equal(inv.verdict, STORES[key].verdict);
    assert.equal(inv.captureState, 'PENDING');
    assert.equal(inv.simulated, true);
    assert.equal(inv.orderTokenHash, undefined);
  }
});

test('POST /api/orders validates its body', async () => {
  for (const body of [{ storeId: 123, items: 'not-a-list', buyerEmail: 5 }, { items: [] }, { storeId: 'x', amount: -5 }, {}]) {
    const res = await request(app).post('/api/orders').send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  }
});

// ---------------------------------------------------------------------------------------------
// Approval, capture rules, tokens
// ---------------------------------------------------------------------------------------------

test('ALLOW leads to CAPTURED after approval, and the audit trail records each step', async () => {
  const order = await placeOrder('genuine');
  const res = await approve(order);
  assert.equal(res.status, 200);
  assert.equal(res.body.decision, 'ALLOW');
  assert.equal(res.body.captureState, 'CAPTURED');
  assert.equal(res.body.simulated, true);
  assert.deepEqual(await states(order.investigationId), ['PENDING', 'AUTHORIZED', 'CAPTURED']);
});

test('approving twice does not authorize or capture twice', async () => {
  const order = await placeOrder('genuine');
  await approve(order);
  const again = await approve(order);
  assert.equal(again.body.captureState, 'CAPTURED');
  assert.deepEqual(await states(order.investigationId), ['PENDING', 'AUTHORIZED', 'CAPTURED']);
});

test('WARN is held and never captured until a person acknowledges it', async () => {
  const order = await placeOrder('discount');
  const res = await approve(order);
  assert.equal(res.body.captureState, 'HELD');
  assert.match(res.body.captureReason, /acknowledge/i);
  assert.notEqual((await investigation(order.investigationId)).captureState, 'CAPTURED');
});

test('acknowledging a WARN captures the held authorization', async () => {
  const order = await placeOrder('discount');
  await approve(order);
  const ack = await withToken(request(app).post(`/api/orders/${order.investigationId}/acknowledge`), order.orderToken).send({});
  assert.equal(ack.status, 200);
  assert.equal(ack.body.captureState, 'CAPTURED');
  assert.equal(ack.body.acknowledged, true);
  assert.deepEqual(await states(order.investigationId), ['PENDING', 'AUTHORIZED', 'HELD', 'CAPTURED']);
});

test('acknowledging before approval is remembered and capture follows approval', async () => {
  const order = await placeOrder('discount');
  const ack = await withToken(request(app).post(`/api/orders/${order.investigationId}/acknowledge`), order.orderToken).send({});
  assert.equal(ack.status, 200);
  assert.equal(ack.body.captureState, 'PENDING');
  assert.equal((await approve(order)).body.captureState, 'CAPTURED');
});

test('PAUSE is never captured, and a payee mismatch cannot be acknowledged away', async () => {
  const order = await placeOrder('impersonator');
  const res = await approve(order);
  assert.equal(res.body.decision, 'PAUSE');
  assert.equal(res.body.captureState, 'HELD');
  const ack = await withToken(request(app).post(`/api/orders/${order.investigationId}/acknowledge`), order.orderToken).send({});
  assert.equal(ack.status, 409);
  assert.equal(ack.body.error.code, 'NOT_A_WARNING');
  assert.notEqual((await investigation(order.investigationId)).captureState, 'CAPTURED');
});

test('approve, cancel, review and acknowledge need the order token', async () => {
  const order = await placeOrder('genuine');
  for (const path of [`/api/orders/${order.orderId}/approved`, `/api/orders/${order.investigationId}/cancel`, `/api/orders/${order.investigationId}/review`, `/api/orders/${order.investigationId}/acknowledge`]) {
    assert.equal((await request(app).post(path).send({})).status, 403, `${path} without a token`);
    assert.equal((await request(app).post(path).set('x-order-token', 'wrong').send({})).status, 403, `${path} with a wrong token`);
  }
  assert.equal((await investigation(order.investigationId)).captureState, 'PENDING');
});

test('the demo admin token also opens an order for the analyst console', async () => {
  env.demoAdminToken = 'admin-secret';
  const order = await placeOrder('genuine');
  const res = await request(app).post(`/api/orders/${order.investigationId}/review`).set('x-demo-token', 'admin-secret');
  assert.equal(res.status, 200);
  assert.equal(res.body.reviewRequested, true);
});

test('approving an unknown order gives 404', async () => {
  assert.equal((await request(app).post('/api/orders/NOPE-123/approved').set('x-order-token', 'x')).status, 404);
});

// ---------------------------------------------------------------------------------------------
// Cancel, review, lists
// ---------------------------------------------------------------------------------------------

test('cancel voids the authorization (VOIDED) and records it', async () => {
  const order = await placeOrder('impersonator');
  await approve(order);
  const res = await withToken(request(app).post(`/api/orders/${order.investigationId}/cancel`), order.orderToken);
  assert.equal(res.status, 200);
  assert.equal(res.body.captureState, 'VOIDED');
  assert.deepEqual(await states(order.investigationId), ['PENDING', 'AUTHORIZED', 'HELD', 'VOIDED']);
});

test('a captured payment cannot be voided', async () => {
  const order = await placeOrder('genuine');
  await approve(order);
  const res = await withToken(request(app).post(`/api/orders/${order.investigationId}/cancel`), order.orderToken);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'ALREADY_CAPTURED');
  assert.equal((await investigation(order.investigationId)).captureState, 'CAPTURED');
});

test('cancel and review of an unknown id give 404', async () => {
  assert.equal((await request(app).post('/api/orders/INV-NOPE/cancel').set('x-order-token', 'x')).status, 404);
  assert.equal((await request(app).post('/api/orders/INV-NOPE/review').set('x-order-token', 'x')).status, 404);
});

test('list and get return investigations; an unknown id gives 404', async () => {
  const order = await placeOrder('genuine');
  const list = await request(app).get('/api/investigations');
  assert.equal(list.status, 200);
  assert.ok(list.body.some((i: { id: string }) => i.id === order.investigationId));
  assert.ok(list.body.every((i: { orderTokenHash?: string }) => i.orderTokenHash === undefined));
  const missing = await request(app).get('/api/investigations/INV-DOES-NOT-EXIST');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('reports and merchants are validated and answered', async () => {
  assert.equal((await request(app).post('/api/reports').send({ domain: 'scam-shop.example', reason: 'test' })).status, 200);
  assert.equal((await request(app).post('/api/reports').send({})).status, 400);
  const ok = await request(app).post('/api/merchants').send({ legalName: 'Test Shop Ltd', domain: 'test-shop.example', paypalEmail: 'pay@test-shop.example', type: 'INDIVIDUAL', country: 'GB' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'SUSPECT');
  assert.match(ok.body.merchantId, /^MCH-/);
  assert.equal((await request(app).post('/api/merchants').send({ type: 'INDIVIDUAL' })).status, 400);
});

// ---------------------------------------------------------------------------------------------
// Reset and authentication
// ---------------------------------------------------------------------------------------------

test('demo reset empties the store', async () => {
  const order = await placeOrder('genuine');
  assert.equal((await request(app).post('/api/demo/reset')).status, 200);
  assert.equal((await request(app).get(`/api/investigations/${order.investigationId}`)).status, 404);
  assert.deepEqual((await request(app).get('/api/investigations')).body, []);
});

test('demo reset needs x-demo-token when DEMO_ADMIN_TOKEN is set', async () => {
  env.demoAdminToken = 'admin-secret';
  assert.equal((await request(app).post('/api/demo/reset')).status, 403);
  assert.equal((await request(app).post('/api/demo/reset').set('x-demo-token', 'nope')).status, 403);
  assert.equal((await request(app).post('/api/demo/reset').set('x-demo-token', 'admin-secret')).status, 200);
});

test('demo reset is refused in production when DEMO_ADMIN_TOKEN is unset', async () => {
  env.nodeEnv = 'production';
  const res = await request(app).post('/api/demo/reset');
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('agent routes need the bearer token when GUARDIAN_API_KEY is set', async () => {
  env.guardianApiKey = 'guardian-secret';
  const body = { merchantUrl: `https://${STORES.genuine.domain}`, transactionAmount: 84.5, currency: 'USD' };
  assert.equal((await request(app).post('/api/v1/investigations').send(body)).status, 401);
  assert.equal((await request(app).post('/api/v1/investigations').set('Authorization', 'Bearer wrong').send(body)).status, 401);
  assert.equal((await request(app).post('/api/v1/investigations').set('Authorization', 'Bearer guardian-secret').send(body)).status, 200);
});

// ---------------------------------------------------------------------------------------------
// Agent routes (request shapes from apps/mcp/src/apiClient.ts)
// ---------------------------------------------------------------------------------------------

const investigatePayload = (key: StoreKey) => ({
  orderId: `ORD-${key}`,
  merchantUrl: `https://${STORES[key].domain}`,
  claimedBrand: 'Harborline Outfitters',
  transactionAmount: 84.5,
  currency: 'USD',
  payee: { merchantId: 'MERCH-TEST', email: 'billing@shop.example' },
});

test('POST /api/v1/investigations accepts the MCP request shape', async () => {
  for (const key of Object.keys(STORES) as StoreKey[]) {
    const res = await request(app).post('/api/v1/investigations').send(investigatePayload(key));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.decision, STORES[key].verdict);
  }
});

test('POST /api/v1/investigations still accepts the older domain field and validates', async () => {
  const legacy = await request(app).post('/api/v1/investigations').send({ domain: STORES.genuine.domain, amount: 84.5 });
  assert.equal(legacy.status, 200);
  const bad = await request(app).post('/api/v1/investigations').send({});
  assert.equal(bad.status, 400);
  assert.equal(bad.body.success, false);
  assert.equal(bad.body.error.code, 'VALIDATION_ERROR');
});

const checkoutPayload = (key: StoreKey, extra: Record<string, unknown> = {}) => ({
  merchantUrl: `https://${STORES[key].domain}`,
  amount: 84.5,
  currency: 'USD',
  merchantId: key === 'impersonator' ? 'MERCH-QUICKPAY-HOLDINGS' : 'MERCH-HARBORLINE',
  payeeEmail: key === 'impersonator' ? 'collect@quickpay-holdings.example' : 'payments@harborline-outfitters.example',
  claimedBrand: 'Harborline Outfitters',
  agentId: 'agent-1',
  ...extra,
});

async function createCheckout(key: StoreKey, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/v1/checkout/orders').send(checkoutPayload(key, extra));
  return res;
}

async function finalize(checkoutId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/v1/checkout/orders/${checkoutId}/finalize`).send(body);
}

test('checkout create holds an order and nothing is captured', async () => {
  const res = await createCheckout('genuine');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'AWAITING_APPROVAL');
  assert.equal(res.body.data.simulated, true);
  assert.match(res.body.data.checkoutId, /^CHK-/);
});

test('finalize captures a genuine checkout, pauses the impersonator, and never captures a payee mismatch', async () => {
  const ok = await finalize((await createCheckout('genuine')).body.data.checkoutId);
  assert.equal(ok.body.data.status, 'CAPTURED');
  assert.equal(ok.body.data.captureState, 'CAPTURED');

  const fake = await finalize((await createCheckout('impersonator')).body.data.checkoutId, { humanDecision: 'proceed' });
  assert.equal(fake.status, 200);
  assert.equal(fake.body.data.status, 'PAUSED');
  assert.equal(fake.body.data.decision, 'PAUSE');
  assert.equal(fake.body.data.captureState, 'VOIDED', 'the held authorization is voided');
});

test('finalize on a WARN waits for a human decision; proceed captures, abort voids', async () => {
  const held = await finalize((await createCheckout('discount')).body.data.checkoutId);
  assert.equal(held.body.data.status, 'NEEDS_HUMAN_DECISION');
  assert.equal(held.body.data.captureState, 'HELD');

  const id = (await createCheckout('discount')).body.data.checkoutId;
  await finalize(id);
  const proceed = await finalize(id, { humanDecision: 'proceed' });
  assert.equal(proceed.body.data.status, 'CAPTURED');

  const abortId = (await createCheckout('discount')).body.data.checkoutId;
  await finalize(abortId);
  const abort = await finalize(abortId, { humanDecision: 'abort' });
  assert.equal(abort.body.data.status, 'ABORTED');
  assert.equal(abort.body.data.captureState, 'VOIDED');
});

test('finalize twice does not act twice, an unknown id gives 404, and a bad body gives 400', async () => {
  const id = (await createCheckout('genuine')).body.data.checkoutId;
  await finalize(id);
  const again = await finalize(id);
  assert.equal(again.body.data.status, 'CAPTURED');
  assert.deepEqual(await states(id), ['PENDING', 'AUTHORIZED', 'CAPTURED']);
  const missing = await finalize('CHK-NOPE');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'ORDER_NOT_FOUND');
  assert.equal((await finalize(id, { humanDecision: 'maybe' })).status, 400);
});

test('spend policies are stored per agent, validated, and enforced with POLICY_VIOLATION', async () => {
  assert.equal((await request(app).put('/api/v1/policies/agent-2').send({ perOrderCap: 'lots' })).status, 400);
  const policy = { perOrderCap: 100, dailyCap: 120, firstPurchaseCap: 60, currency: 'USD' };
  const set = await request(app).put('/api/v1/policies/agent-2').send(policy);
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.data.policy, policy);

  const first = await createCheckout('genuine', { agentId: 'agent-2' });
  assert.equal(first.status, 403, 'first purchase 84.50 is above the first-purchase cap 60');
  assert.equal(first.body.error.code, 'POLICY_VIOLATION');
  assert.equal(first.body.error.details.cap, 'firstPurchaseCap');

  const tooBig = await createCheckout('genuine', { agentId: 'agent-2', amount: 120 });
  assert.equal(tooBig.body.error.details.cap, 'perOrderCap');

  const small = await createCheckout('genuine', { agentId: 'agent-2', amount: 50 });
  assert.equal(small.status, 200);
  assert.equal((await finalize(small.body.data.checkoutId)).body.data.status, 'CAPTURED');

  const second = await createCheckout('genuine', { agentId: 'agent-2', amount: 90 });
  assert.equal(second.status, 403, 'spent 50 today, 50 + 90 is above the daily cap 120');
  assert.equal(second.body.error.details.cap, 'dailyCap');

  const other = await createCheckout('genuine', { agentId: 'agent-3' });
  assert.equal(other.status, 200, 'another agent has no policy');
});

test('the marketplace lists only the canonical stores', async () => {
  const res = await request(app).get('/api/v1/demo/marketplace');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((l: { id: string }) => l.id).sort(), Object.values(STORES).map((s) => s.id).sort());
  assert.ok(res.body.data.every((l: { domain: string }) => l.domain.endsWith('.example')));
});

// ---------------------------------------------------------------------------------------------
// The PayPal AUTHORIZE flow (fake fetch)
// ---------------------------------------------------------------------------------------------

interface PayPalCall {
  method: string;
  url: string;
  requestId?: string;
  body?: unknown;
}

function fakePayPal(opts: { failCapture?: boolean; noAuthorizationId?: boolean } = {}): PayPalCall[] {
  const calls: PayPalCall[] = [];
  setPaypalConfig({ paypalClientId: 'test-client', paypalClientSecret: 'test-secret' });
  setAuthFetch(async () => new Response(JSON.stringify({ access_token: 'TOKEN-123', token_type: 'Bearer', expires_in: 3600 }), { status: 200 }));
  setCustomOrdersFetch(async (input, init) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method: init?.method ?? 'GET', url, requestId: headers['PayPal-Request-Id'], body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url.endsWith('/v2/checkout/orders')) {
      return json({ id: 'ORDER-1', status: 'CREATED', intent: 'AUTHORIZE', purchase_units: [], links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1', method: 'GET' }] }, 201);
    }
    if (url.endsWith('/authorize')) {
      return json({ id: 'ORDER-1', status: 'COMPLETED', intent: 'AUTHORIZE', purchase_units: [{ payments: { authorizations: opts.noAuthorizationId ? [] : [{ id: 'AUTH-1', status: 'CREATED' }] } }] }, 201);
    }
    if (url.endsWith('/capture')) {
      return opts.failCapture ? json({ message: 'Instrument declined', name: 'UNPROCESSABLE_ENTITY' }, 422) : json({ id: 'CAP-1', status: 'COMPLETED' }, 201);
    }
    if (url.endsWith('/void')) return new Response(null, { status: 204 });
    return json({ id: 'ORDER-1', status: 'APPROVED', intent: 'AUTHORIZE', purchase_units: [{ amount: { currency_code: 'USD', value: '50.00' } }] });
  });
  return calls;
}

test('sandbox flow: create (AUTHORIZE), authorize, then capture the authorization id', async () => {
  const calls = fakePayPal();
  const order = await placeOrder('genuine');
  assert.equal(order.simulated, false);
  assert.equal(order.mode, 'sandbox');
  assert.equal(order.paypalOrderId, 'ORDER-1');
  const res = await approve(order);
  assert.equal(res.body.captureState, 'CAPTURED');
  const sequence = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`);
  assert.deepEqual(sequence, ['POST /v2/checkout/orders', 'POST /v2/checkout/orders/ORDER-1/authorize', 'POST /v2/payments/authorizations/AUTH-1/capture']);
  assert.equal((calls[0].body as { intent: string }).intent, 'AUTHORIZE');
  assert.ok(calls.every((c) => c.requestId), 'every create, authorize and capture call sends PayPal-Request-Id');
  assert.equal(new Set(calls.map((c) => c.requestId)).size, calls.length, 'request ids are distinct per step');
  const inv = await investigation(order.investigationId);
  assert.equal(inv.simulated, false);
});

test('sandbox flow: cancel voids the authorization id, not the order id', async () => {
  const calls = fakePayPal();
  const order = await placeOrder('impersonator');
  await approve(order);
  const res = await withToken(request(app).post(`/api/orders/${order.investigationId}/cancel`), order.orderToken);
  assert.equal(res.body.captureState, 'VOIDED');
  const voided = calls.find((c) => c.url.endsWith('/void'));
  assert.ok(voided);
  assert.match(voided.url, /\/v2\/payments\/authorizations\/AUTH-1\/void$/);
  assert.equal(calls.some((c) => c.url.endsWith('/capture')), false, 'a paused payment is never captured');
});

test('sandbox flow: a capture failure ends FAILED with a reason, never CAPTURED, and leaks no secret', async () => {
  fakePayPal({ failCapture: true });
  const order = await placeOrder('genuine');
  const res = await approve(order);
  assert.equal(res.body.captureState, 'FAILED');
  assert.match(res.body.captureReason, /Capture failed/);
  const text = JSON.stringify(res.body);
  for (const secret of ['TOKEN-123', 'test-secret', 'Bearer']) assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(await states(order.investigationId), ['PENDING', 'AUTHORIZED', 'FAILED']);
});

test('sandbox flow: no authorization id from PayPal ends FAILED', async () => {
  fakePayPal({ noAuthorizationId: true });
  const order = await placeOrder('genuine');
  const res = await approve(order);
  assert.equal(res.body.captureState, 'FAILED');
  assert.match(res.body.captureReason, /authorization id/);
});

test('sandbox flow: a failed order creation is an error, not a made-up order', async () => {
  setPaypalConfig({ paypalClientId: 'test-client', paypalClientSecret: 'test-secret' });
  setAuthFetch(async () => new Response(JSON.stringify({ access_token: 'TOKEN-123', token_type: 'Bearer', expires_in: 3600 }), { status: 200 }));
  setCustomOrdersFetch(async () => new Response(JSON.stringify({ message: 'Payee account is invalid' }), { status: 422 }));
  const res = await request(app).post('/api/orders').send({ storeId: STORES.genuine.id });
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'PAYPAL_ERROR');
  assert.deepEqual((await request(app).get('/api/investigations')).body, []);
});

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

test('GET /health reports the modes', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.modes.paypal, 'simulated');
  assert.equal(res.body.data.modes.store, 'memory');
  for (const key of ['signals', 'llm', 'memory']) assert.ok(res.body.data.modes[key], key);
  setPaypalConfig({ paypalClientId: 'test-client', paypalClientSecret: 'test-secret' });
  assert.equal((await request(app).get('/health')).body.data.modes.paypal, 'sandbox');
});

// ---------------------------------------------------------------------------------------------
// Defects fixed later in this stack (build/agent-pipeline)
// ---------------------------------------------------------------------------------------------

test('DEFECT E3: evidence cards and reasons come from the agent evidence', { todo: 'E3: cards are still built from catalog data; fixed by build/agent-pipeline' }, async () => {
  const res = await request(app).post('/api/scan').send({ url: STORES.impersonator.domain });
  assert.match(JSON.stringify(res.body.evidence), /mismatch/i);
});

test('DEFECT E4: an unknown store is decided by evidence, not by words in the domain', { todo: 'E4: fixed by build/agent-pipeline' }, async () => {
  const a = await request(app).post('/api/scan').send({ url: 'boutique-deals-clearance.example' });
  const b = await request(app).post('/api/scan').send({ url: 'garden-tools-supply.example' });
  assert.equal(a.body.verdict, b.body.verdict);
});
