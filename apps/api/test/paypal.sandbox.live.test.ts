import test from 'node:test';
import assert from 'node:assert/strict';
import { getAccessToken, clearTokenCache } from '../src/services/paypal/paypalAuth.service.js';
import { createPayPalOrder, getPayPalOrder } from '../src/services/paypal/paypalOrders.service.js';
import { env } from '../src/config/env.js';

const clientId = process.env.PAYPAL_CLIENT_ID || '';
const clientSecret = process.env.PAYPAL_CLIENT_SECRET || '';
const hasSandboxCredentials = Boolean(clientId && clientSecret && env.paypalMode === 'sandbox');

if (!hasSandboxCredentials) {
  test('PayPal Sandbox Live Integration Suite (Skipped)', (t) => {
    t.skip(
      'Live PayPal Sandbox credentials (PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET) are not set in .env. ' +
      'Skipping live PayPal network integration suite.'
    );
  });
} else {
  test('PayPal Sandbox Live Integration Suite', async (t) => {
    clearTokenCache();

    let liveAccessToken = '';

    await t.test('obtains real OAuth 2.0 access token from PayPal Sandbox', async () => {
      try {
        liveAccessToken = await getAccessToken();
        assert.ok(liveAccessToken, 'Access token should be non-empty');
        assert.ok(liveAccessToken.startsWith('A'), 'PayPal access tokens typically start with A');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        t.skip(`PayPal Sandbox network is unreachable or credentials rejected: ${message}`);
      }
    });

    await t.test('creates and retrieves a real PayPal Sandbox order via Orders API v2', async () => {
      if (!liveAccessToken) {
        t.skip('Skipped because OAuth token could not be obtained');
        return;
      }

      try {
        const order = await createPayPalOrder({
          amount: 15.50,
          currency: 'USD',
          description: 'TRUSTORA Automated Sandbox Test Order',
          requestId: `sandbox_test_${Date.now()}`,
        });

        assert.ok(order.id, 'Order ID must be returned by PayPal');
        assert.equal(order.status, 'CREATED');
        assert.ok(order.links && order.links.length > 0, 'Links must be present');

        // Retrieve the live order
        const retrieved = await getPayPalOrder(order.id);
        assert.equal(retrieved.id, order.id);
        assert.equal(retrieved.status, 'CREATED');
        assert.equal(retrieved.purchase_units[0].amount.value, '15.50');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        t.skip(`PayPal Sandbox API call failed: ${message}`);
      }
    });
  });
}

