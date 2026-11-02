import type {
  Decision,
  Evidence,
  HardRuleTrigger,
  RecommendedAction,
  RiskBuckets,
} from '../types.js';
import {
  bucketMaxima,
  scoreEvidence,
  sumBuckets,
  type ScoredEvidence,
} from './pointsFor.js';
import { evaluateHardRules, floorForRule, hasBlockingHardRule } from './rules.js';
import { computeConfidence } from './confidence.js';
import { buildFlaggedEvidenceIds, buildSummary } from './summary.js';

/** PRD thresholds: 0-39 ALLOW, 40-74 WARN, 75-100 PAUSE. */
export const DECISION_THRESHOLDS = {
  ALLOW_MAX: 39,
  WARN_MIN: 40,
  WARN_MAX: 74,
  PAUSE_MIN: 75,
} as const;

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

export interface ScoreOptions {
  confidenceThreshold?: number;
  baselineFailures?: number;
  baselineSucceeded?: number;
}

export interface ScoreResult {
  score: number;
  riskScore: number;
  decision: Decision;
  recommendedAction: RecommendedAction;
  confidence: number;
  buckets: RiskBuckets;
  flaggedEvidenceIds: string[];
  summary: string;
  hardRulesTriggered: HardRuleTrigger[];
  scored: ScoredEvidence[];
  /** Bucket sum of deterministic evidence only. */
  deterministicPoints: number;
  /** Extra points contributed by non-deterministic evidence (before the R4 cap). */
  nonDeterministicPoints: number;
  /** True when the R4 cap lowered the total. */
  r4Capped: boolean;
  /** True when R5 downgraded a PAUSE to WARN for low confidence. */
  r5Downgraded: boolean;
  /** True when fewer than two baseline tools succeeded. */
  insufficientEvidence: boolean;
}

export function decisionForScore(score: number): Decision {
  if (!Number.isFinite(score)) return 'WARN';
  if (score >= DECISION_THRESHOLDS.PAUSE_MIN) return 'PAUSE';
  if (score >= DECISION_THRESHOLDS.WARN_MIN) return 'WARN';
  return 'ALLOW';
}

export function actionForDecision(decision: Decision): RecommendedAction {
  switch (decision) {
    case 'PAUSE':
      return 'CAPTURE_PAUSED';
    case 'WARN':
      return 'WARN_DISPLAYED';
    default:
      return 'PROCEED';
  }
}

export function scoreAndDecide(
  evidence: readonly Evidence[] | undefined,
  options: ScoreOptions = {}
): ScoreResult {
  const list = Array.isArray(evidence)
    ? evidence.filter((entry): entry is Evidence => Boolean(entry) && typeof entry.type === 'string')
    : [];

  const scored = scoreEvidence(list);
  const allBuckets = bucketMaxima(scored);
  const deterministicBuckets = bucketMaxima(scored, { onlyDeterministic: true });

  const totalAll = sumBuckets(allBuckets);
  const totalDeterministic = sumBuckets(deterministicBuckets);
  const nonDeterministic = Math.max(0, totalAll - totalDeterministic);

  // R4: non-deterministic evidence may add at most enough points to reach 74.
  // The spec phrases this as "cap the whole total at 74 unless solid evidence
  // exists"; capping only the non-deterministic contribution gives the same
  // result for every case in the spec while guaranteeing that model output can
  // never, by itself, move a payment into PAUSE.
  const allowedNonDeterministic = Math.max(0, DECISION_THRESHOLDS.WARN_MAX - totalDeterministic);
  const cappedTotal = totalDeterministic + Math.min(nonDeterministic, allowedNonDeterministic);

  const hardRulesTriggered = evaluateHardRules(list);
  const floors = hardRulesTriggered.map((trigger) => floorForRule(trigger.rule));
  const score = clampScore(Math.max(cappedTotal, ...(floors.length > 0 ? floors : [0])));

  let decision = decisionForScore(score);
  const confidence = computeConfidence({
    evidence: list,
    decision,
    baselineFailures: options.baselineFailures,
    baselineSucceeded: options.baselineSucceeded,
    scored,
  });

  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  let r5Downgraded = false;
  if (decision === 'PAUSE' && !hasBlockingHardRule(hardRulesTriggered) && confidence < threshold) {
    decision = 'WARN';
    r5Downgraded = true;
  }

  // Safety net: if almost nothing ran, a clean score only means we did not look.
  // An ALLOW in that state is never safe to act on, so it becomes WARN.
  const insufficientEvidence = options.baselineSucceeded !== undefined && options.baselineSucceeded < 2;
  if (insufficientEvidence && decision === 'ALLOW') {
    decision = 'WARN';
  }

  const flaggedEvidenceIds = buildFlaggedEvidenceIds(list, scored, hardRulesTriggered);
  const summary = buildSummary(decision, list, flaggedEvidenceIds);

  const buckets: RiskBuckets = {
    domain: allBuckets.D,
    merchant: allBuckets.M,
    pricing: allBuckets.P,
    technical: allBuckets.T,
  };

  return {
    score,
    riskScore: score / 100,
    decision,
    recommendedAction: actionForDecision(decision),
    confidence,
    buckets,
    flaggedEvidenceIds,
    summary,
    hardRulesTriggered,
    scored,
    deterministicPoints: totalDeterministic,
    nonDeterministicPoints: nonDeterministic,
    r4Capped: cappedTotal < totalAll,
    r5Downgraded,
    insufficientEvidence,
  };
}

/** Returns copies with `hardFail: true` on every evidence cited by a hard rule. */
export function markHardFail(
  evidence: readonly Evidence[] | undefined,
  hardRules: readonly HardRuleTrigger[]
): Evidence[] {
  if (!Array.isArray(evidence)) return [];
  const ids = new Set<string>();
  for (const rule of hardRules) for (const id of rule.evidenceIds) ids.add(id);
  return evidence.map((entry) => (ids.has(entry.id) ? { ...entry, hardFail: true } : { ...entry }));
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}
