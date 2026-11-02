/**
 * @file types.ts
 * @description Types for evaluation benchmark runner and report generation.
 */

import type { LatencyMetrics } from '../metrics/types.js';

export interface BaselineSummaryMetrics {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  latency: LatencyMetrics;
}

export interface CaseEvaluationResult {
  id: string;
  merchantUrl: string;
  claimedBrand: string;
  actual: 'fraud' | 'legit';
  predicted: 'fraud' | 'legit';
  isCorrect: boolean;
  decision: string;
  score: number;
  latencyMs: number;
  reasons: string[];
}

export interface EvalReport {
  /** ISO 8601 generation timestamp */
  generatedAt: string;
  /** Total number of cases evaluated */
  datasetSize: number;
  /** High-level metrics per evaluated baseline */
  perBaseline: {
    baselineA: BaselineSummaryMetrics;
    baselineB: BaselineSummaryMetrics;
    full: BaselineSummaryMetrics;
    [key: string]: BaselineSummaryMetrics;
  };
  /** Granular case-level predictions and timings */
  perCaseResults: {
    baselineA: CaseEvaluationResult[];
    baselineB: CaseEvaluationResult[];
    full: CaseEvaluationResult[];
    [key: string]: CaseEvaluationResult[];
  };
}

