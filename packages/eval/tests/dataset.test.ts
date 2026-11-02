import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadEvaluationDataset,
  loadEvaluationDatasetAsync,
  getEvaluationCaseById,
  EvaluationCaseSchema,
} from '../src/index.js';

test('loadEvaluationDataset loads exactly 50 valid cases with Zod validation', () => {
  const dataset = loadEvaluationDataset();

  assert.equal(dataset.length, 50, 'Total cases should be exactly 50');

  // Verify all IDs are unique
  const ids = new Set(dataset.map((c) => c.id));
  assert.equal(ids.size, 50, 'All case IDs must be unique');
});

test('loadEvaluationDatasetAsync resolves with identical dataset', async () => {
  const dataset = await loadEvaluationDatasetAsync();
  assert.equal(dataset.length, 50);
});

test('dataset has balanced labels: 25 fraud and 25 legit cases', () => {
  const dataset = loadEvaluationDataset();

  const fraudCases = dataset.filter((c) => c.label === 'fraud');
  const legitCases = dataset.filter((c) => c.label === 'legit');

  assert.equal(fraudCases.length, 25, 'Expected exactly 25 fraud cases');
  assert.equal(legitCases.length, 25, 'Expected exactly 25 legit cases');
});

test('dataset contains the 3 demo stores aligned with fixtures', () => {
  const dataset = loadEvaluationDataset();

  // 1. harborline-outfitters.example (genuine-store.json - legit)
  const genuineCase = dataset.find((c) => c.merchantUrl.includes('harborline-outfitters.example'));
  assert.ok(genuineCase, 'harborline-outfitters.example must exist in dataset');
  assert.equal(genuineCase.label, 'legit');
  assert.equal(genuineCase.claimedBrand, 'Harborline Outfitters');

  // 2. bargainbarn-outlet.example (discount-store.json - legit)
  const discountCase = dataset.find((c) => c.merchantUrl.includes('bargainbarn-outlet.example'));
  assert.ok(discountCase, 'bargainbarn-outlet.example must exist in dataset');
  assert.equal(discountCase.label, 'legit');
  assert.equal(discountCase.claimedBrand, 'Bargain Barn Outlet');

  // 3. harborlyne-outfitters-sale.example (impersonator-store.json - fraud)
  const impersonatorCase = dataset.find((c) =>
    c.merchantUrl.includes('harborlyne-outfitters-sale.example'),
  );
  assert.ok(impersonatorCase, 'harborlyne-outfitters-sale.example must exist in dataset');
  assert.equal(impersonatorCase.label, 'fraud');
  assert.equal(impersonatorCase.claimedBrand, 'Harborline Outfitters');
});

test('dataset includes all required hard cases', () => {
  const dataset = loadEvaluationDataset();

  // 1. New-but-legit domain (domainAgeDays <= 30 and label === 'legit')
  const newLegit = dataset.find((c) => c.domainAgeDays <= 30 && c.label === 'legit');
  assert.ok(newLegit, 'Must include a new-but-legit domain');

  // 2. Big-but-legit sale (discount > 60% and label === 'legit')
  const bigSaleLegit = dataset.find(
    (c) => c.label === 'legit' && (c.referencePrice - c.listedPrice) / c.referencePrice >= 0.6,
  );
  assert.ok(bigSaleLegit, 'Must include a big-but-legit sale case');

  // 3. Legit store with a personal payee (e.g. gmail/yahoo/hotmail and label === 'legit')
  const personalPayeeLegit = dataset.find(
    (c) =>
      c.label === 'legit' &&
      !c.payeeMatchesDomain &&
      /@(gmail|yahoo|hotmail|outlook)\.com$/i.test(c.payeeEmail),
  );
  assert.ok(personalPayeeLegit, 'Must include a legit store with a personal payee email');

  // 4. Fraud site with an old domain (domainAgeDays > 1000 and label === 'fraud')
  const oldDomainFraud = dataset.find((c) => c.domainAgeDays > 1000 && c.label === 'fraud');
  assert.ok(oldDomainFraud, 'Must include a fraud site with an old domain');
});

test('getEvaluationCaseById retrieves specific case', () => {
  const found = getEvaluationCaseById('case-demo-001');
  assert.ok(found);
  assert.equal(found.id, 'case-demo-001');
  assert.equal(found.claimedBrand, 'Harborline Outfitters');

  const missing = getEvaluationCaseById('non-existent-case');
  assert.equal(missing, undefined);
});

test('EvaluationCaseSchema rejects invalid cases and unknown extra fields (strict)', () => {
  const validCase = getEvaluationCaseById('case-demo-001');
  assert.ok(validCase);

  // Reject extra unknown field (strict mode)
  assert.throws(() => {
    EvaluationCaseSchema.parse({
      ...validCase,
      unknownField: 'malicious',
    });
  });

  // Reject invalid label
  assert.throws(() => {
    EvaluationCaseSchema.parse({
      ...validCase,
      label: 'maybe_fraud',
    });
  });

  // Reject invalid URL
  assert.throws(() => {
    EvaluationCaseSchema.parse({
      ...validCase,
      merchantUrl: 'not-a-url',
    });
  });

  // Reject negative price
  assert.throws(() => {
    EvaluationCaseSchema.parse({
      ...validCase,
      listedPrice: -50,
    });
  });
});
