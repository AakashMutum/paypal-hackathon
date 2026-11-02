import type { Decision, Evidence } from '../types.js';
import {
  isDeterministicEvidence,
  readNumber,
  readString,
  scoreEvidence,
  type ScoredEvidence,
} from './pointsFor.js';
import { evaluateHardRules, hasBlockingHardRule } from './rules.js';

/**
 * Confidence expresses how well the evidence is supported, not how suspicious
 * the case is. It starts at 0.5, gains a little for every supporting fact, loses
 * 0.15 per failed baseline tool, and is capped at 0.99.
 *
 * The "fewer than two baseline tools succeeded" override is applied last: when
 * almost nothing ran, the number should say so regardless of the arithmetic.
 */

export interface ConfidenceInput {
  evidence: readonly Evidence[];
  decision: Decision;
  baselineFailures?: number;
  baselineSucceeded?: number;
  scored?: readonly ScoredEvidence[];
}

export const CONFIDENCE_FLOOR = 0.2;
export const CONFIDENCE_CEILING = 0.99;
export const LOW_EVIDENCE_CONFIDENCE = 0.3;

export function computeConfidence(input: ConfidenceInput): number {
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const scored = input.scored ? [...input.scored] : scoreEvidence(evidence);

  let confidence = 0.5;

  if (input.decision === 'ALLOW') {
    confidence += countAllowFacts(evidence) * 0.12;
  } else {
    const supporting = scored.filter((entry) => entry.deterministic && entry.points >= 14).length;
    confidence += supporting * 0.15;
  }

  confidence -= Math.max(0, input.baselineFailures ?? 0) * 0.15;

  if (hasBlockingHardRule(evaluateHardRules(evidence))) {
    confidence = Math.max(confidence, 0.95);
  }

  confidence = clamp(confidence, CONFIDENCE_FLOOR, CONFIDENCE_CEILING);

  if (input.baselineSucceeded !== undefined && input.baselineSucceeded < 2) {
    confidence = LOW_EVIDENCE_CONFIDENCE;
  }

  return round2(confidence);
}

function countAllowFacts(evidence: readonly Evidence[]): number {
  let facts = 0;

  const matchingBinding = evidence.some(
    (entry) =>
      entry.type === 'PAYEE_BINDING' &&
      readString(entry.data?.status) === 'MATCH' &&
      isDeterministicEvidence(entry)
  );
  if (matchingBinding) facts += 1;

  const oldDomain = evidence.some((entry) => {
    if (entry.type !== 'DOMAIN_AGE') return false;
    const ageDays = readNumber(entry.data?.ageDays);
    return ageDays !== undefined && ageDays >= 90;
  });
  if (oldDomain) facts += 1;

  const hasLookalike = evidence.some(
    (entry) => entry.type === 'LOOKALIKE_DOMAIN' && entry.data?.matchesKnownBrand === true
  );
  if (!hasLookalike) facts += 1;

  const priceEvidence = evidence.find((entry) => entry.type === 'PRICE_DEVIATION');
  const discountPct = priceEvidence ? readNumber(priceEvidence.data?.discountPct) : undefined;
  if (discountPct === undefined || discountPct < 50) facts += 1;

  const hasInjection = evidence.some((entry) => entry.type === 'INJECTION_ATTEMPT');
  if (!hasInjection) facts += 1;

  return facts;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
