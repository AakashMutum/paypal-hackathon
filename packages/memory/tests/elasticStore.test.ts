import test from 'node:test';
import assert from 'node:assert/strict';
import type { Client } from '@elastic/elasticsearch';
import {
  ElasticMemoryStore,
  ELASTIC_MEMORY_MAPPING,
  type HistoricalRecord,
} from '../src/index.js';

function createMockElasticClient(options: {
  indexExists?: boolean;
  searchHits?: Array<{ _source: HistoricalRecord }>;
} = {}) {
  const calls: {
    exists: Array<Record<string, unknown>>;
    create: Array<Record<string, unknown>>;
    index: Array<Record<string, unknown>>;
    search: Array<Record<string, unknown>>;
  } = {
    exists: [],
    create: [],
    index: [],
    search: [],
  };

  const mockClient = {
    indices: {
      exists: async (args: Record<string, unknown>) => {
        calls.exists.push(args);
        return options.indexExists ?? false;
      },
      create: async (args: Record<string, unknown>) => {
        calls.create.push(args);
        return { acknowledged: true };
      },
    },
    index: async (args: Record<string, unknown>) => {
      calls.index.push(args);
      return { result: 'created' };
    },
    search: async (args: Record<string, unknown>) => {
      calls.search.push(args);
      return {
        hits: {
          hits: options.searchHits ?? [],
        },
      };
    },
    close: async () => {},
  } as unknown as Client;

  return { mockClient, calls };
}

test('ElasticMemoryStore creates index with mapping if missing', async () => {
  const { mockClient, calls } = createMockElasticClient({ indexExists: false });
  const store = new ElasticMemoryStore({
    client: mockClient,
    indexName: 'test-guardian-memory',
  });

  await store.ensureIndex();

  assert.equal(calls.exists.length, 1);
  assert.equal(calls.exists[0].index, 'test-guardian-memory');
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].index, 'test-guardian-memory');
  assert.deepEqual(calls.create[0].mappings, ELASTIC_MEMORY_MAPPING);
});

test('ElasticMemoryStore sanitizes PII before calling client.index', async () => {
  const { mockClient, calls } = createMockElasticClient({ indexExists: true });
  const store = new ElasticMemoryStore({
    client: mockClient,
    indexName: 'test-guardian-memory',
  });

  const raw = {
    investigationId: 'inv-elastic-pii',
    domain: 'HTTPS://SHOP.TEST-STORE.COM',
    claimedBrand: 'Apple',
    payeeMerchantId: 'M-APPLE-99',
    payeeEmail: 'SUPPORT@Test-Store.com',
    riskScore: 35.5,
    decision: 'ALLOW',
    flaggedEvidenceTypes: [],
    timestamp: '2026-11-02T10:00:00Z',

    // PII
    customerName: 'Eve Hacker',
    cardNumber: '4242424242424242',
    cvv: '999',
  };

  const result = await store.indexInvestigation(raw);

  assert.equal(calls.index.length, 1);
  const indexedDoc = calls.index[0].document as Record<string, unknown>;

  // PII must not be in the indexed document
  assert.equal(indexedDoc.customerName, undefined);
  assert.equal(indexedDoc.cardNumber, undefined);
  assert.equal(indexedDoc.cvv, undefined);

  // Normalized fields
  assert.equal(indexedDoc.domain, 'shop.test-store.com');
  assert.equal(indexedDoc.payeeEmail, 'support@test-store.com');
  assert.equal(result.investigationId, 'inv-elastic-pii');
});

test('ElasticMemoryStore findByDomain and getHistorySummary query Elasticsearch', async () => {
  const sampleHit: HistoricalRecord = {
    investigationId: 'inv-hit-1',
    domain: 'target-store.com',
    claimedBrand: 'Target',
    payeeMerchantId: 'M-TARGET',
    payeeEmail: 'pay@target-store.com',
    riskScore: 78.0,
    decision: 'PAUSE',
    flaggedEvidenceTypes: ['MERCHANT_MISMATCH', 'PRICING_ANOMALY'],
    timestamp: '2026-11-02T10:00:00.000Z',
  };

  const { mockClient, calls } = createMockElasticClient({
    indexExists: true,
    searchHits: [{ _source: sampleHit }],
  });

  const store = new ElasticMemoryStore({
    client: mockClient,
    indexName: 'test-guardian-memory',
  });

  const byDomain = await store.findByDomain('https://TARGET-STORE.COM/checkout');
  assert.equal(byDomain.length, 1);
  assert.equal(byDomain[0].investigationId, 'inv-hit-1');
  assert.equal(calls.search.length, 1);

  const summary = await store.getHistorySummary('target-store.com');
  assert.equal(summary.totalCount, 1);
  assert.equal(summary.blockCount, 1);
  assert.equal(summary.commonFlaggedEvidenceTypes.length, 2);
});

