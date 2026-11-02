import {
  RiskWeights,
  DecisionTypes,
  DecisionThresholds,
  type DecisionType,
  type RiskScores,
  type RiskWeightsApplied,
} from '@checkout-guardian/contracts';
import type { VerificationResult } from '../verification/merchantVerification.service.js';

export interface ComponentScoresInput {
  domainReputation?: number;
  pricingAnomaly?: number;
  sslTechnical?: number;
  evidence?: Record<string, unknown>;
}

export interface RiskEvaluationResult {
  overallScore: number;
  decision: DecisionType;
  scores: RiskScores;
  weights: RiskWeightsApplied;
  reasons: string[];
  evidence: Record<string, unknown>;
  captureEligible: boolean;
  requiresAcknowledgement: boolean;
}

/**
 * Bounds a numerical score between 0.00 and 100.00.
 */
function clampScore(score: number): number {
  if (isNaN(score)) return 50.00;
  return Math.min(100.00, Math.max(0.00, Math.round(score * 100) / 100));
}

/**
 * Calculates the overall risk score and determines the payment decision
 * following authoritative PRD weights and thresholds:
 * - Domain reputation: 30%
 * - Merchant identity consistency: 40%
 * - Pricing anomalies: 20%
 * - SSL/technical indicators: 10%
 *
 * Thresholds:
 * - 0–39: ALLOW
 * - 40–74: WARN
 * - 75–100: PAUSE
 */
export function evaluateRisk(
  verification: VerificationResult,
  additionalScores: ComponentScoresInput = {}
): RiskEvaluationResult {
  const reasons: string[] = [...verification.evidence.reasons];

  const domainReputation = clampScore(additionalScores.domainReputation ?? 20.00);
  const merchantConsistency = clampScore(verification.merchantConsistencyScore);
  const pricingAnomaly = clampScore(additionalScores.pricingAnomaly ?? 15.00);
  const sslTechnical = clampScore(additionalScores.sslTechnical ?? 10.00);

  // Compute weighted base score
  let calculatedOverall =
    domainReputation * RiskWeights.DOMAIN +
    merchantConsistency * RiskWeights.MERCHANT_CONSISTENCY +
    pricingAnomaly * RiskWeights.PRICING +
    sslTechnical * RiskWeights.SSL_TECHNICAL;

  // PRD Rule: Merchant/payee mismatch triggers immediate high-risk flag (PAUSE)
  if (verification.matchStatus === 'MISMATCH' || merchantConsistency >= 100) {
    if (calculatedOverall < DecisionThresholds.PAUSE_MIN) {
      calculatedOverall = DecisionThresholds.PAUSE_MIN; // Force minimum 75 for mismatch
    }
    if (!reasons.includes('High-risk payee identity mismatch detected — transaction paused')) {
      reasons.push('High-risk payee identity mismatch detected — transaction paused');
    }
  }

  const overallScore = clampScore(calculatedOverall);

  let decision: DecisionType;
  if (overallScore <= DecisionThresholds.ALLOW_MAX) {
    decision = DecisionTypes.ALLOW;
  } else if (overallScore <= DecisionThresholds.WARN_MAX) {
    decision = DecisionTypes.WARN;
  } else {
    decision = DecisionTypes.PAUSE;
  }

  // Generate explainable reasons if none provided
  if (reasons.length === 0) {
    if (decision === DecisionTypes.ALLOW) {
      reasons.push('Transaction metrics within safe thresholds; verified payee identity');
    } else if (decision === DecisionTypes.WARN) {
      reasons.push('Elevated risk indicators observed; review recommended before proceeding');
    } else {
      reasons.push('Critical risk anomalies detected; transaction paused for buyer safety');
    }
  }

  const scores: RiskScores = {
    domainReputation,
    merchantConsistency,
    pricingAnomaly,
    sslTechnical,
  };

  const weights: RiskWeightsApplied = {
    domain: RiskWeights.DOMAIN,
    merchantConsistency: RiskWeights.MERCHANT_CONSISTENCY,
    pricing: RiskWeights.PRICING,
    ssl: RiskWeights.SSL_TECHNICAL,
  };

  const evidence: Record<string, unknown> = {
    ...verification.evidence,
    ...(additionalScores.evidence || {}),
    domainReputationScore: domainReputation,
    pricingAnomalyScore: pricingAnomaly,
    sslTechnicalScore: sslTechnical,
  };

  const captureEligible = decision === DecisionTypes.ALLOW;
  const requiresAcknowledgement = decision === DecisionTypes.WARN;

  return {
    overallScore,
    decision,
    scores,
    weights,
    reasons,
    evidence,
    captureEligible,
    requiresAcknowledgement,
  };
}

