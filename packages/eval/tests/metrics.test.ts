import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateConfusionMatrix,
  calculateClassificationMetrics,
  calculateLatencyMetrics,
  calculatePercentile,
  evaluatePredictions,
  type PredictionRecord,
} from '../src/index.js';

test('calculateConfusionMatrix correctly tallies TP, FP, TN, and FN', () => {
  const records: PredictionRecord[] = [
    // 2 True Positives (actual fraud, predicted fraud)
    { actual: 'fraud', predicted: 'fraud' },
    { actual: true, predicted: true },

    // 1 False Positive (actual legit, predicted fraud)
    { actual: 'legit', predicted: 'fraud' },

    // 3 True Negatives (actual legit, predicted legit)
    { actual: 'legit', predicted: 'legit' },
    { actual: false, predicted: false },
    { actual: 'legit', predicted: false },

    // 1 False Negative (actual fraud, predicted legit)
    { actual: 'fraud', predicted: 'legit' },
  ];

  const matrix = calculateConfusionMatrix(records);

  assert.equal(matrix.truePositives, 2);
  assert.equal(matrix.falsePositives, 1);
  assert.equal(matrix.trueNegatives, 3);
  assert.equal(matrix.falseNegatives, 1);
  assert.equal(matrix.total, 7);
});

test('calculateClassificationMetrics: hand-computed example 1', () => {
  // Hand-computed configuration:
  // TP = 12, FP = 3, TN = 20, FN = 5
  // Total = 40
  //
  // Precision = TP / (TP + FP) = 12 / (12 + 3) = 12 / 15 = 0.8
  // Recall    = TP / (TP + FN) = 12 / (12 + 5) = 12 / 17 ≈ 0.7058823529411765
  // F1        = 2 * TP / (2 * TP + FP + FN) = 24 / (24 + 3 + 5) = 24 / 32 = 0.75
  // Accuracy  = (TP + TN) / Total = (12 + 20) / 40 = 32 / 40 = 0.8
  const matrix = {
    truePositives: 12,
    falsePositives: 3,
    trueNegatives: 20,
    falseNegatives: 5,
    total: 40,
  };

  const metrics = calculateClassificationMetrics(matrix);

  assert.equal(metrics.precision, 0.8);
  assert.ok(Math.abs(metrics.recall - 12 / 17) < 1e-9);
  assert.ok(Math.abs(metrics.f1Score - 0.75) < 1e-9);
  assert.equal(metrics.accuracy, 0.8);
});

test('calculateClassificationMetrics: hand-computed example 2 (Perfect model)', () => {
  // TP = 25, FP = 0, TN = 25, FN = 0 (Total = 50)
  // Precision = 1.0, Recall = 1.0, F1 = 1.0, Accuracy = 1.0
  const matrix = {
    truePositives: 25,
    falsePositives: 0,
    trueNegatives: 25,
    falseNegatives: 0,
    total: 50,
  };

  const metrics = calculateClassificationMetrics(matrix);

  assert.equal(metrics.precision, 1.0);
  assert.equal(metrics.recall, 1.0);
  assert.equal(metrics.f1Score, 1.0);
  assert.equal(metrics.accuracy, 1.0);
});

test('Safe zero-division handling for classification metrics', () => {
  // 1. All zeros (empty dataset)
  const emptyMatrix = {
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0,
    total: 0,
  };
  const emptyMetrics = calculateClassificationMetrics(emptyMatrix);
  assert.equal(emptyMetrics.precision, 0);
  assert.equal(emptyMetrics.recall, 0);
  assert.equal(emptyMetrics.f1Score, 0);
  assert.equal(emptyMetrics.accuracy, 0);

  // 2. Zero predicted positives: TP = 0, FP = 0, TN = 10, FN = 5
  // Precision denominator is 0 (TP + FP = 0)
  const noPositivePredictions = {
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 10,
    falseNegatives: 5,
    total: 15,
  };
  const noPredMetrics = calculateClassificationMetrics(noPositivePredictions);
  assert.equal(noPredMetrics.precision, 0, 'Precision must safely return 0 when TP+FP=0');
  assert.equal(noPredMetrics.recall, 0);
  assert.equal(noPredMetrics.f1Score, 0);
  assert.equal(noPredMetrics.accuracy, 10 / 15);

  // 3. Zero actual positives: TP = 0, FP = 4, TN = 10, FN = 0
  // Recall denominator is 0 (TP + FN = 0)
  const noActualPositives = {
    truePositives: 0,
    falsePositives: 4,
    trueNegatives: 10,
    falseNegatives: 0,
    total: 14,
  };
  const noActualMetrics = calculateClassificationMetrics(noActualPositives);
  assert.equal(noActualMetrics.precision, 0);
  assert.equal(noActualMetrics.recall, 0, 'Recall must safely return 0 when TP+FN=0');
  assert.equal(noActualMetrics.f1Score, 0);
});

test('calculateLatencyMetrics: hand-computed example with 10 values', () => {
  // Array: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  // Sum = 550, Count = 10
  // Mean = 550 / 10 = 55.0
  // p50 (median) = 55.0 (midpoint of index 4: 50 and index 5: 60)
  // p95 = index 0.95 * 9 = 8.55 -> 90 + 0.55*(100 - 90) = 95.5
  // Min = 10, Max = 100
  const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const metrics = calculateLatencyMetrics(latencies);

  assert.equal(metrics.count, 10);
  assert.equal(metrics.mean, 55.0);
  assert.equal(metrics.p50, 55.0);
  assert.equal(metrics.p95, 95.5);
  assert.equal(metrics.min, 10);
  assert.equal(metrics.max, 100);
});

test('calculateLatencyMetrics handles empty samples safely', () => {
  const emptyMetrics = calculateLatencyMetrics([]);
  assert.equal(emptyMetrics.count, 0);
  assert.equal(emptyMetrics.mean, 0);
  assert.equal(emptyMetrics.p50, 0);
  assert.equal(emptyMetrics.p95, 0);
  assert.equal(emptyMetrics.p99, 0);
  assert.equal(emptyMetrics.min, 0);
  assert.equal(emptyMetrics.max, 0);
});

test('calculatePercentile edge cases', () => {
  assert.equal(calculatePercentile([], 50), 0);
  assert.equal(calculatePercentile([42], 50), 42);
  assert.equal(calculatePercentile([42], 95), 42);
  assert.equal(calculatePercentile([10, 20], 0), 10);
  assert.equal(calculatePercentile([10, 20], 100), 20);
});

test('evaluatePredictions integrates classification metrics with latency telemetry', () => {
  const records: PredictionRecord[] = [
    { actual: 'fraud', predicted: 'fraud', latencyMs: 25 },
    { actual: 'fraud', predicted: 'fraud', latencyMs: 35 },
    { actual: 'legit', predicted: 'legit', latencyMs: 15 },
    { actual: 'legit', predicted: 'fraud', latencyMs: 45 }, // FP
  ];

  const report = evaluatePredictions(records);

  // TP = 2, FP = 1, TN = 1, FN = 0
  // Precision = 2 / 3
  // Recall = 2 / 2 = 1.0
  // F1 = 2 * (2/3 * 1) / (2/3 + 1) = (4/3) / (5/3) = 0.8
  // Accuracy = (2 + 1) / 4 = 0.75
  assert.equal(report.confusionMatrix.truePositives, 2);
  assert.equal(report.confusionMatrix.falsePositives, 1);
  assert.equal(report.confusionMatrix.trueNegatives, 1);
  assert.equal(report.confusionMatrix.falseNegatives, 0);
  assert.ok(Math.abs(report.precision - 2 / 3) < 1e-9);
  assert.equal(report.recall, 1.0);
  assert.equal(report.f1Score, 0.8);
  assert.equal(report.accuracy, 0.75);

  // Latencies: [15, 25, 35, 45] -> sum 120 -> mean 30
  assert.equal(report.latency.count, 4);
  assert.equal(report.latency.mean, 30);
  assert.equal(report.latency.min, 15);
  assert.equal(report.latency.max, 45);
});
