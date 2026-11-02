/**
 * @file baselineA.ts
 * @description Baseline A Classifier: Evaluates domain age and price discount ratio only.
 *
 * Rules:
 * - Deterministic scoring based strictly on domainAgeDays and (referencePrice - listedPrice)/referencePrice.
 * - Do not use the discount threshold as proof on its own: high discounts on mature domains
 *   must never trigger PAUSE/BLOCK independently.
 */

import type { EvaluationCase } from '../dataset/schema.js';
import {
  type BaselineClassifier,
  type ClassifierConfig,
  type ClassifierResult,
  isPredictedFraud,
  scoreToDecision,
} from './types.js';

export class BaselineAClassifier implements BaselineClassifier {
  readonly name = 'Baseline A (Domain Age + Price Discount)';

  classify(caseInput: EvaluationCase, config?: ClassifierConfig): ClassifierResult {
    const reasons: string[] = [];

    // 1. Calculate discount ratio
    const discountRatio = Math.max(
      0,
      (caseInput.referencePrice - caseInput.listedPrice) / caseInput.referencePrice
    );
    const discountPercent = Math.round(discountRatio * 100);

    // 2. Score domain age component (0 - 50 points)
    let domainRisk = 0;
    if (caseInput.domainAgeDays < 7) {
      domainRisk = 50;
      reasons.push(`Extremely new domain (${caseInput.domainAgeDays} days old)`);
    } else if (caseInput.domainAgeDays < 30) {
      domainRisk = 40;
      reasons.push(`Recently registered domain (${caseInput.domainAgeDays} days old)`);
    } else if (caseInput.domainAgeDays < 90) {
      domainRisk = 25;
      reasons.push(`Young domain (${caseInput.domainAgeDays} days old)`);
    } else if (caseInput.domainAgeDays < 180) {
      domainRisk = 10;
    } else {
      domainRisk = 0;
    }

    // 3. Score pricing component (0 - 50 points)
    let pricingRisk = 0;
    if (discountRatio >= 0.85) {
      pricingRisk = 50;
      reasons.push(`Extreme discount anomaly of ${discountPercent}%`);
    } else if (discountRatio >= 0.70) {
      pricingRisk = 40;
      reasons.push(`High discount anomaly of ${discountPercent}%`);
    } else if (discountRatio >= 0.50) {
      pricingRisk = 25;
      reasons.push(`Significant discount of ${discountPercent}%`);
    } else if (discountRatio >= 0.30) {
      pricingRisk = 10;
    } else {
      pricingRisk = 0;
    }

    // 4. Calculate composite score
    let compositeScore = domainRisk + pricingRisk;

    // Constraint: Never use discount threshold as proof on its own.
    // If domain is established (> 365 days), cap composite score at 50 (never reaches PAUSE/BLOCK 75+)
    if (caseInput.domainAgeDays > 365 && compositeScore > 50) {
      compositeScore = 50;
      reasons.push('Discount evaluated on established domain; capped below block threshold');
    }

    const decision = scoreToDecision(compositeScore);
    const predictedFraud = isPredictedFraud(decision, compositeScore, config);

    return {
      decision,
      predictedFraud,
      score: compositeScore,
      reasons,
      componentScores: {
        domainRisk,
        pricingRisk,
      },
    };
  }
}

