import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { closeDatabase } from '../src/database/connection.js';
import { setCustomFetch, clearTokenCache } from '../src/services/paypal/paypalAuth.service.js';
import { setCustomOrdersFetch } from '../src/services/paypal/paypalOrders.service.js';
import { setPaypalConfig } from '../src/config/env.js';

const app = createApp();

after(async () => {
  await closeDatabase();
});

beforeEach(() => {
  clearTokenCache();
  setPaypalConfig({
    paypalClientId: 'client_orchestration_test',
    paypalClientSecret: 'secret_orchestration_test',
    paypalMode: 'sandbox',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    paypalTimeoutMs: 5000,
  });

  // Mock OAuth
  setCustomFetch(async () => {
    return new Response(
      JSON.stringify({
        access_token: 'valid_orchestration_token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });
});

test('POST /api/v1/orders creates a checkout order successfully', async () => {
  const dynamicOrderId = `ORDER-CREATE-${Date.now()}`;
  setCustomOrdersFetch(async (url, init) => {
    assert.ok(String(url).includes('/v2/checkout/orders'));
    assert.equal(init?.method, 'POST');

    return new Response(
      JSON.stringify({
        id: dynamicOrderId,
        status: 'CREATED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: 'default',
            amount: { currency_code: 'USD', value: '89.99' },
          },
        ],
        links: [
          {
            href: `https://www.sandbox.paypal.com/checkoutnow?token=${dynamicOrderId}`,
            rel: 'approve',
            method: 'GET',
          },
        ],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const response = await request(app)
    .post('/api/v1/orders')
    .send({
      storefrontUrl: `https://super-gadgets-${Date.now()}.com/checkout`,
      amount: 89.99,
      currency: 'USD',
      claimedMerchantName: 'Super Gadgets Store',
      payeeEmail: 'billing@super-gadgets.com',
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.orderId, dynamicOrderId);
  assert.equal(response.body.data.status, 'CREATED');
  assert.equal(response.body.data.amount, '89.99');
  assert.ok(response.body.data.approvalUrl.includes(dynamicOrderId));
});

test('POST /api/v1/orders rejects invalid amount or missing URL', async () => {
  const invalidAmountRes = await request(app)
    .post('/api/v1/orders')
    .send({
      storefrontUrl: 'https://super-gadgets.com',
      amount: -20,
    });

  assert.equal(invalidAmountRes.status, 400);
  assert.equal(invalidAmountRes.body.success, false);
  assert.equal(invalidAmountRes.body.error.code, 'VALIDATION_ERROR');

  const missingUrlRes = await request(app)
    .post('/api/v1/orders')
    .send({
      amount: 50,
    });

  assert.equal(missingUrlRes.status, 400);
  assert.equal(missingUrlRes.body.success, false);
});

test('GET /api/v1/orders/:orderId retrieves order details', async () => {
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({
        id: 'ORDER-ORCH-GET',
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '110.00' },
            payee: {
              merchant_id: 'MERCHANT_XYZ',
              email_address: 'merchant@xyz.com',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const response = await request(app).get('/api/v1/orders/ORDER-ORCH-GET');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.orderId, 'ORDER-ORCH-GET');
  assert.equal(response.body.data.status, 'APPROVED');
  assert.equal(response.body.data.amount, '110.00');
});

test('POST /api/v1/orders/:orderId/capture enforces ALLOW decision and captures order', async () => {
  const dynamicOrderId = `ORDER-ALLOW-${Date.now()}`;
  // First create the order so merchant record & session exist with matching payee
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({
        id: dynamicOrderId,
        status: 'CREATED',
        purchase_units: [
          {
            reference_id: 'default',
            amount: { currency_code: 'USD', value: '35.00' },
          },
        ],
        links: [{ href: 'https://approve', rel: 'approve', method: 'GET' }],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({
      storefrontUrl: `https://legit-books-${Date.now()}.com/checkout`,
      amount: 35.00,
      currency: 'USD',
      claimedMerchantName: 'Legit Books',
      payeeEmail: 'payments@legit-books.com',
    });

  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  // Mock PayPal order fetch (matching payee) and capture
  setCustomOrdersFetch(async (url, init) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/capture')) {
      return new Response(
        JSON.stringify({
          id: orderId,
          status: 'COMPLETED',
          purchase_units: [
            {
              payments: {
                captures: [
                  {
                    id: 'CAPTURE-ALLOW-123',
                    status: 'COMPLETED',
                    amount: { currency_code: 'USD', value: '35.00' },
                  },
                ],
              },
            },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // GET order
    return new Response(
      JSON.stringify({
        id: orderId,
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '35.00' },
            payee: {
              email_address: 'payments@legit-books.com', // exact match
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  // Capture request
  const captureRes = await request(app).post(`/api/v1/orders/${orderId}/capture`).send({});
  assert.equal(captureRes.status, 200);
  assert.equal(captureRes.body.success, true);
  assert.equal(captureRes.body.data.status, 'COMPLETED');
  assert.equal(captureRes.body.data.captureId, 'CAPTURE-ALLOW-123');
  assert.equal(captureRes.body.data.decision, 'ALLOW');
  assert.equal(captureRes.body.data.actionTaken, 'PROCEED');
});

test('POST /api/v1/orders/:orderId/capture blocks capture on payee MISMATCH (PAUSE)', async () => {
  const dynamicOrderId = `ORDER-MISMATCH-${Date.now()}`;
  // Create order with expected merchant
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({
        id: dynamicOrderId,
        status: 'CREATED',
        purchase_units: [{ amount: { currency_code: 'USD', value: '299.99' } }],
        links: [],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({
      storefrontUrl: `https://brand-designer-${Date.now()}.com/checkout`,
      amount: 299.99,
      currency: 'USD',
      claimedMerchantName: 'Brand Designer Official',
      payeeEmail: 'finance@brand-designer.com',
      merchantId: 'BRAND_DESIGNER_ID',
    });

  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  // PayPal order returns mismatched rogue payee
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({
        id: orderId,
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '299.99' },
            payee: {
              email_address: 'scammer_stealth_wallet@hotmail.com',
              merchant_id: 'ROGUE_MERCHANT_404',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  // Attempt capture — must be rejected with 403 Forbidden!
  const captureRes = await request(app).post(`/api/v1/orders/${orderId}/capture`).send({});
  assert.equal(captureRes.status, 403);
  assert.equal(captureRes.body.success, false);
  assert.equal(captureRes.body.error.code, 'CAPTURE_PAUSED');
  assert.equal(captureRes.body.error.details.decision, 'PAUSE');
});

test('POST /api/v1/orders/:orderId/capture requires user acknowledgement on WARN and succeeds with override', async () => {
  const dynamicOrderId = `ORDER-WARN-${Date.now()}`;
  // Create order for unverified storefront without registered payee
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({
        id: dynamicOrderId,
        status: 'CREATED',
        purchase_units: [{ amount: { currency_code: 'USD', value: '65.00' } }],
        links: [],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const createRes = await request(app)
    .post('/api/v1/orders')
    .send({
      storefrontUrl: `https://unverified-store-${Date.now()}.com/checkout`,
      amount: 65.00,
      currency: 'USD',
    });

  assert.equal(createRes.status, 201);
  const orderId = createRes.body.data.orderId;

  // PayPal order returns generic unverified payee
  setCustomOrdersFetch(async (url) => {
    const urlStr = String(url);
    if (urlStr.endsWith('/capture')) {
      return new Response(
        JSON.stringify({
          id: orderId,
          status: 'COMPLETED',
          purchase_units: [
            {
              payments: {
                captures: [{ id: 'CAP-WARN-OVERRIDE', status: 'COMPLETED', amount: { currency_code: 'USD', value: '65.00' } }],
              },
            },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        id: orderId,
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '65.00' },
            payee: {
              email_address: 'seller@unverified-store.com',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  // Verify decision is WARN
  const decRes = await request(app).get(`/api/v1/orders/${orderId}/decision`);
  assert.equal(decRes.status, 200);
  assert.equal(decRes.body.data.decision, 'WARN');

  // First capture attempt without acknowledgement: must return 409 Conflict
  const unackRes = await request(app).post(`/api/v1/orders/${orderId}/capture`).send({});
  assert.equal(unackRes.status, 409);
  assert.equal(unackRes.body.success, false);
  assert.equal(unackRes.body.error.code, 'WARNING_ACKNOWLEDGEMENT_REQUIRED');

  // Second capture attempt with user acknowledgement: must proceed and succeed
  const ackRes = await request(app)
    .post(`/api/v1/orders/${orderId}/capture`)
    .send({ userAcknowledged: true, overrideReason: 'User inspected domain and approved payment' });

  assert.equal(ackRes.status, 200);
  assert.equal(ackRes.body.success, true);
  assert.equal(ackRes.body.data.status, 'COMPLETED');
  assert.equal(ackRes.body.data.actionTaken, 'USER_OVERRIDE');
});
