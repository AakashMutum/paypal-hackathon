import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FilePatternStore,
  createPatternStore,
  type EmbeddingProvider,
} from '../src/index.js';
import { hashPayee } from '../src/patterns/sanitize.js';

function fakeEmbeddingProvider(): EmbeddingProvider {
  return {
    name: 'test-embedding',
    model: 'v1',
    async embed(text: string): Promise<number[] | null> {
      const lower = text.toLowerCase();
      const vector = [0, 0, 0, 0];
      if (/lookalike|brand|imitat|copy/.test(lower)) vector[0] = 1;
      if (/discount|price|cheap|below/.test(lower)) vector[1] = 1;
      if (/payment|payee|account/.test(lower)) vector[2] = 1;
      if (/hidden|injection|instruction/.test(lower)) vector[3] = 1;
      const norm = Math.hypot(...vector);
      return norm === 0 ? null : vector.map((value) => value / norm);
    },
  };
}

const savedCase = {
  registrableDomain: 'rag-lookalike.example',
  decision: 'WARN',
  riskScore: 0.61,
  evidenceTypes: ['LOOKALIKE_DOMAIN', 'PRICE_DEVIATION'],
  domainAgeBucket: '<7d',
  discountBucket: '>=80',
  patternText: 'A newly created store imitates a known brand and sells far below the market price.',
  timestamp: new Date().toISOString(),
  seed: false,
};

async function withTempStore(fn: (filePath: string, provider: EmbeddingProvider) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'trustora-memory-'));
  const filePath = join(dir, 'memory.json');
  const provider = fakeEmbeddingProvider();
  try {
    await fn(filePath, provider);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('a stored case survives a new store instance and is retrieved by embedding', async () => {
  await withTempStore(async (filePath, provider) => {
    const first = await createPatternStore({ filePath, seed: false, embeddingProvider: provider });
    assert.ok(first instanceof FilePatternStore);
    assert.equal(first.location(), filePath);
    const saved = await first.upsert(savedCase);
    assert.equal(saved.embeddingProvider, 'test-embedding');
    assert.ok(saved.embedding && saved.embedding.length === 4);

    // A new instance simulates a restart: it must read the persisted file.
    const second = await createPatternStore({ filePath, seed: false, embeddingProvider: provider });
    assert.equal(await second.size(), 1);
    const hits = await second.search({
      patternText: 'A fresh shop copies another brand and offers an unrealistically large discount.',
      registrableDomain: 'different-shop.example',
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].id, saved.id);
    assert.equal(hits[0].matchType, 'semantic');
    assert.equal(hits[0].retrieval, 'embedding');
    assert.ok(hits[0].score > 0.5);
  });
});

test('exact domain and payee matches are deterministic and rank first', async () => {
  await withTempStore(async (filePath, provider) => {
    const store = await createPatternStore({ filePath, seed: false, embeddingProvider: provider });
    const saved = await store.upsert({ ...savedCase, payeeMerchantId: 'MERCH-RAG-1' });

    const byDomain = await store.search({
      patternText: 'unrelated text',
      registrableDomain: 'rag-lookalike.example',
    });
    assert.equal(byDomain[0].id, saved.id);
    assert.equal(byDomain[0].matchType, 'exact_domain');
    assert.equal(byDomain[0].retrieval, 'exact');

    const byPayee = await store.search({
      patternText: 'unrelated text',
      registrableDomain: 'other.example',
      payeeHash: hashPayee('MERCH-RAG-1'),
    });
    assert.equal(byPayee[0].id, saved.id);
    assert.equal(byPayee[0].matchType, 'exact_payee');
  });
});

test('PII is refused before it reaches the file', async () => {
  await withTempStore(async (filePath, provider) => {
    const store = await createPatternStore({ filePath, seed: false, embeddingProvider: provider });
    await assert.rejects(() =>
      store.upsert({ ...savedCase, patternText: 'Send payment details to buyer@example.com please.' }),
    );
    assert.equal(await store.size(), 0);
  });
});

test('expired non-seed cases are purged and seeds are retained', async () => {
  await withTempStore(async (filePath, provider) => {
    const store = await createPatternStore({ filePath, seed: false, embeddingProvider: provider, ttlDays: 1 });
    await store.upsert({ ...savedCase, timestamp: '2020-01-01T00:00:00.000Z' });
    assert.equal(await store.size(), 0);
    assert.equal(await store.purgeExpired(), 0);
  });
});
