import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRisk } from '../src/services/risk/riskEngine.service.js';
import type { VerificationResult } from '../src/services/verification/merchantVerification.service.js';

test('evaluateRisk accurately calculates weighted component scores', () => {
  const mockVerification: VerificationResult = {
    isMatch: true,
    matchStatus: 'MATCH',
    merchantConsistencyScore: 0.00,
    evidence: { reasons: [] },
    summary: { isMatch: true, matchStatus: 'MATCH', reasons: [] },
  };

  // Components:
  // domain: 10 * 0.30 = 3.00
  // merchant: 0 * 0.40 = 0.00
  // pricing: 20 * 0.20 = 4.00
  // ssl: 10 * 0.10 = 1.00
  // total: 8.00 (ALLOW)
  const result = evaluateRisk(mockVerification, {
    domainReputation: 10.00,
    pricingAnomaly: 20.00,
    sslTechnical: 10.00,
  });

  assert.equal(result.overallScore, 8.00);
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.captureEligible, true);
  assert.equal(result.requiresAcknowledgement, false);
});

test('evaluateRisk produces WARN (40-74) when moderate risk indicators are present', () => {
  const mockVerification: VerificationResult = {
    isMatch: true,
    matchStatus: 'MATCH',
    merchantConsistencyScore: 40.00,
    evidence: { reasons: ['Flagged suspicious history'] },
    summary: { isMatch: true, matchStatus: 'MATCH', reasons: [] },
  };

  // Components:
  // domain: 50 * 0.30 = 15.00
  // merchant: 40 * 0.40 = 16.00
  // pricing: 80 * 0.20 = 16.00
  // ssl: 30 * 0.10 = 3.00
  // total = 50.00 (WARN)
  const result = evaluateRisk(mockVerification, {
    domainReputation: 50.00,
    pricingAnomaly: 80.00,
    sslTechnical: 30.00,
  });

  assert.equal(result.overallScore, 50.00);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.captureEligible, false);
  assert.equal(result.requiresAcknowledgement, true);
});

test('evaluateRisk produces PAUSE (75-100) and forces minimum 75 on payee mismatch', () => {
  const mismatchVerification: VerificationResult = {
    isMatch: false,
    matchStatus: 'MISMATCH',
    merchantConsistencyScore: 100.00,
    evidence: { reasons: ['Payee email does not match registered merchant'] },
    summary: { isMatch: false, matchStatus: 'MISMATCH', reasons: [] },
  };

  // Even with 0 on all other scores:
  // domain: 0 * 0.30 = 0
  // merchant: 100 * 0.40 = 40
  // pricing: 0 * 0.20 = 0
  // ssl: 0 * 0.10 = 0
  // Weighted would be 40, but PRD requires mismatch to trigger high-risk PAUSE (>= 75)!
  const result = evaluateRisk(mismatchVerification, {
    domainReputation: 0.00,
    pricingAnomaly: 0.00,
    sslTechnical: 0.00,
  });

  assert.ok(result.overallScore >= 75.00);
  assert.equal(result.decision, 'PAUSE');
  assert.equal(result.captureEligible, false);
  assert.equal(result.requiresAcknowledgement, false);
  assert.ok(result.reasons.some((r) => r.includes('High-risk payee identity mismatch')));
});

