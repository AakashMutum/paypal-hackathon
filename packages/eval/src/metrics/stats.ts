/**
 * @file stats.ts
 * @description Rates, per-category accuracy and seeded bootstrap intervals built on the
 * confusion-matrix helpers.
 */

import { calculateClassificationMetrics, calculateConfusionMatrix } from './confusionMatrix.js';
import type { ConfusionMatrix, PredictionRecord } from './types.js';

export interface ScoredRow {
  caseId: string;
  category: string;
  actual: 'fraud' | 'legit';
  predicted: 'fraud' | 'legit';
}

export interface Rates {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  /** Share of legit cases flagged as fraud. */
  falsePositiveRate: number;
  /** Share of fraud cases passed as legit. */
  falseNegativeRate: number;
  confusion: ConfusionMatrix;
}

export interface Interval {
  low: number;
  high: number;
}

const toPredictions = (rows: readonly ScoredRow[]): PredictionRecord[] =>
  rows.map((r) => ({ actual: r.actual, predicted: r.predicted, caseId: r.caseId }));

export function ratesFor(rows: readonly ScoredRow[]): Rates {
  const confusion = calculateConfusionMatrix(toPredictions(rows));
  const m = calculateClassificationMetrics(confusion);
  const legit = confusion.trueNegatives + confusion.falsePositives;
  const fraud = confusion.truePositives + confusion.falseNegatives;
  return {
    accuracy: m.accuracy,
    precision: m.precision,
    recall: m.recall,
    f1: m.f1Score,
    falsePositiveRate: legit === 0 ? 0 : confusion.falsePositives / legit,
    falseNegativeRate: fraud === 0 ? 0 : confusion.falseNegatives / fraud,
    confusion,
  };
}

export function perCategoryAccuracy(rows: readonly ScoredRow[]): Record<string, { n: number; accuracy: number }> {
  const groups = new Map<string, ScoredRow[]>();
  for (const r of rows) groups.set(r.category, [...(groups.get(r.category) ?? []), r]);
  const out: Record<string, { n: number; accuracy: number }> = {};
  for (const [category, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    out[category] = { n: list.length, accuracy: list.filter((r) => r.actual === r.predicted).length / list.length };
  }
  return out;
}

/** Small seeded generator so intervals are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface BootstrapIntervals {
  accuracy: Interval;
  f1: Interval;
  recall: Interval;
  falsePositiveRate: Interval;
}

/** 95% percentile bootstrap over cases with a fixed seed. */
export function bootstrapIntervals(rows: readonly ScoredRow[], iterations = 2000, seed = 1): BootstrapIntervals {
  const rng = mulberry32(seed);
  const samples: Record<keyof BootstrapIntervals, number[]> = { accuracy: [], f1: [], recall: [], falsePositiveRate: [] };
  for (let b = 0; b < iterations; b += 1) {
    const sample: ScoredRow[] = [];
    for (let i = 0; i < rows.length; i += 1) sample.push(rows[Math.floor(rng() * rows.length)]);
    const r = ratesFor(sample);
    samples.accuracy.push(r.accuracy);
    samples.f1.push(r.f1);
    samples.recall.push(r.recall);
    samples.falsePositiveRate.push(r.falsePositiveRate);
  }
  const interval = (values: number[]): Interval => {
    const sorted = [...values].sort((a, b) => a - b);
    return { low: quantile(sorted, 0.025), high: quantile(sorted, 0.975) };
  };
  return {
    accuracy: interval(samples.accuracy),
    f1: interval(samples.f1),
    recall: interval(samples.recall),
    falsePositiveRate: interval(samples.falsePositiveRate),
  };
}
