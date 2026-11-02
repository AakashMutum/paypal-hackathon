import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@elastic/elasticsearch';
import { createMemoryStore, InMemoryMemoryStore, ElasticMemoryStore } from '../src/index.js';

test('createMemoryStore falls back to InMemoryMemoryStore when ELASTIC_NODE is missing', async () => {
  const originalNode = process.env.ELASTIC_NODE;
  delete process.env.ELASTIC_NODE;

  const warnings: string[] = [];
  const logger = {
    warn: (msg: string) => warnings.push(msg),
  };

  try {
    const store = await createMemoryStore({ logger });
    assert.ok(store instanceof InMemoryMemoryStore);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ELASTIC_NODE environment variable is missing/);
  } finally {
    if (originalNode !== undefined) {
      process.env.ELASTIC_NODE = originalNode;
    }
  }
});

test('createMemoryStore falls back to InMemoryMemoryStore when Elastic ping fails', async () => {
  const warnings: string[] = [];
  const logger = {
    warn: (msg: string) => warnings.push(msg),
  };

  // Mock a client where ping fails
  const mockFailingClient = {
    ping: async () => {
      throw new Error('Connection refused at 127.0.0.1:9200');
    },
    indices: {
      exists: async () => false,
      create: async () => ({ acknowledged: true }),
    },
    close: async () => {},
  } as unknown as Client;

  const store = await createMemoryStore({
    client: mockFailingClient,
    logger,
    timeoutMs: 100,
  });

  assert.ok(store instanceof InMemoryMemoryStore);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Connection refused/);
});

test('createMemoryStore falls back to InMemoryMemoryStore when Elastic ping times out', async () => {
  const warnings: string[] = [];
  const logger = {
    warn: (msg: string) => warnings.push(msg),
  };

  // Mock a client where ping hangs
  const mockHangingClient = {
    ping: () => new Promise<boolean>(() => {}), // never resolves
    indices: {
      exists: async () => false,
      create: async () => ({ acknowledged: true }),
    },
    close: async () => {},
  } as unknown as Client;

  const store = await createMemoryStore({
    client: mockHangingClient,
    logger,
    timeoutMs: 50,
  });

  assert.ok(store instanceof InMemoryMemoryStore);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /timed out/);
});

test('createMemoryStore returns ElasticMemoryStore when Elastic ping succeeds', async () => {
  const mockSuccessfulClient = {
    ping: async () => true,
    indices: {
      exists: async () => true,
      create: async () => ({ acknowledged: true }),
    },
    close: async () => {},
  } as unknown as Client;

  const store = await createMemoryStore({
    client: mockSuccessfulClient,
    indexName: 'test-index',
    timeoutMs: 500,
  });

  assert.ok(store instanceof ElasticMemoryStore);
});
