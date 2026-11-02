/**
 * @file engine.ts
 * @description Unified metrics engine orchestrating classification metrics and latency analysis.
 */

import type { PredictionRecord, FullMetricsReport } from './types.js';
import { calculateConfusionMatrix, calculateClassificationMetrics } from './confusionMatrix.js';
import { calculateLatencyMetrics } from './latency.js';

export class MetricsEngine {
  /**
   * Evaluates an array of prediction records and generates a complete performance report.
   */
  evaluate(predictions: PredictionRecord[]): FullMetricsReport {
    const matrix = calculateConfusionMatrix(predictions);
    const classification = calculateClassificationMetrics(matrix);

    const latencies: number[] = [];
    for (const p of predictions) {
      if (typeof p.latencyMs === 'number') {
        latencies.push(p.latencyMs);
      }
    }

    const latency = calculateLatencyMetrics(latencies);

    return {
      ...classification,
      latency,
    };
  }
}

/**
 * Convenience functional evaluator.
 */
export function evaluatePredictions(predictions: PredictionRecord[]): FullMetricsReport {
  return new MetricsEngine().evaluate(predictions);
}
