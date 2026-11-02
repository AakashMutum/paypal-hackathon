/**
 * @file latency.ts
 * @description Computes latency statistics (mean, p50, p95, p99, min, max) with safe handling for empty samples.
 */

import type { LatencyMetrics } from './types.js';

/**
 * Calculates a specific percentile from a sorted array using linear interpolation.
 *
 * @param sortedNumbers Ascending sorted array of numbers
 * @param percentile Value between 0 and 100
 */
export function calculatePercentile(sortedNumbers: number[], percentile: number): number {
  if (sortedNumbers.length === 0) {
    return 0;
  }
  if (percentile <= 0) {
    return sortedNumbers[0];
  }
  if (percentile >= 100) {
    return sortedNumbers[sortedNumbers.length - 1];
  }

  // Exact continuous index
  const index = (percentile / 100) * (sortedNumbers.length - 1);
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const weight = index - lowerIndex;

  const lowerVal = sortedNumbers[lowerIndex];
  const upperVal = sortedNumbers[upperIndex];

  return lowerVal * (1 - weight) + upperVal * weight;
}

/**
 * Calculates comprehensive latency metrics from an array of measured durations in milliseconds.
 *
 * Safe handling:
 * - Empty arrays safely return zeros across all metrics.
 * - Filters out invalid negative or non-finite values.
 */
export function calculateLatencyMetrics(latenciesMs: number[]): LatencyMetrics {
  const validLatencies = latenciesMs.filter(
    (val) => typeof val === 'number' && Number.isFinite(val) && val >= 0
  );

  if (validLatencies.length === 0) {
    return {
      mean: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      min: 0,
      max: 0,
      count: 0,
    };
  }

  // Sort ascending for rank/percentile calculations
  const sorted = [...validLatencies].sort((a, b) => a - b);

  const sum = sorted.reduce((acc, curr) => acc + curr, 0);
  const mean = sum / sorted.length;
  const p50 = calculatePercentile(sorted, 50);
  const p95 = calculatePercentile(sorted, 95);
  const p99 = calculatePercentile(sorted, 99);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  return {
    mean,
    p50,
    p95,
    p99,
    min,
    max,
    count: sorted.length,
  };
}

