import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAccessToken,
  clearTokenCache,
  setCustomFetch,
  getCachedTokenForTesting,
  PayPalAuthError,
} from '../src/services/paypal/paypalAuth.service.js';
import { env, setPaypalConfig } from '../src/config/env.js';

beforeEach(() => {
  clearTokenCache();
  setCustomFetch(null);
  setPaypalConfig({
    paypalClientId: 'test_client_id_123',
    paypalClientSecret: 'test_client_secret_xyz',
    paypalMode: 'sandbox',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    paypalTimeoutMs: 5000,
  });
});

test('getAccessToken retrieves token using HTTP Basic auth and caches it', async () => {
  let callCount = 0;
  let capturedAuthHeader = '';

  const mockFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    callCount++;
    assert.equal(String(url), 'https://api-m.sandbox.paypal.com/v1/oauth2/token');
    assert.equal(init?.method, 'POST');
    capturedAuthHeader = (init?.headers as Record<string, string>)?.Authorization || '';

    const expectedCredentials = Buffer.from('test_client_id_123:test_client_secret_xyz').toString('base64');
    assert.equal(capturedAuthHeader, `Basic ${expectedCredentials}`);

    return new Response(
      JSON.stringify({
        access_token: 'mock_token_abc_123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'https://uri.paypal.com/services/payments',
        app_id: 'APP-TEST',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  setCustomFetch(mockFetch as unknown as typeof fetch);

  // First call makes network request
  const token1 = await getAccessToken();
  assert.equal(token1, 'mock_token_abc_123');
  assert.equal(callCount, 1);

  // Cached state verified
  const cached = getCachedTokenForTesting();
  assert.ok(cached);
  assert.equal(cached.accessToken, 'mock_token_abc_123');

  // Second call must return cached token without network request
  const token2 = await getAccessToken();
  assert.equal(token2, 'mock_token_abc_123');
  assert.equal(callCount, 1); // No new network call
});

test('getAccessToken refreshes token when expired or forceRefresh is requested', async () => {
  let callCount = 0;

  const mockFetch = async (): Promise<Response> => {
    callCount++;
    return new Response(
      JSON.stringify({
        access_token: `mock_token_call_${callCount}`,
        token_type: 'Bearer',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  setCustomFetch(mockFetch as unknown as typeof fetch);

  const token1 = await getAccessToken();
  assert.equal(token1, 'mock_token_call_1');
  assert.equal(callCount, 1);

  // Force refresh
  const token2 = await getAccessToken({ forceRefresh: true });
  assert.equal(token2, 'mock_token_call_2');
  assert.equal(callCount, 2);
});

test('getAccessToken rejects invalid credentials with 401 safely without leaking secrets', async () => {
  const mockFetch = async (): Promise<Response> => {
    return new Response(
      JSON.stringify({
        error: 'invalid_client',
        error_description: 'Client Authentication failed',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  };

  setCustomFetch(mockFetch as unknown as typeof fetch);

  await assert.rejects(
    () => getAccessToken(),
    (err: unknown) => {
      assert.ok(err instanceof PayPalAuthError);
      assert.equal(err.code, 'INVALID_CREDENTIALS');
      assert.equal(err.status, 401);
      // Ensure secrets are never leaked in error message
      assert.equal(err.message.includes('test_client_secret_xyz'), false);
      return true;
    }
  );
});

test('getAccessToken validates required credentials', async () => {
  setPaypalConfig({ paypalClientId: '', paypalClientSecret: '' });

  await assert.rejects(
    () => getAccessToken(),
    (err: unknown) => {
      assert.ok(err instanceof PayPalAuthError);
      assert.equal(err.code, 'MISSING_CREDENTIALS');
      return true;
    }
  );
});

test('getAccessToken handles network timeouts cleanly', async () => {
  const mockFetch = async (_url: unknown, init?: RequestInit): Promise<Response> => {
    return new Promise((_resolve, reject) => {
      if (init?.signal) {
        init.signal.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      }
    });
  };

  setPaypalConfig({ paypalTimeoutMs: 10 });
  setCustomFetch(mockFetch as unknown as typeof fetch);

  await assert.rejects(
    () => getAccessToken(),
    (err: unknown) => {
      assert.ok(err instanceof PayPalAuthError);
      assert.equal(err.code, 'TIMEOUT');
      return true;
    }
  );
});

test('getAccessToken deduplicates concurrent in-flight requests', async () => {
  let callCount = 0;

  const mockFetch = async (): Promise<Response> => {
    callCount++;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return new Response(
      JSON.stringify({
        access_token: 'deduped_token',
        expires_in: 3600,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  setCustomFetch(mockFetch as unknown as typeof fetch);

  const [t1, t2, t3] = await Promise.all([
    getAccessToken(),
    getAccessToken(),
    getAccessToken(),
  ]);

  assert.equal(t1, 'deduped_token');
  assert.equal(t2, 'deduped_token');
  assert.equal(t3, 'deduped_token');
  assert.equal(callCount, 1); // Exact deduplication
});

