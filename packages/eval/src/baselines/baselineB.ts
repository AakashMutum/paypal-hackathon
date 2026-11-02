/**
 * @file baselineB.ts
 * @description Baseline B Classifier: Evaluates domain age + price discount ratio + merchant identity claim consistency.
 */

import type { EvaluationCase } from '../dataset/schema.js';
import { BaselineAClassifier } from './baselineA.js';
import {
  type BaselineClassifier,
  type ClassifierConfig,
  type ClassifierResult,
  isPredictedFraud,
  scoreToDecision,
} from './types.js';

export class BaselineBClassifier implements BaselineClassifier {
  readonly name = 'Baseline B (Baseline A + Merchant Identity Claims)';
  private readonly baselineA = new BaselineAClassifier();

  classify(caseInput: EvaluationCase, config?: ClassifierConfig): ClassifierResult {
    const baseResult = this.baselineA.classify(caseInput, config);
    const reasons = [...baseResult.reasons];

    // Identity claim consistency evaluation (40 points weight matching PRD specification)
    let identityRisk = 0;
    if (!caseInput.merchantIdentityClaimsConsistent) {
      identityRisk = 45;
      reasons.push(
        `Inconsistent merchant identity claims for storefront claiming "${caseInput.claimedBrand}"`
      );
    } else {
      reasons.push(
        `Storefront claims for brand "${caseInput.claimedBrand}" are internally consistent`
      );
    }

    // Weight combination: 60% Baseline A components + 40% Identity Claims
    // domainRisk (max 50) + pricingRisk (max 50) + identityRisk (max 45) -> scaled to 100 max
    const rawScore = (baseResult.componentScores?.domainRisk ?? 0) * 0.35 +
      (baseResult.componentScores?.pricingRisk ?? 0) * 0.25 +
      identityRisk;

    let compositeScore = Math.min(100, Math.round(rawScore));

    // Constraint: Never use discount threshold as proof on its own.
    // If identity is consistent and domain is established (> 365 days), discounts alone cannot cause PAUSE
    if (caseInput.merchantIdentityClaimsConsistent && caseInput.domainAgeDays > 365 && compositeScore >= 75) {
      compositeScore = 65;
      reasons.push('Identity claims consistent on mature domain; capped below block threshold');
    }

    const decision = scoreToDecision(compositeScore);
    const predictedFraud = isPredictedFraud(decision, compositeScore, config);

    return {
      decision,
      predictedFraud,
      score: compositeScore,
      reasons,
      componentScores: {
        ...(baseResult.componentScores || {}),
        identityRisk,
      },
    };
  }
}

