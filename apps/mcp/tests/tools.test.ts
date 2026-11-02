import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

import { MAX_TOOL_TEXT } from '../src/format.js';
import {
  startClient,
  startMockBackend,
  textOf,
  type MockBackend,
  type SpawnedClient,
} from './helpers.js';

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

let backend: MockBackend;
let spawned: SpawnedClient;

before(async () => {
  backend = await startMockBackend();
  spawned = await startClient({
    GUARDIAN_API_URL: backend.url,
    GUARDIAN_API_KEY: 'test-key',
  });
});

after(async () => {
  await spawned.close();
  await backend.close();
});

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await spawned.client.callTool({
    name,
    arguments: args,
  })) as unknown as ToolResult;
}

function structured(result: ToolResult): Record<string, unknown> {
  assert.ok(result.structuredContent, 'expected structured content');
  return result.structuredContent;
}

test('investigate_merchant returns an ALLOW verdict with evidence citations', async () => {
  const before = backend.requests.length;
  const result = await call('investigate_merchant', {
    merchantUrl: 'https://shop.example',
    amount: 19.99,
    currency: 'usd',
  });

  assert.notEqual(result.isError, true);
  const text = textOf(result);
  assert.match(text, /Decision: ALLOW — 5\/100/);
  assert.match(text, /confidence 0\.99/);
  assert.match(text, /EVD-SIG-AGE-01/);
  assert.match(text, /proceed with the purchase/i);
  assert.ok(text.length <= MAX_TOOL_TEXT);

  const verdict = structured(result).verdict as Record<string, unknown>;
  assert.equal(verdict.decision, 'ALLOW');

  const request = backend.requests.slice(before).at(-1);
  assert.equal(request?.path, '/api/v1/investigations');
  assert.equal(request?.authorization, 'Bearer test-key');
  assert.equal(request?.body.currency, 'USD');
  assert.equal(request?.body.transactionAmount, 19.99);
});

test('investigate_merchant shows at most four reasons and six checks', async () => {
  const result = await call('investigate_merchant', {
    merchantUrl: 'https://warn.example',
    merchantId: 'm-1',
  });

  assert.notEqual(result.isError, true);
  const text = textOf(result);
  assert.match(text, /Decision: WARN — 61\/100/);
  assert.match(text, /The seller uses a free email address\./);
  assert.doesNotMatch(text, /This fifth reason must be trimmed/);
  assert.doesNotMatch(text, /tool_7/);
  assert.match(text, /EVD-SIG-DAYS-01/);
  assert.match(text, /ask the buyer before paying/i);
  assert.ok(text.length <= MAX_TOOL_TEXT);
});

test('investigate_merchant surfaces a PAUSE and tells the caller to stop', async () => {
  const result = await call('investigate_merchant', {
    merchantUrl: 'https://pause.example',
  });

  const text = textOf(result);
  assert.match(text, /Decision: PAUSE — 94\/100/);
  assert.match(text, /do not pay/i);
});

test('a backend error envelope becomes a readable tool error', async () => {
  const result = await call('investigate_merchant', {
    merchantUrl: 'https://error.example',
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /timed out\. Nothing was charged/i);
  const error = structured(result).error as Record<string, unknown>;
  assert.equal(error.code, 'UPSTREAM_TIMEOUT');
});

test('a slow backend is cut off by the request timeout', async () => {
  const slow = await startClient({
    GUARDIAN_API_URL: backend.url,
    GUARDIAN_REQUEST_TIMEOUT_MS: '20',
  });

  try {
    const result = (await slow.client.callTool({
      name: 'investigate_merchant',
      arguments: { merchantUrl: 'https://slow.example' },
    })) as unknown as ToolResult;

    assert.equal(result.isError, true);
    assert.match(textOf(result), /timed out\. Nothing was charged/i);
  } finally {
    await slow.close();
  }
});

test('an unreachable backend produces a readable error quickly', async () => {
  const down = await startClient({
    GUARDIAN_API_URL: 'http://127.0.0.1:1',
    GUARDIAN_REQUEST_TIMEOUT_MS: '300',
  });

  try {
    const started = Date.now();
    const result = (await down.client.callTool({
      name: 'investigate_merchant',
      arguments: { merchantUrl: 'https://shop.example' },
    })) as unknown as ToolResult;

    assert.equal(result.isError, true);
    assert.match(textOf(result), /Could not reach the guardian service/i);
    assert.ok(Date.now() - started < 2_000);
  } finally {
    await down.close();
  }
});

test('an unsafe merchant URL is rejected before any HTTP call', async () => {
  const before = backend.requests.length;

  const loopback = await call('investigate_merchant', {
    merchantUrl: 'http://localhost/checkout',
  });
  const privateIp = await call('safe_checkout', {
    merchantUrl: 'http://10.0.0.5/pay',
    amount: 10,
    currency: 'USD',
    merchantId: 'm-1',
  });

  assert.equal(loopback.isError, true);
  assert.equal(privateIp.isError, true);
  assert.equal(backend.requests.length, before);
});

test('missing or malformed input is rejected before any HTTP call', async () => {
  const before = backend.requests.length;

  const missingUrl = await call('investigate_merchant', {});
  const badPolicy = await call('set_spend_policy', {
    agentId: 'agent-1',
    perOrderCap: 500,
    dailyCap: 100,
    currency: 'USD',
  });
  const badAgent = await call('set_spend_policy', {
    agentId: '../escape',
    perOrderCap: 10,
    dailyCap: 100,
    currency: 'USD',
  });

  assert.equal(missingUrl.isError, true);
  assert.equal(badPolicy.isError, true);
  assert.equal(badAgent.isError, true);
  assert.equal(backend.requests.length, before);
});

test('safe_checkout creates a held order and reports CAPTURED', async () => {
  const before = backend.requests.length;
  const result = await call('safe_checkout', {
    merchantUrl: 'https://captured.example',
    amount: 120,
    currency: 'usd',
    merchantId: 'merchant-1',
    payeeEmail: 'seller@captured.example',
  });

  assert.notEqual(result.isError, true);
  const text = textOf(result);
  assert.match(text, /Checkout: CAPTURED/);
  assert.match(text, /Decision: ALLOW/);
  assert.match(text, /purchase completed/i);
  assert.ok(text.length <= MAX_TOOL_TEXT);

  const payload = structured(result);
  assert.equal((payload.checkout as Record<string, unknown>).status, 'AWAITING_APPROVAL');
  assert.equal((payload.result as Record<string, unknown>).status, 'CAPTURED');

  const requests = backend.requests.slice(before);
  assert.equal(requests[0].path, '/api/v1/checkout/orders');
  assert.equal(requests[0].body.currency, 'USD');
  assert.equal(requests[1].path, '/api/v1/checkout/orders/chk-captured/finalize');
});

test('a WARN checkout stops for a human decision', async () => {
  const result = await call('safe_checkout', {
    merchantUrl: 'https://warn.example',
    amount: 120,
    currency: 'USD',
    merchantId: 'merchant-1',
  });

  const text = textOf(result);
  assert.match(text, /Checkout: NEEDS_HUMAN_DECISION/);
  assert.match(text, /ask the buyer/i);
  assert.equal(
    (structured(result).result as Record<string, unknown>).status,
    'NEEDS_HUMAN_DECISION'
  );
});

test('a WARN checkout proceeds only when the human says proceed', async () => {
  const result = await call('safe_checkout', {
    merchantUrl: 'https://warn.example',
    amount: 120,
    currency: 'USD',
    merchantId: 'merchant-1',
    humanDecision: 'proceed',
  });

  assert.match(textOf(result), /Checkout: CAPTURED/);
  assert.equal((structured(result).result as Record<string, unknown>).status, 'CAPTURED');
});

test('phase=create holds an order without finalizing it', async () => {
  const before = backend.requests.length;
  const result = await call('safe_checkout', {
    phase: 'create',
    merchantUrl: 'https://captured.example',
    amount: 120,
    currency: 'USD',
    merchantId: 'merchant-1',
  });

  assert.notEqual(result.isError, true);
  assert.match(textOf(result), /Checkout: AWAITING_APPROVAL/);
  const checkout = structured(result).checkout as Record<string, unknown>;
  assert.equal(checkout.status, 'AWAITING_APPROVAL');
  assert.equal(checkout.checkoutId, 'chk-captured');

  const requests = backend.requests.slice(before);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/v1/checkout/orders');
});

test('phase=create followed by phase=finalize captures the same order', async () => {
  const before = backend.requests.length;
  const created = await call('safe_checkout', {
    phase: 'create',
    merchantUrl: 'https://warn.example',
    amount: 120,
    currency: 'USD',
    merchantId: 'merchant-1',
  });
  const checkoutId = (structured(created).checkout as Record<string, unknown>)
    .checkoutId as string;

  const finalized = await call('safe_checkout', {
    phase: 'finalize',
    checkoutId,
    humanDecision: 'proceed',
  });

  assert.match(textOf(finalized), /Checkout: CAPTURED/);
  const requests = backend.requests.slice(before);
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      '/api/v1/checkout/orders',
      `/api/v1/checkout/orders/${checkoutId}/finalize`,
    ]
  );
});

test('phase=finalize requires a checkout id before HTTP', async () => {
  const before = backend.requests.length;
  const result = await call('safe_checkout', {
    phase: 'finalize',
    humanDecision: 'proceed',
  });

  assert.equal(result.isError, true);
  assert.equal(backend.requests.length, before);
});

test('an existing held order can be finalized without creating another one', async () => {
  const before = backend.requests.length;
  const result = await call('safe_checkout', {
    checkoutId: 'chk-human',
    humanDecision: 'proceed',
  });

  assert.match(textOf(result), /Checkout: CAPTURED/);
  assert.equal((structured(result).result as Record<string, unknown>).status, 'CAPTURED');

  const requests = backend.requests.slice(before);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/api/v1/checkout/orders/chk-human/finalize');
  assert.equal(requests[0].body.humanDecision, 'proceed');
});

test('creating a checkout requires the merchant details even before HTTP', async () => {
  const before = backend.requests.length;
  const result = await call('safe_checkout', {
    merchantUrl: 'https://captured.example',
  });

  assert.equal(result.isError, true);
  assert.equal(backend.requests.length, before);
});

test('a PAUSE checkout never reports a capture', async () => {
  const result = await call('safe_checkout', {
    merchantUrl: 'https://pause.example',
    amount: 120,
    currency: 'USD',
    merchantId: 'merchant-1',
    humanDecision: 'proceed',
  });

  const text = textOf(result);
  assert.match(text, /Checkout: PAUSED/);
  assert.match(text, /do not pay/i);
  assert.doesNotMatch(text, /purchase completed/i);
  assert.equal((structured(result).result as Record<string, unknown>).status, 'PAUSED');
});

test('a policy violation becomes a readable tool error', async () => {
  const result = await call('safe_checkout', {
    merchantUrl: 'https://policy.example',
    amount: 999,
    currency: 'USD',
    merchantId: 'merchant-1',
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /outside the agent spending policy/i);
  assert.equal(
    (structured(result).error as Record<string, unknown>).code,
    'POLICY_VIOLATION'
  );
});

test('a create response without a checkout id is a readable error', async () => {
  const result = await call('safe_checkout', {
    merchantUrl: 'https://badbody.example',
    amount: 10,
    currency: 'USD',
    merchantId: 'merchant-1',
  });

  assert.equal(result.isError, true);
  assert.match(textOf(result), /unreadable response/i);
});

test('set_spend_policy sends the caps and formats the saved policy', async () => {
  const before = backend.requests.length;
  const result = await call('set_spend_policy', {
    agentId: 'agent-1',
    perOrderCap: 100,
    dailyCap: 500,
    firstPurchaseCap: 50,
    currency: 'usd',
  });

  assert.notEqual(result.isError, true);
  const text = textOf(result);
  assert.match(text, /Spend policy saved for agent-1/);
  assert.match(text, /Per order: USD 100\.00/);
  assert.match(text, /Daily: USD 500\.00/);
  assert.match(text, /First purchase: USD 50\.00/);
  assert.ok(text.length <= MAX_TOOL_TEXT);

  const request = backend.requests.slice(before).at(-1);
  assert.equal(request?.method, 'PUT');
  assert.equal(request?.path, '/api/v1/policies/agent-1');
  assert.equal(request?.body.currency, 'USD');
  assert.equal(request?.body.perOrderCap, 100);
});
