import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GuardianApiClient,
  GuardianApiError,
  plainMessageFor,
} from '../src/apiClient.js';

interface Captured {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function fakeFetch(
  payload: unknown,
  options: { status?: number; capture?: Captured[]; delayMs?: number } = {}
): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (options.capture) {
      options.capture.push({
        url,
        method: init?.method,
        headers: init?.headers as Record<string, string>,
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
    }
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    const status = options.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof payload === 'string' ? payload : JSON.stringify(payload),
    };
  }) as unknown as typeof fetch;
}

const request = {
  orderId: 'preview-1',
  merchantUrl: 'https://shop.example',
};

test('sends the bearer token and unwraps the success envelope', async () => {
  const captured: Captured[] = [];
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example/',
    apiKey: 'secret-key',
    fetchImpl: fakeFetch(
      { success: true, data: { decision: 'ALLOW' }, meta: {} },
      { capture: captured }
    ),
  });

  const result = await client.investigateMerchant(request);

  assert.deepEqual(result, { decision: 'ALLOW' });
  assert.equal(captured[0].url, 'https://guardian.example/api/v1/investigations');
  assert.equal(captured[0].method, 'POST');
  assert.equal(captured[0].headers?.Authorization, 'Bearer secret-key');
  assert.deepEqual(JSON.parse(captured[0].body ?? '{}'), request);
});

test('maps every known error code to a plain sentence', async () => {
  const codes = [
    'VALIDATION_ERROR',
    'POLICY_VIOLATION',
    'GUARDIAN_PAUSED',
    'REQUIRES_DECISION',
    'UPSTREAM_TIMEOUT',
  ];

  for (const code of codes) {
    const client = new GuardianApiClient({
      baseUrl: 'https://guardian.example',
      fetchImpl: fakeFetch(
        { success: false, error: { code, message: 'technical detail that must not leak' } },
        { status: 400 }
      ),
    });

    await assert.rejects(
      () => client.investigateMerchant(request),
      (error: unknown) => {
        assert.ok(error instanceof GuardianApiError);
        assert.equal(error.code, code);
        assert.equal(error.message, plainMessageFor(code));
        assert.doesNotMatch(error.message, /technical detail/);
        return true;
      }
    );
  }
});

test('an unknown error code gets the neutral fallback', async () => {
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example',
    fetchImpl: fakeFetch(
      { success: false, error: { code: 'SOMETHING_NEW', message: 'raw' } },
      { status: 500 }
    ),
  });

  await assert.rejects(
    () => client.investigateMerchant(request),
    (error: unknown) => {
      assert.ok(error instanceof GuardianApiError);
      assert.equal(error.code, 'SOMETHING_NEW');
      assert.match(error.message, /returned an error/);
      return true;
    }
  );
});

test('a non-2xx response without an envelope is an HTTP error', async () => {
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example',
    fetchImpl: fakeFetch('not json', { status: 502 }),
  });

  await assert.rejects(
    () => client.investigateMerchant(request),
    (error: unknown) => {
      assert.ok(error instanceof GuardianApiError);
      assert.equal(error.code, 'BAD_RESPONSE');
      return true;
    }
  );
});

test('a 500 with a JSON body that is not an envelope is an HTTP error', async () => {
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example',
    fetchImpl: fakeFetch({ message: 'oops' }, { status: 500 }),
  });

  await assert.rejects(
    () => client.investigateMerchant(request),
    (error: unknown) => {
      assert.ok(error instanceof GuardianApiError);
      assert.equal(error.code, 'HTTP_ERROR');
      return true;
    }
  );
});

test('a network failure becomes UPSTREAM_ERROR', async () => {
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example',
    fetchImpl: (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch,
  });

  await assert.rejects(
    () => client.investigateMerchant(request),
    (error: unknown) => {
      assert.ok(error instanceof GuardianApiError);
      assert.equal(error.code, 'UPSTREAM_ERROR');
      assert.match(error.message, /Could not reach/);
      return true;
    }
  );
});

test('a stalled request is aborted and becomes UPSTREAM_TIMEOUT', async () => {
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example',
    requestTimeoutMs: 20,
    fetchImpl: ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch,
  });

  await assert.rejects(
    () => client.investigateMerchant(request),
    (error: unknown) => {
      assert.ok(error instanceof GuardianApiError);
      assert.equal(error.code, 'UPSTREAM_TIMEOUT');
      assert.match(error.message, /timed out/);
      return true;
    }
  );
});

test('checkout, finalize and policy calls use the documented routes', async () => {
  const captured: Captured[] = [];
  const client = new GuardianApiClient({
    baseUrl: 'https://guardian.example',
    apiKey: 'key',
    fetchImpl: fakeFetch(
      { success: true, data: { status: 'CAPTURED' }, meta: {} },
      { capture: captured }
    ),
  });

  await client.createCheckout({
    merchantUrl: 'https://shop.example',
    amount: 10,
    currency: 'USD',
    merchantId: 'm-1',
  });
  await client.finalizeCheckout('chk-1', { humanDecision: 'proceed' });
  await client.setSpendPolicy('agent-1', {
    perOrderCap: 10,
    dailyCap: 20,
    currency: 'USD',
  });

  assert.equal(captured[0].url, 'https://guardian.example/api/v1/checkout/orders');
  assert.equal(
    captured[1].url,
    'https://guardian.example/api/v1/checkout/orders/chk-1/finalize'
  );
  assert.equal(captured[2].url, 'https://guardian.example/api/v1/policies/agent-1');
  assert.equal(captured[2].method, 'PUT');
});
