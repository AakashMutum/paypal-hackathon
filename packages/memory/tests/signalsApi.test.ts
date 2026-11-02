import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lookupPriorSignals,
  saveInvestigation,
  InMemoryMemoryStore,
  setDefaultMemoryStore,
  HISTORICAL_INDICATORS_NOTE,
} from '../src/index.js';

test('lookupPriorSignals returns prior matches, block count, evidence types, and required disclaimer note', async () => {
  const store = new InMemoryMemoryStore();
  setDefaultMemoryStore(store);

  // Seed store with prior investigations
  await saveInvestigation(
    {
      investigationId: 'inv-prior-1',
      domain: 'outlet-mall.example.com',
      claimedBrand: 'Solaria Couture',
      payeeMerchantId: 'M-OUTLET-99',
      payeeEmail: 'billing@outlet-mall.example.com',
      riskScore: 78.5,
      decision: 'PAUSE',
      flaggedEvidenceTypes: ['MERCHANT_MISMATCH', 'PRICING_ANOMALY'],
      timestamp: '2026-11-01T10:00:00Z',
    },
    store,
  );

  await saveInvestigation(
    {
      investigationId: 'inv-prior-2',
      domain: 'outlet-mall.example.com',
      claimedBrand: 'Solaria Couture',
      payeeMerchantId: 'M-OUTLET-99',
      payeeEmail: 'billing@outlet-mall.example.com',
      riskScore: 62.0,
      decision: 'WARN',
      flaggedEvidenceTypes: ['PRICING_ANOMALY', 'SSL_TECHNICAL'],
      timestamp: '2026-11-01T12:00:00Z',
    },
    store,
  );

  await saveInvestigation(
    {
      investigationId: 'inv-prior-3',
      domain: 'outlet-mall.example.com',
      claimedBrand: 'Solaria Couture',
      payeeMerchantId: 'M-OUTLET-99',
      payeeEmail: 'billing@outlet-mall.example.com',
      riskScore: 20.0,
      decision: 'ALLOW',
      flaggedEvidenceTypes: [],
      timestamp: '2026-11-01T14:00:00Z',
    },
    store,
  );

  const result = await lookupPriorSignals(
    'https://OUTLET-MALL.EXAMPLE.COM/checkout',
    'M-OUTLET-99',
    'billing@outlet-mall.example.com',
    store,
  );

  // Assert match count
  assert.equal(result.priorMatches, 3);

  // Assert block/pause count
  assert.equal(result.priorBlockCount, 1);

  // Assert flagged evidence types (PRICING_ANOMALY was most common)
  assert.ok(result.evidenceTypes.includes('PRICING_ANOMALY'));
  assert.ok(result.evidenceTypes.includes('MERCHANT_MISMATCH'));
  assert.ok(result.evidenceTypes.includes('SSL_TECHNICAL'));

  // Mandatory note verification: must state that these are historical indicators, not proof
  assert.match(result.note.toLowerCase(), /these are historical indicators, not proof/);
  assert.equal(result.note, HISTORICAL_INDICATORS_NOTE);
});

test('lookupPriorSignals returns clean zero baseline when all query parameters are empty', async () => {
  const store = new InMemoryMemoryStore();
  const result = await lookupPriorSignals(undefined, undefined, undefined, store);

  assert.equal(result.priorMatches, 0);
  assert.equal(result.priorBlockCount, 0);
  assert.deepEqual(result.evidenceTypes, []);
  assert.match(result.note.toLowerCase(), /these are historical indicators, not proof/);
});

test('saveInvestigation strips PII before saving to store', async () => {
  const store = new InMemoryMemoryStore();

  const saved = await saveInvestigation(
    {
      investigationId: 'inv-save-pii',
      domain: 'clean-store.com',
      claimedBrand: 'Puma',
      payeeMerchantId: 'M-PUMA-1',
      payeeEmail: 'orders@clean-store.com',
      riskScore: 15.0,
      decision: 'ALLOW',
      flaggedEvidenceTypes: [],
      timestamp: '2026-11-02T11:00:00Z',

      // Contaminating customer PII
      customerName: 'Secret Customer',
      cardNumber: '5500000000000004',
      cvv: '123',
      shippingAddress: '789 Secret Blvd',
      billingAddress: 'PO Box 999',
    },
    store,
  );

  assert.equal(saved.investigationId, 'inv-save-pii');
  assert.equal((saved as unknown as Record<string, unknown>).customerName, undefined);
  assert.equal((saved as unknown as Record<string, unknown>).cardNumber, undefined);
  assert.equal((saved as unknown as Record<string, unknown>).cvv, undefined);
  assert.equal((saved as unknown as Record<string, unknown>).shippingAddress, undefined);
  assert.equal((saved as unknown as Record<string, unknown>).billingAddress, undefined);

  // Verify retrieval from store also has no PII
  const records = await store.findByDomain('clean-store.com');
  assert.equal(records.length, 1);
  assert.equal((records[0] as unknown as Record<string, unknown>).customerName, undefined);
});
