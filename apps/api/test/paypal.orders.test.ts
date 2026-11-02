import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPayPalOrder,
  getPayPalOrder,
  capturePayPalOrder,
  setCustomOrdersFetch,
  PayPalOrderError,
} from '../src/services/paypal/paypalOrders.service.js';
import { setCustomFetch, clearTokenCache } from '../src/services/paypal/paypalAuth.service.js';
import { setPaypalConfig } from '../src/config/env.js';

beforeEach(() => {
  clearTokenCache();
  setPaypalConfig({
    paypalClientId: 'client_id_test',
    paypalClientSecret: 'secret_test',
    paypalMode: 'sandbox',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    paypalTimeoutMs: 5000,
  });

  // Mock OAuth token
  setCustomFetch(async () => {
    return new Response(
      JSON.stringify({
        access_token: 'valid_bearer_token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  setCustomOrdersFetch(null);
});

test('createPayPalOrder creates an order with formatted amount and idempotency header', async () => {
  let capturedBody: any = null;
  let capturedHeaders: Record<string, string> = {};

  setCustomOrdersFetch(async (_url, init) => {
    capturedBody = JSON.parse(String(init?.body));
    capturedHeaders = (init?.headers as Record<string, string>) || {};

    return new Response(
      JSON.stringify({
        id: 'ORDER-123456789',
        status: 'CREATED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: 'default',
            amount: { currency_code: 'USD', value: '49.99' },
          },
        ],
        links: [
          {
            href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123456789',
            rel: 'approve',
            method: 'GET',
          },
        ],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const order = await createPayPalOrder({
    amount: 49.99,
    currency: 'USD',
    requestId: 'req-idempotency-key-1',
    description: 'Electronics purchase',
  });

  assert.equal(order.id, 'ORDER-123456789');
  assert.equal(order.status, 'CREATED');
  assert.equal(capturedHeaders['PayPal-Request-Id'], 'req-idempotency-key-1');
  assert.equal(capturedHeaders.Authorization, 'Bearer valid_bearer_token');
  assert.equal(capturedBody.purchase_units[0].amount.value, '49.99');
  assert.equal(capturedBody.purchase_units[0].amount.currency_code, 'USD');
});

test('createPayPalOrder validates amount and currency strictly', async () => {
  await assert.rejects(
    () => createPayPalOrder({ amount: -10, currency: 'USD' }),
    (err: unknown) => {
      assert.ok(err instanceof PayPalOrderError);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );

  await assert.rejects(
    () => createPayPalOrder({ amount: 50, currency: 'TOOLONG' }),
    (err: unknown) => {
      assert.ok(err instanceof PayPalOrderError);
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('getPayPalOrder retrieves order and payee details', async () => {
  setCustomOrdersFetch(async (url) => {
    assert.equal(String(url), 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-999');

    return new Response(
      JSON.stringify({
        id: 'ORDER-999',
        status: 'APPROVED',
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: 'USD', value: '120.00' },
            payee: {
              merchant_id: 'MERCHANT_GENUINE_ABC',
              email_address: 'merchant@genuine-store.com',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const order = await getPayPalOrder('ORDER-999');
  assert.equal(order.id, 'ORDER-999');
  assert.equal(order.status, 'APPROVED');
  assert.equal(order.purchase_units[0].payee?.merchant_id, 'MERCHANT_GENUINE_ABC');
  assert.equal(order.purchase_units[0].payee?.email_address, 'merchant@genuine-store.com');
});

test('getPayPalOrder handles 404 ORDER_NOT_FOUND', async () => {
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({ name: 'RESOURCE_NOT_FOUND', message: 'The specified resource does not exist.' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await assert.rejects(
    () => getPayPalOrder('NON_EXISTENT'),
    (err: unknown) => {
      assert.ok(err instanceof PayPalOrderError);
      assert.equal(err.code, 'ORDER_NOT_FOUND');
      assert.equal(err.status, 404);
      return true;
    }
  );
});

test('capturePayPalOrder captures successfully and handles duplicate capture idempotently', async () => {
  // Capture success
  setCustomOrdersFetch(async (url) => {
    assert.equal(String(url), 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-CAP-1/capture');
    return new Response(
      JSON.stringify({
        id: 'ORDER-CAP-1',
        status: 'COMPLETED',
        purchase_units: [
          {
            payments: {
              captures: [
                {
                  id: 'CAPTURE-777',
                  status: 'COMPLETED',
                  amount: { currency_code: 'USD', value: '75.00' },
                },
              ],
            },
          },
        ],
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  });

  const captured = await capturePayPalOrder('ORDER-CAP-1', 'req-capture-key');
  assert.equal(captured.id, 'ORDER-CAP-1');
  assert.equal(captured.status, 'COMPLETED');
  assert.equal(captured.purchase_units[0].payments?.captures?.[0].id, 'CAPTURE-777');

  // Duplicate capture (422 ORDER_ALREADY_CAPTURED)
  setCustomOrdersFetch(async () => {
    return new Response(
      JSON.stringify({
        name: 'UNPROCESSABLE_ENTITY',
        message: 'The requested action could not be performed.',
        details: [{ issue: 'ORDER_ALREADY_CAPTURED', description: 'Order has already been captured.' }],
      }),
      { status: 422, headers: { 'Content-Type': 'application/json' } }
    );
  });

  await assert.rejects(
    () => capturePayPalOrder('ORDER-CAP-1'),
    (err: unknown) => {
      assert.ok(err instanceof PayPalOrderError);
      assert.equal(err.code, 'ALREADY_CAPTURED');
      assert.equal(err.status, 422);
      return true;
    }
  );
});

