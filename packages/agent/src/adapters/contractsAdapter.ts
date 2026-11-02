import type { AgentResult, RiskBuckets } from '../types.js';

/**
 * Adapter between the agent's internal shapes and the shared API contracts.
 *
 * This module deliberately does not import `@checkout-guardian/contracts`:
 * the agent package has no workspace dependency on it. The returned objects are
 * structurally compatible with `OrderDecisionResponse`, so the backend (Phase 12)
 * can spread them into its response after adding `sessionId`, `orderId` and
 * `merchantVerification`.
 */

export const RISK_WEIGHTS = {
  domain: 0.3,
  merchantConsistency: 0.4,
  pricing: 0.2,
  ssl: 0.1,
} as const;

export interface ContractRiskScores {
  domainReputation: number;
  merchantConsistency: number;
  pricingAnomaly: number;
  sslTechnical: number;
}

export interface ContractRiskWeights {
  domain: number;
  merchantConsistency: number;
  pricing: number;
  ssl: number;
}

export interface OrderDecisionPayload {
  decision: AgentResult['verdict']['decision'];
  actionTaken: AgentResult['verdict']['recommendedAction'];
  overallScore: number;
  riskScore: number;
  confidence: number;
  scores: ContractRiskScores;
  weights: ContractRiskWeights;
  evidence: Record<string, unknown>;
  reasons: string[];
  flaggedEvidenceIds: string[];
  hardRulesTriggered: AgentResult['hardRulesTriggered'];
  explanation: AgentResult['explanation'];
  trace: AgentResult['trace'];
  identityMatch?: AgentResult['identityMatch'];
  degraded: boolean;
  fallbackReason?: string;
}

export function toRiskScores(buckets: RiskBuckets): ContractRiskScores {
  return {
    domainReputation: buckets.domain,
    merchantConsistency: buckets.merchant,
    pricingAnomaly: buckets.pricing,
    sslTechnical: buckets.technical,
  };
}

export function toRiskWeights(): ContractRiskWeights {
  return { ...RISK_WEIGHTS };
}

export function toOrderDecision(result: AgentResult): OrderDecisionPayload {
  return {
    decision: result.verdict.decision,
    actionTaken: result.verdict.recommendedAction,
    overallScore: result.verdict.score,
    riskScore: result.verdict.riskScore,
    confidence: result.verdict.confidence,
    scores: toRiskScores(result.buckets),
    weights: toRiskWeights(),
    evidence: {
      evidence: result.evidence,
      buckets: result.buckets,
      hardRulesTriggered: result.hardRulesTriggered,
      explanation: result.explanation,
      trace: result.trace,
      path: result.path,
      stats: result.stats,
    },
    reasons: result.explanation.bullets.map((bullet) => bullet.text),
    flaggedEvidenceIds: result.verdict.flaggedEvidenceIds,
    hardRulesTriggered: result.hardRulesTriggered,
    explanation: result.explanation,
    trace: result.trace,
    identityMatch: result.identityMatch,
    degraded: result.degraded,
    fallbackReason: result.fallbackReason,
  };
}
