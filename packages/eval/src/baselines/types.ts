/**
 * @file types.ts
 * @description Common interfaces and types for evaluation baselines and classifiers.
 */

import type { Decision } from '@checkout-guardian/memory';
import type { EvaluationCase } from '../dataset/schema.js';

export interface ClassifierResult {
  /** Final risk decision: ALLOW, WARN, or PAUSE */
  decision: Decision;
  /** Binary classification outcome mapped from decision */
  predictedFraud: boolean;
  /** Composite risk score between 0.0 and 100.0 */
  score: number;
  /** Detailed explanations justifying the decision */
  reasons: string[];
  /** Breakdown of component risk contributions */
  componentScores?: Record<string, number>;
}

export interface ClassifierConfig {
  /**
   * Decisions that should be mapped to predictedFraud = true.
   * Default: ['WARN', 'PAUSE', 'BLOCK'] per evaluation guidelines.
   */
  fraudDecisions?: Array<Decision | string>;
  /**
   * Optional custom predicate for mapping decision and score to predictedFraud.
   */
  mapDecisionToFraud?: (decision: Decision, score: number) => boolean;
}

/**
 * Standard interface for deterministic classifiers in the benchmark harness.
 */
export interface BaselineClassifier {
  /** Descriptive name of the baseline */
  readonly name: string;
  /** Classifies a single evaluation case */
  classify(
    caseInput: EvaluationCase,
    config?: ClassifierConfig
  ): Promise<ClassifierResult> | ClassifierResult;
}

/**
 * Resolves whether a given decision constitutes predicted fraud according to configuration.
 * By default, both WARN and PAUSE/BLOCK are treated as predicted fraud.
 */
export function isPredictedFraud(
  decision: Decision,
  score: number,
  config?: ClassifierConfig
): boolean {
  if (config?.mapDecisionToFraud) {
    return config.mapDecisionToFraud(decision, score);
  }

  const fraudDecisions = config?.fraudDecisions ?? ['WARN', 'PAUSE', 'BLOCK'];
  return fraudDecisions.includes(decision);
}

/**
 * Maps a numerical composite risk score (0-100) to a formal Decision contract.
 * - 0-39: ALLOW
 * - 40-74: WARN
 * - 75-100: PAUSE
 */
export function scoreToDecision(score: number): Decision {
  if (score >= 75) {
    return 'PAUSE';
  }
  if (score >= 40) {
    return 'WARN';
  }
  return 'ALLOW';
}

