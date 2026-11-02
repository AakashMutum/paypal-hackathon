import test from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapIntervals, mulberry32, perCategoryAccuracy, quantile, ratesFor, type ScoredRow } from '../src/index.js';

const row = (category: string, actual: 'fraud' | 'legit', predicted: 'fraud' | 'legit', i = 0): ScoredRow => ({
  caseId: `c${i}`,
  category,
  actual,
  predicted,
});

const rows: ScoredRow[] = [
  row('a', 'fraud', 'fraud', 1),
  row('a', 'fraud', 'fraud', 2),
  row('a', 'fraud', 'legit', 3),
  row('b', 'legit', 'legit', 4),
  row('b', 'legit', 'legit', 5),
  row('b', 'legit', 'fraud', 6),
  row('b', 'legit', 'legit', 7),
  row('a', 'fraud', 'fraud', 8),
];

test('ratesFor computes the confusion matrix and rates', () => {
  const r = ratesFor(rows);
  assert.deepEqual(r.confusion, { truePositives: 3, falsePositives: 1, trueNegatives: 3, falseNegatives: 1, total: 8 });
  assert.equal(r.accuracy, 6 / 8);
  assert.equal(r.precision, 3 / 4);
  assert.equal(r.recall, 3 / 4);
  assert.equal(r.f1, 3 / 4);
  assert.equal(r.falsePositiveRate, 1 / 4);
  assert.equal(r.falseNegativeRate, 1 / 4);
});

test('rates are zero rather than NaN when a class is empty', () => {
  const r = ratesFor([row('a', 'legit', 'legit')]);
  assert.equal(r.recall, 0);
  assert.equal(r.falseNegativeRate, 0);
  assert.equal(r.falsePositiveRate, 0);
});

test('perCategoryAccuracy groups by category', () => {
  const out = perCategoryAccuracy(rows);
  assert.deepEqual(out.a, { n: 4, accuracy: 3 / 4 });
  assert.deepEqual(out.b, { n: 4, accuracy: 3 / 4 });
});

test('quantile interpolates', () => {
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(quantile([0, 10], 0.25), 2.5);
  assert.equal(quantile([], 0.5), 0);
});

test('the seeded generator and bootstrap are deterministic', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.deepEqual(bootstrapIntervals(rows, 200, 5), bootstrapIntervals(rows, 200, 5));
  assert.notDeepEqual(bootstrapIntervals(rows, 200, 5), bootstrapIntervals(rows, 200, 6));
});

test('bootstrap intervals are ordered, bounded and bracket a stable estimate', () => {
  const many = Array.from({ length: 80 }, (_, i) => {
    const actual = i % 2 ? 'fraud' : 'legit';
    const wrong = i % 10 === 0;
    const predicted = wrong ? (actual === 'fraud' ? 'legit' : 'fraud') : actual;
    return row('a', actual, predicted, i);
  });
  const point = ratesFor(many).accuracy;
  const { accuracy } = bootstrapIntervals(many, 1000, 1);
  assert.ok(accuracy.low <= point && point <= accuracy.high);
  assert.ok(accuracy.low >= 0 && accuracy.high <= 1);
  const perfect = bootstrapIntervals(
    many.map((r) => ({ ...r, predicted: r.actual })),
    200,
    1,
  );
  assert.deepEqual(perfect.accuracy, { low: 1, high: 1 });
});
