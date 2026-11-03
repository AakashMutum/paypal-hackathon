import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardMetrics } from '../src/lib/metrics.js';
import type { Investigation } from '../src/types.js';

function investigation(overrides: Partial<Investigation>): Investigation {
  return {
    id: 'INV-1',
    domain: 'merchant.example',
    claimedBrand: 'Example Merchant',
    productName: 'Example product',
    price: 10,
    benchmark: null,
    currency: 'USD',
    payeeName: 'Example Merchant LLC',
    payeeId: 'MERCHANT-1',
    payeeTier: 'verified',
    domainAgeDays: 400,
    registryRecords: 1,
    riskScore: 0,
    confidence: 80,
    status: 'COMPLETE',
    verdict: 'ALLOW',
    captureState: 'CAPTURED',
    reasons: [],
    evidence: [],
    createdAt: '2026-11-03T12:00:00.000Z',
    ...overrides,
  };
}

test('an empty store reports zero, never a demo baseline', () => {
  assert.deepEqual(dashboardMetrics([]), {
    websitesChecked: 0,
    allowed: 0,
    suspicious: 0,
    prevented: 0,
    defendedAmount: 0,
  });
});

test('counters and defended amount come from persisted investigations only', () => {
  const metrics = dashboardMetrics([
    investigation({ id: 'ALLOW', verdict: 'ALLOW', captureState: 'CAPTURED', price: 100 }),
    investigation({ id: 'WARN-HELD', verdict: 'WARN', captureState: 'HELD', price: 50 }),
    investigation({ id: 'WARN-CAPTURED', verdict: 'WARN', captureState: 'CAPTURED', price: 30 }),
    investigation({ id: 'PAUSE-HELD', verdict: 'PAUSE', captureState: 'HELD', price: 20 }),
    investigation({ id: 'PAUSE-NO-PRICE', verdict: 'PAUSE', captureState: 'PENDING', price: null }),
    investigation({ id: 'RUNNING', status: 'RUNNING', verdict: 'PAUSE', captureState: 'PENDING', price: 999 }),
  ]);

  assert.deepEqual(metrics, {
    websitesChecked: 5,
    allowed: 1,
    suspicious: 4,
    prevented: 2,
    defendedAmount: 70,
  });
});

test('a flagged payment that was captured is not counted as defended', () => {
  const metrics = dashboardMetrics([
    investigation({ verdict: 'WARN', captureState: 'CAPTURED', price: 80 }),
    investigation({ verdict: 'PAUSE', captureState: 'VOIDED', price: 20 }),
  ]);
  assert.equal(metrics.defendedAmount, 20);
  assert.equal(metrics.suspicious, 2);
});
