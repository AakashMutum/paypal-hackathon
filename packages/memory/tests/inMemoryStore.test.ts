import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryMemoryStore } from '../src/index.js';

test('InMemoryMemoryStore sanitizes PII before indexing', async () => {
  const store = new InMemoryMemoryStore();

  const rawInput = {
    investigationId: 'inv-pii-check',
    domain: 'HTTPS://Luxury-Watches.com/shop',
    claimedBrand: 'Omega',
    payeeMerchantId: 'M-12345',
    payeeEmail: 'SALES@Luxury-Watches.com',
    riskScore: 78.4,
    decision: 'PAUSE',
    flaggedEvidenceTypes: ['MERCHANT_MISMATCH'],
    timestamp: '2026-11-02T09:00:00Z',

    // PII that should be stripped
    customerName: 'Alice Secret',
    cardNumber: '4111111111111111',
    cvv: '123',
    shippingAddress: '123 Mystery Ln',
  };

  const stored = await store.indexInvestigation(rawInput);

  assert.equal((stored as unknown as Record<string, unknown>).customerName, undefined);
  assert.equal((stored as unknown as Record<string, unknown>).cardNumber, undefined);
  assert.equal(stored.domain, 'luxury-watches.com');
  assert.equal(stored.payeeEmail, 'sales@luxury-watches.com');

  const fetched = await store.findByDomain('luxury-watches.com');
  assert.equal(fetched.length, 1);
  assert.equal((fetched[0] as unknown as Record<string, unknown>).customerName, undefined);
  assert.equal(fetched[0].investigationId, 'inv-pii-check');
});

test('InMemoryMemoryStore find methods work with normalization', async () => {
  const store = new InMemoryMemoryStore();

  await store.indexInvestigation({
    investigationId: 'inv-1',
    domain: 'shoes.example.com',
    claimedBrand: 'Veloce Athletics',
    payeeMerchantId: 'MERCHANT-VELOCE-US',
    payeeEmail: 'payee@shoes.example.com',
    riskScore: 12.0,
    decision: 'ALLOW',
    flaggedEvidenceTypes: [],
    timestamp: '2026-11-01T10:00:00Z',
  });

  await store.indexInvestigation({
    investigationId: 'inv-2',
    domain: 'outlet-shoes.example.com',
    claimedBrand: 'Veloce Athletics',
    payeeMerchantId: 'MERCHANT-VELOCE-US',
    payeeEmail: 'secondary@shoes.example.com',
    riskScore: 65.0,
    decision: 'WARN',
    flaggedEvidenceTypes: ['PRICING_ANOMALY'],
    timestamp: '2026-11-01T12:00:00Z',
  });

  // Find by domain (with URL formatting)
  const byDomain = await store.findByDomain('https://SHOES.EXAMPLE.COM/cart');
  assert.equal(byDomain.length, 1);
  assert.equal(byDomain[0].investigationId, 'inv-1');

  // Find by merchant ID (case-insensitive)
  const byMerchant = await store.findByPayeeMerchantId('merchant-veloce-us');
  assert.equal(byMerchant.length, 2);

  // Find by email (case-insensitive)
  const byEmail = await store.findByPayeeEmail('PAYEE@SHOES.EXAMPLE.COM');
  assert.equal(byEmail.length, 1);
  assert.equal(byEmail[0].investigationId, 'inv-1');

  // Find by brand
  const byBrand = await store.findByBrand('veloce athletics');
  assert.equal(byBrand.length, 2);
});

test('InMemoryMemoryStore getHistorySummary computes WARN/BLOCK and evidence counts', async () => {
  const store = new InMemoryMemoryStore();

  const domain = 'sketchy-electronics.net';

  // 1. ALLOW
  await store.indexInvestigation({
    investigationId: 'inv-allow',
    domain,
    claimedBrand: 'NovaSound',
    payeeMerchantId: 'M-SKETCHY-1',
    payeeEmail: 'billing@sketchy-electronics.net',
    riskScore: 20.0,
    decision: 'ALLOW',
    flaggedEvidenceTypes: [],
    timestamp: '2026-10-01T10:00:00Z',
  });

  // 2. WARN (evidence: PRICING_ANOMALY, SSL_TECHNICAL)
  await store.indexInvestigation({
    investigationId: 'inv-warn',
    domain,
    claimedBrand: 'NovaSound',
    payeeMerchantId: 'M-SKETCHY-1',
    payeeEmail: 'billing@sketchy-electronics.net',
    riskScore: 55.0,
    decision: 'WARN',
    flaggedEvidenceTypes: ['PRICING_ANOMALY', 'SSL_TECHNICAL'],
    timestamp: '2026-10-02T10:00:00Z',
  });

  // 3. PAUSE/BLOCK (evidence: MERCHANT_MISMATCH, PRICING_ANOMALY)
  await store.indexInvestigation({
    investigationId: 'inv-block',
    domain,
    claimedBrand: 'NovaSound',
    payeeMerchantId: 'M-SKETCHY-1',
    payeeEmail: 'billing@sketchy-electronics.net',
    riskScore: 88.0,
    decision: 'PAUSE',
    flaggedEvidenceTypes: ['MERCHANT_MISMATCH', 'PRICING_ANOMALY'],
    timestamp: '2026-10-03T10:00:00Z',
  });

  // Query summary by domain string
  const summaryByDomain = await store.getHistorySummary('https://sketchy-electronics.net');
  assert.equal(summaryByDomain.totalCount, 3);
  assert.equal(summaryByDomain.allowCount, 1);
  assert.equal(summaryByDomain.warnCount, 1);
  assert.equal(summaryByDomain.blockCount, 1);
  assert.equal(summaryByDomain.pauseCount, 1);

  // Check common flagged evidence types frequencies
  // PRICING_ANOMALY appears twice; MERCHANT_MISMATCH and SSL_TECHNICAL appear once
  assert.equal(summaryByDomain.commonFlaggedEvidenceTypes[0].type, 'PRICING_ANOMALY');
  assert.equal(summaryByDomain.commonFlaggedEvidenceTypes[0].count, 2);

  // Query summary by payee email
  const summaryByEmail = await store.getHistorySummary('billing@sketchy-electronics.net');
  assert.equal(summaryByEmail.totalCount, 3);

  // Query summary by payee merchant ID
  const summaryByMerchant = await store.getHistorySummary({ payeeMerchantId: 'M-SKETCHY-1' });
  assert.equal(summaryByMerchant.totalCount, 3);
});
