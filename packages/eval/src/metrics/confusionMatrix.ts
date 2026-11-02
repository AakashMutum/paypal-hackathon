/**
 * @file confusionMatrix.ts
 * @description Computes confusion matrix and classification performance metrics with safe zero-division handling.
 */

import type { ConfusionMatrix, ClassificationMetrics, PredictionRecord } from './types.js';

/**
 * Normalizes input value to boolean representing whether it indicates fraud (positive class).
 */
export function isFraudPositive(value: 'fraud' | 'legit' | boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  return value.trim().toLowerCase() === 'fraud';
}

/**
 * Builds a ConfusionMatrix from an array of prediction records.
 * Positive Class = Fraud, Negative Class = Legit.
 *
 * - TP: actual fraud, predicted fraud
 * - FP: actual legit, predicted fraud
 * - TN: actual legit, predicted legit
 * - FN: actual fraud, predicted legit
 */
export function calculateConfusionMatrix(predictions: PredictionRecord[]): ConfusionMatrix {
  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;

  for (const record of predictions) {
    const isActualFraud = isFraudPositive(record.actual);
    const isPredictedFraud = isFraudPositive(record.predicted);

    if (isActualFraud && isPredictedFraud) {
      truePositives += 1;
    } else if (!isActualFraud && isPredictedFraud) {
      falsePositives += 1;
    } else if (!isActualFraud && !isPredictedFraud) {
      trueNegatives += 1;
    } else {
      falseNegatives += 1;
    }
  }

  return {
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    total: predictions.length,
  };
}

/**
 * Calculates Precision, Recall, F1-Score, and Accuracy from a ConfusionMatrix.
 *
 * Safe zero-division handling:
 * - Precision: TP / (TP + FP) -> 0 if (TP + FP) == 0
 * - Recall: TP / (TP + FN) -> 0 if (TP + FN) == 0
 * - F1: 2 * (P * R) / (P + R) -> 0 if (P + R) == 0
 * - Accuracy: (TP + TN) / total -> 0 if total == 0
 */
export function calculateClassificationMetrics(matrix: ConfusionMatrix): ClassificationMetrics {
  const {
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    total,
  } = matrix;

  // Precision = TP / (TP + FP)
  const precisionDenominator = tp + fp;
  const precision = precisionDenominator === 0 ? 0 : tp / precisionDenominator;

  // Recall = TP / (TP + FN)
  const recallDenominator = tp + fn;
  const recall = recallDenominator === 0 ? 0 : tp / recallDenominator;

  // F1 = 2 * (Precision * Recall) / (Precision + Recall)
  const f1Denominator = precision + recall;
  const f1Score = f1Denominator === 0 ? 0 : (2 * precision * recall) / f1Denominator;

  // Accuracy = (TP + TN) / Total
  const accuracy = total === 0 ? 0 : (tp + tn) / total;

  return {
    confusionMatrix: matrix,
    precision,
    recall,
    f1Score,
    accuracy,
  };
}
