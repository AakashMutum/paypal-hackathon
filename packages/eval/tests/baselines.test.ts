import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BaselineAClassifier,
  BaselineBClassifier,
  FullClassifier,
  type SignalsAgentProvider,
  type EvaluationCase,
  getEvaluationCaseById,
} from '../src/index.js';

test('Baseline A: scores domain age and price discount ratio only', () => {
  const classifier = new BaselineAClassifier();

  // Test 1: Brand new domain with deep discount -> triggers PAUSE
  const freshScamCase: EvaluationCase = {
    id: 'test-a-1',
    merchantUrl: 'https://fake-deals.xyz/checkout',
    claimedBrand: 'AuraTech',
    domainAgeDays: 5,
    listedPrice: 100,
    referencePrice: 1000, // 90% discount
    payeeEmail: 'anon@gmail.com',
    payeeMerchantId: 'M-123',
    payeeMatchesDomain: false,
    merchantIdentityClaimsConsistent: false,
    label: 'fraud',
    source: 'synthetic',
  };

  const result1 = classifier.classify(freshScamCase);
  assert.equal(result1.decision, 'PAUSE');
  assert.equal(result1.predictedFraud, true);
  assert.ok(result1.score >= 75);

  // Test 2: Do not use discount threshold as proof on its own
  // Deep discount on an established domain (> 365 days) must NOT trigger PAUSE
  const bigLegitSale: EvaluationCase = {
    id: 'test-a-2',
    merchantUrl: 'https://established-store.com/checkout',
    claimedBrand: 'Established Brand',
    domainAgeDays: 1200,
    listedPrice: 20,
    referencePrice: 100, // 80% discount
    payeeEmail: 'billing@established-store.com',
    payeeMerchantId: 'M-EST',
    payeeMatchesDomain: true,
    merchantIdentityClaimsConsistent: true,
    label: 'legit',
    source: 'synthetic',
  };

  const result2 = classifier.classify(bigLegitSale);
  assert.notEqual(result2.decision, 'PAUSE');
  assert.ok(result2.score <= 50, 'Discount on mature domain must be capped');
});

test('Baseline B: catches merchant identity claim inconsistencies on aged domains', () => {
  const baselineA = new BaselineAClassifier();
  const baselineB = new BaselineBClassifier();

  // Old domain with hijacked/inconsistent brand claim (case-hard-004)
  const hardCase004 = getEvaluationCaseById('case-hard-004');
  assert.ok(hardCase004);

  const resA = baselineA.classify(hardCase004);
  const resB = baselineB.classify(hardCase004);

  // Baseline B should assess higher risk due to identity inconsistency
  assert.ok(
    resB.score > resA.score,
    `Baseline B (${resB.score}) should catch identity inconsistency missed by Baseline A (${resA.score})`,
  );
  assert.ok(resB.reasons.some((r) => r.includes('Inconsistent merchant identity claims')));
});

test('Full Classifier: accurately evaluates demo stores aligned with fixtures', async () => {
  const fullClassifier = new FullClassifier();

  // 1. Harborline Outfitters (genuine-store.json - ALLOW)
  const genuineCase = getEvaluationCaseById('case-demo-001');
  assert.ok(genuineCase);
  const genuineResult = await fullClassifier.classify(genuineCase);
  assert.equal(genuineResult.decision, 'ALLOW');
  assert.equal(genuineResult.predictedFraud, false);

  // 2. Bargain Barn Outlet (discount-store.json - WARN)
  const discountCase = getEvaluationCaseById('case-demo-002');
  assert.ok(discountCase);
  const discountResult = await fullClassifier.classify(discountCase);
  assert.equal(discountResult.decision, 'WARN');
  assert.equal(discountResult.predictedFraud, true);

  // 3. Harborline Impersonator (impersonator-store.json - PAUSE)
  const impersonatorCase = getEvaluationCaseById('case-demo-003');
  assert.ok(impersonatorCase);
  const impersonatorResult = await fullClassifier.classify(impersonatorCase);
  assert.equal(impersonatorResult.decision, 'PAUSE');
  assert.equal(impersonatorResult.predictedFraud, true);
});

test('Full Classifier: handles hard cases appropriately', async () => {
  const fullClassifier = new FullClassifier();

  // 1. New-but-legit domain (case-hard-001)
  const newLegitCase = getEvaluationCaseById('case-hard-001');
  assert.ok(newLegitCase);
  const newLegitRes = await fullClassifier.classify(newLegitCase);
  assert.equal(newLegitRes.decision, 'ALLOW');
  assert.equal(newLegitRes.predictedFraud, false);

  // 2. Big-but-legit sale (case-hard-002)
  const bigSaleCase = getEvaluationCaseById('case-hard-002');
  assert.ok(bigSaleCase);
  const bigSaleRes = await fullClassifier.classify(bigSaleCase);
  assert.notEqual(bigSaleRes.decision, 'PAUSE', 'Should not block clearance sale on mature domain');

  // 3. Legit store with personal payee (case-hard-003)
  const personalPayeeCase = getEvaluationCaseById('case-hard-003');
  assert.ok(personalPayeeCase);
  const personalPayeeRes = await fullClassifier.classify(personalPayeeCase);
  assert.equal(personalPayeeRes.decision, 'ALLOW');
  assert.equal(personalPayeeRes.predictedFraud, false);

  // 4. Fraud site with old domain (case-hard-004)
  const oldFraudCase = getEvaluationCaseById('case-hard-004');
  assert.ok(oldFraudCase);
  const oldFraudRes = await fullClassifier.classify(oldFraudCase);
  assert.equal(oldFraudRes.decision, 'PAUSE');
  assert.equal(oldFraudRes.predictedFraud, true);
});

test('Configurable predicted-fraud mapping: treat WARN as non-fraud when configured', () => {
  const classifier = new BaselineAClassifier();

  const moderateCase: EvaluationCase = {
    id: 'test-warn-1',
    merchantUrl: 'https://young-shop.com/checkout',
    claimedBrand: 'Brand',
    domainAgeDays: 60,
    listedPrice: 50,
    referencePrice: 100, // 50% discount
    payeeEmail: 'pay@young-shop.com',
    payeeMerchantId: 'M-1',
    payeeMatchesDomain: true,
    merchantIdentityClaimsConsistent: true,
    label: 'legit',
    source: 'synthetic',
  };

  // Default: WARN is treated as predictedFraud = true
  const defaultRes = classifier.classify(moderateCase);
  assert.equal(defaultRes.decision, 'WARN');
  assert.equal(defaultRes.predictedFraud, true);

  // Configured: only BLOCK/PAUSE are treated as predictedFraud
  const strictRes = classifier.classify(moderateCase, {
    fraudDecisions: ['PAUSE', 'BLOCK'],
  });
  assert.equal(strictRes.decision, 'WARN');
  assert.equal(strictRes.predictedFraud, false);

  // Custom mapping function
  const customRes = classifier.classify(moderateCase, {
    mapDecisionToFraud: (decision, score) => score > 80,
  });
  assert.equal(customRes.predictedFraud, false);
});

test('Full Classifier: supports pluggable SignalsAgentProvider interface', async () => {
  let providerCalled = false;

  const mockProvider: SignalsAgentProvider = {
    name: 'Mock P2 Signals Agent',
    evaluate: async () => {
      providerCalled = true;
      return {
        payeeBindingScore: 85,
        historicalMemoryScore: 90,
        findings: ['Mock agent flagged critical entity risks'],
      };
    },
  };

  const classifier = new FullClassifier({ signalsProvider: mockProvider });
  const sampleCase = getEvaluationCaseById('case-demo-001');
  assert.ok(sampleCase);

  const result = await classifier.classify(sampleCase);
  assert.ok(providerCalled, 'Plugged-in provider should be invoked');
  assert.ok(result.reasons.includes('Mock agent flagged critical entity risks'));
});
