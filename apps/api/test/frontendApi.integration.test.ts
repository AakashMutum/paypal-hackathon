import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { Application } from 'express';
import { createApp } from '../src/app.js';
import { setCustomFetch as setCustomAuthFetch } from '../src/services/paypal/paypalAuth.service.js';
import { setCustomOrdersFetch } from '../src/services/paypal/paypalOrders.service.js';
import { setDatabaseUrl } from '../src/config/env.js';

let app: Application;

before(() => {
  setDatabaseUrl('');
  setCustomAuthFetch(async () => {
    return new Response(
      JSON.stringify({
        access_token: 'MOCK_SANDBOX_ACCESS_TOKEN_INTEGRATION',
        token_type: 'Bearer',
        expires_in: 32400,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });
  setCustomOrdersFetch(async (input, _init) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/capture')) {
      return new Response(
        JSON.stringify({
          id: 'MOCK-PP-CAPTURE-ID',
          status: 'COMPLETED',
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: 'USD', value: '299.00' } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/void')) {
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify({
        id: 'MOCK-PP-ORDER-ID-999',
        status: 'CREATED',
        intent: 'AUTHORIZE',
        purchase_units: [{ amount: { currency_code: 'USD', value: '299.00' } }],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });
  app = createApp();
});

after(() => {
  setCustomAuthFetch(null);
  setCustomOrdersFetch(null);
});

test('POST /api/scan scans storefront and produces structured 4-node evidence', async () => {
  const res = await request(app).post('/api/scan').send({ url: 'https://www.harborline-outfitters.example' }).expect(200);

  assert.equal(res.body.verdict, 'ALLOW');
  assert.equal(res.body.riskScore <= 39, true);
  assert.equal(res.body.evidence.length, 4);
  assert.deepEqual(res.body.evidence.map((e: { node: string }) => e.node), ['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE']);
});

test('POST /api/scan detects the lookalike impersonator and issues PAUSE', async () => {
  const res = await request(app).post('/api/scan').send({ url: 'https://www.harborlyne-outfitters-sale.example' }).expect(200);

  assert.equal(res.body.verdict, 'PAUSE');
  assert.equal(res.body.riskScore >= 75, true);
  assert.equal(res.body.evidence[3].status, 'FAIL');
});

const order = (storeId: string) =>
  request(app)
    .post('/api/orders')
    .send({ storeId, items: [{ sku: 'SKU-1', name: 'Test item', price: 84.5, qty: 1 }], buyerEmail: 'buyer@shop.example' })
    .expect(200);

test('POST /api/orders creates an order, an investigation and an order token', async () => {
  const res = await order('harborline-outfitters');
  assert.ok(res.body.orderId);
  assert.ok(res.body.paypalOrderId);
  assert.ok(res.body.investigationId);
  assert.ok(res.body.orderToken);

  const getRes = await request(app).get('/api/investigations/' + res.body.investigationId).expect(200);
  assert.equal(getRes.body.id, res.body.investigationId);
  assert.equal(getRes.body.claimedBrand, 'Harborline Outfitters');
});

test('POST /api/orders/:orderId/approved captures ALLOW orders on approval', async () => {
  const created = await order('harborline-outfitters');
  const approveRes = await request(app)
    .post('/api/orders/' + created.body.orderId + '/approved')
    .set('x-order-token', created.body.orderToken)
    .expect(200);

  assert.equal(approveRes.body.decision, 'ALLOW');
  assert.equal(approveRes.body.captureState, 'CAPTURED');
});

test('POST /api/orders/:orderId/approved halts capture on impersonator orders (PAUSE)', async () => {
  const created = await order('harborlyne-outfitters-sale');
  const approveRes = await request(app)
    .post('/api/orders/' + created.body.orderId + '/approved')
    .set('x-order-token', created.body.orderToken)
    .expect(200);

  assert.equal(approveRes.body.decision, 'PAUSE');
  assert.equal(approveRes.body.captureState, 'HELD');

  const cancelRes = await request(app)
    .post('/api/orders/' + created.body.investigationId + '/cancel')
    .set('x-order-token', created.body.orderToken)
    .expect(200);
  assert.equal(cancelRes.body.captureState, 'VOIDED');
});

test('POST /api/v1/investigations serves the agent endpoint', async () => {
  const res = await request(app)
    .post('/api/v1/investigations')
    .send({ merchantUrl: 'https://www.harborline-outfitters.example', transactionAmount: 84.5, currency: 'USD', claimedBrand: 'Harborline Outfitters' })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.ok(res.body.data.decision);
});
