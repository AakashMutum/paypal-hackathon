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
  setDatabaseUrl('postgres://localhost:5432/mock_empty_db_no_connect');
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
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://pulseaudio-store.com' })
    .expect(200);

  assert.equal(res.body.verdict, 'ALLOW');
  assert.equal(res.body.riskScore <= 39, true);
  assert.equal(res.body.evidence.length, 4);
  assert.equal(res.body.evidence[0].node, 'SURFACE');
  assert.equal(res.body.evidence[1].node, 'MERCHANT');
  assert.equal(res.body.evidence[2].node, 'PRICE');
  assert.equal(res.body.evidence[3].node, 'PAYEE');
});

test('POST /api/scan detects lookalike impersonator and issues BLOCK', async () => {
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://luxaura-outletdeals.com' })
    .expect(200);

  assert.equal(res.body.verdict, 'BLOCK');
  assert.equal(res.body.riskScore >= 75, true);
  assert.equal(res.body.evidence[3].status, 'FAIL');
});

test('POST /api/orders creates order and investigation record', async () => {
  const res = await request(app)
    .post('/api/orders')
    .send({
      storeId: 'pulseaudio',
      items: [{ sku: 'PAP-1', name: 'PulseAudio Pro', price: 299, qty: 1 }],
      buyerEmail: 'alex.walker@gmail.com',
    })
    .expect(200);

  assert.ok(res.body.orderId);
  assert.ok(res.body.paypalOrderId);
  assert.ok(res.body.investigationId);

  // Poll investigation by ID
  const getRes = await request(app)
    .get(`/api/investigations/${res.body.investigationId}`)
    .expect(200);

  assert.equal(getRes.body.id, res.body.investigationId);
  assert.equal(getRes.body.claimedBrand, 'PulseAudio');
});

test('POST /api/orders/:orderId/approved captures ALLOW orders on approval', async () => {
  const createRes = await request(app)
    .post('/api/orders')
    .send({
      storeId: 'pulseaudio',
      items: [{ sku: 'PAP-1', name: 'PulseAudio Pro', price: 299, qty: 1 }],
      buyerEmail: 'alex.walker@gmail.com',
    })
    .expect(200);

  const approveRes = await request(app)
    .post(`/api/orders/${createRes.body.orderId}/approved`)
    .expect(200);

  assert.equal(approveRes.body.decision, 'ALLOW');
  assert.equal(approveRes.body.captureState, 'CAPTURED');
});

test('POST /api/orders/:orderId/approved halts capture on impersonator orders (PAUSE/BLOCK)', async () => {
  const createRes = await request(app)
    .post('/api/orders')
    .send({
      storeId: 'luxaura-outlet',
      items: [{ sku: 'LXH-1', name: 'Luxaura Handbag', price: 149, qty: 1 }],
      buyerEmail: 'alex.walker@gmail.com',
    })
    .expect(200);

  const approveRes = await request(app)
    .post(`/api/orders/${createRes.body.orderId}/approved`)
    .expect(200);

  assert.equal(approveRes.body.decision, 'BLOCK');
  assert.equal(approveRes.body.captureState, 'HELD');

  // Cancel & Void authorization
  const cancelRes = await request(app)
    .post(`/api/orders/${createRes.body.investigationId}/cancel`)
    .expect(200);

  assert.equal(cancelRes.body.captureState, 'VOIDED');
});

test('POST /api/v1/investigations serves autonomous agent MCP endpoint', async () => {
  const res = await request(app)
    .post('/api/v1/investigations')
    .send({
      domain: 'pulseaudio-store.com',
      amount: 299,
      currency: 'USD',
      claimedBrand: 'PulseAudio',
    })
    .expect(200);

  assert.equal(res.body.success, true);
  assert.ok(res.body.data.decision);
});
