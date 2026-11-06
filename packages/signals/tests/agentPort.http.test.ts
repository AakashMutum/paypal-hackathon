import assert from 'node:assert/strict';
import test from 'node:test';
import { MERCHANT_FETCH_USER_AGENT, safeGet } from '../src/agentPort/http.js';

const lookup = async (): Promise<string[]> => ['93.184.216.34'];

function queueFetch(entries: Array<Response | Error>, seen: string[] = [], headers: string[] = []): typeof fetch {
  let index = 0;
  return (async (input: string | URL, init?: RequestInit) => {
    seen.push(String(input));
    const agent = (init?.headers as Record<string, string> | undefined)?.['user-agent'];
    if (agent) headers.push(agent);
    const entry = entries[Math.min(index, entries.length - 1)];
    index += 1;
    if (entry instanceof Error) throw entry;
    return entry;
  }) as unknown as typeof fetch;
}

const options = (fetchImpl: typeof fetch) => ({
  fetchImpl,
  lookup,
  timeoutMs: 2000,
  retryDelayMs: 0,
});

test('a transient 5xx is retried and the successful response is returned', async () => {
  const seen: string[] = [];
  const fetchImpl = queueFetch([new Response('busy', { status: 503 }), new Response('<p>ok</p>', { status: 200 })], seen);
  const result = await safeGet('https://shop.example/', options(fetchImpl));
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.text, '<p>ok</p>');
  assert.equal(seen.length, 2);
});

test('a 403 block is never retried', async () => {
  const seen: string[] = [];
  const fetchImpl = queueFetch([new Response('denied', { status: 403 }), new Response('ok', { status: 200 })], seen);
  const result = await safeGet('https://shop.example/', options(fetchImpl));
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(seen.length, 1);
});

test('a 429 is retried a bounded number of times', async () => {
  const seen: string[] = [];
  const fetchImpl = queueFetch([new Response('slow down', { status: 429 })], seen);
  const result = await safeGet('https://shop.example/', { ...options(fetchImpl), maxRetries: 1 });
  assert.equal(result.status, 429);
  assert.equal(seen.length, 2);

  const noRetrySeen: string[] = [];
  const noRetry = queueFetch([new Response('slow down', { status: 429 })], noRetrySeen);
  const limited = await safeGet('https://shop.example/', { ...options(noRetry), maxRetries: 0 });
  assert.equal(limited.status, 429);
  assert.equal(noRetrySeen.length, 1);
});

test('a transient network error is retried, then a permanent one is thrown', async () => {
  const seen: string[] = [];
  const fetchImpl = queueFetch([new Error('connection reset'), new Response('ok', { status: 200 })], seen);
  const result = await safeGet('https://shop.example/', options(fetchImpl));
  assert.equal(result.ok, true);
  assert.equal(seen.length, 2);

  const failing = queueFetch([new Error('connection reset')]);
  await assert.rejects(() => safeGet('https://shop.example/', { ...options(failing), maxRetries: 0 }), /connection reset/);
});

test('redirects still follow and the request identifies the verifier honestly', async () => {
  const seen: string[] = [];
  const headers: string[] = [];
  const fetchImpl = queueFetch(
    [new Response(null, { status: 302, headers: { location: 'https://shop.example/next' } }), new Response('ok', { status: 200 })],
    seen,
    headers,
  );
  const result = await safeGet('https://shop.example/', options(fetchImpl));
  assert.equal(result.finalUrl, 'https://shop.example/next');
  assert.equal(result.ok, true);
  assert.equal(seen.length, 2);
  assert.ok(headers.length >= 2);
  assert.ok(headers.every((value) => value === MERCHANT_FETCH_USER_AGENT));
});
