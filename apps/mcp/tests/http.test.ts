import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { repoRoot } from './helpers.js';

let child: ReturnType<typeof spawn> | undefined;
let baseUrl = '';

const BEARER = 'test-bearer-token';

function environment(port: number): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return {
    ...env,
    MCP_TRANSPORT: 'http',
    MCP_PORT: String(port),
    MCP_BEARER_TOKEN: BEARER,
    GUARDIAN_API_URL: 'http://127.0.0.1:1',
  };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as AddressInfo;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  return address.port;
}

async function waitUntilReady(url: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    try {
      const response = await fetch(url, { method: 'POST' });
      if (response.status === 401) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('HTTP MCP server did not become ready');
}

before(async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/mcp`;

  child = spawn(process.execPath, ['--import', 'tsx', 'apps/mcp/src/index.ts'], {
    cwd: repoRoot,
    env: environment(port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitUntilReady(baseUrl);
});

after(async () => {
  if (!child) return;
  const running = child;
  await new Promise<void>((resolve) => {
    running.once('close', () => resolve());
    running.kill();
  });
});

test('HTTP transport rejects a missing bearer token without CORS headers', async () => {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

  assert.equal(response.status, 401);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('HTTP transport rejects preflight instead of enabling CORS', async () => {
  const response = await fetch(baseUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://evil.example',
      'Access-Control-Request-Method': 'POST',
      Authorization: `Bearer ${BEARER}`,
    },
  });

  assert.equal(response.status, 405);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('HTTP transport returns 404 outside the MCP route', async () => {
  const root = new URL('/', baseUrl).toString();
  const response = await fetch(root, { method: 'GET' });
  assert.equal(response.status, 404);
});

test('HTTP transport rejects invalid JSON with a bearer token', async () => {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BEARER}`,
    },
    body: '{not json',
  });

  assert.equal(response.status, 400);
});

test('HTTP transport rejects bodies over 100 kB', async () => {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BEARER}`,
    },
    body: `"${'x'.repeat(101 * 1024)}"`,
  });

  assert.equal(response.status, 413);
});

test('HTTP transport completes an authenticated initialize handshake', async () => {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${BEARER}`,
  };

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'http-test', version: '1.0.0' },
      },
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);

  const body = (await response.json()) as {
    jsonrpc?: string;
    id?: unknown;
    result?: { serverInfo?: { name?: string } };
  };
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 1);
  assert.equal(body.result?.serverInfo?.name, 'checkout-guardian');

  await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });

  const listed = await fetch(baseUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });

  assert.equal(listed.status, 200);
  const listBody = (await listed.json()) as {
    result?: { tools?: Array<{ name: string }> };
  };
  assert.deepEqual(
    listBody.result?.tools?.map((tool) => tool.name).sort(),
    ['investigate_merchant', 'safe_checkout', 'set_spend_policy']
  );
});
