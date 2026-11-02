/**
 * @file types.ts
 * @description Types and contracts for evaluation metrics (classification performance and latency).
 */

export interface ConfusionMatrix {
  /** True Positives: Fraud correctly predicted as Fraud */
  truePositives: number;
  /** False Positives: Legit falsely predicted as Fraud */
  falsePositives: number;
  /** True Negatives: Legit correctly predicted as Legit */
  trueNegatives: number;
  /** False Negatives: Fraud falsely predicted as Legit */
  falseNegatives: number;
  /** Total number of evaluated predictions */
  total: number;
}

export interface LatencyMetrics {
  /** Arithmetic mean latency in milliseconds */
  mean: number;
  /** 50th percentile (median) latency in milliseconds */
  p50: number;
  /** 95th percentile latency in milliseconds */
  p95: number;
  /** 99th percentile latency in milliseconds */
  p99: number;
  /** Minimum observed latency in milliseconds */
  min: number;
  /** Maximum observed latency in milliseconds */
  max: number;
  /** Sample size */
  count: number;
}

export interface ClassificationMetrics {
  confusionMatrix: ConfusionMatrix;
  /** Precision = TP / (TP + FP) */
  precision: number;
  /** Recall = TP / (TP + FN) */
  recall: number;
  /** F1 Score = 2 * (Precision * Recall) / (Precision + Recall) = 2*TP / (2*TP + FP + FN) */
  f1Score: number;
  /** Accuracy = (TP + TN) / (TP + TN + FP + FN) */
  accuracy: number;
}

export interface PredictionRecord {
  /** Ground truth label ('fraud' | 'legit' or boolean where true = fraud) */
  actual: 'fraud' | 'legit' | boolean;
  /** Classifier prediction ('fraud' | 'legit' or boolean where true = fraud) */
  predicted: 'fraud' | 'legit' | boolean;
  /** Optional execution latency in milliseconds */
  latencyMs?: number;
  /** Optional identifier for debugging */
  caseId?: string;
}

export interface FullMetricsReport extends ClassificationMetrics {
  latency: LatencyMetrics;
}

