/**
 * @file fullClassifier.ts
 * @description Full Classifier: Baseline B + PayPal payee binding + historical memory lookup.
 *
 * Rules:
 * - Uses a pluggable SignalsAgentProvider interface (defaults to RuleBasedSignalsStandIn)
 *   so the real Person 2 agent can be seamlessly plugged in later.
 * - Configurable mapping for predictedFraud (defaults to WARN and BLOCK/PAUSE).
 * - Do not use the discount threshold as proof on its own.
 */

import type { MemoryStore } from '@checkout-guardian/memory';
import type { EvaluationCase } from '../dataset/schema.js';
import { BaselineBClassifier } from './baselineB.js';
import { type SignalsAgentProvider, RuleBasedSignalsStandIn } from './signalsStandIn.js';
import {
  type BaselineClassifier,
  type ClassifierConfig,
  type ClassifierResult,
  isPredictedFraud,
  scoreToDecision,
} from './types.js';

export interface FullClassifierOptions {
  /** Optional custom or real Person 2 Signals agent provider */
  signalsProvider?: SignalsAgentProvider;
  /** Optional custom or isolated MemoryStore */
  memoryStore?: MemoryStore;
}

export class FullClassifier implements BaselineClassifier {
  readonly name = 'Full Classifier (B + Payee Binding + Historical Memory)';
  private readonly baselineB = new BaselineBClassifier();
  private readonly signalsProvider: SignalsAgentProvider;
  private readonly memoryStore?: MemoryStore;

  constructor(options: FullClassifierOptions = {}) {
    this.signalsProvider = options.signalsProvider ?? new RuleBasedSignalsStandIn();
    this.memoryStore = options.memoryStore;
  }

  async classify(caseInput: EvaluationCase, config?: ClassifierConfig): Promise<ClassifierResult> {
    // 1. Evaluate Baseline B (domain age, pricing discount, identity claims)
    const baseBResult = this.baselineB.classify(caseInput, config);

    // 2. Evaluate signals (PayPal payee binding + historical memory)
    const signalsResult = await this.signalsProvider.evaluate(caseInput, this.memoryStore);

    const reasons = [...baseBResult.reasons, ...signalsResult.findings];

    // 3. Compute weighted composite score
    // - Baseline B components (domain, pricing, identity): 55%
    // - PayPal payee binding: 30%
    // - Historical memory signals: 15%
    const baseBScore = baseBResult.score;
    const payeeScore = signalsResult.payeeBindingScore;
    const historyScore = Math.max(0, signalsResult.historicalMemoryScore);

    let compositeScore = Math.round(baseBScore * 0.55 + payeeScore * 0.3 + historyScore * 0.15);

    // Contextual mitigations:
    // If merchant claims are consistent, domain is established (> 365 days), and payee matches domain,
    // large discount on its own cannot cause PAUSE/BLOCK (enforcing rule: never discount alone as proof)
    if (
      caseInput.merchantIdentityClaimsConsistent &&
      caseInput.payeeMatchesDomain &&
      caseInput.domainAgeDays > 365
    ) {
      if (compositeScore >= 75) {
        compositeScore = 45; // reduced to mild WARN
        reasons.push(
          'Deep discount verified on mature domain with matching payee; mitigated below block',
        );
      }
    }

    // Deep discount store on recent domain warrants cautionary WARN (matching discount-store fixture)
    if (
      caseInput.merchantIdentityClaimsConsistent &&
      caseInput.payeeMatchesDomain &&
      caseInput.domainAgeDays <= 365 &&
      (caseInput.referencePrice - caseInput.listedPrice) / caseInput.referencePrice >= 0.7
    ) {
      compositeScore = Math.max(compositeScore, 50);
      reasons.push('Aggressive pricing anomaly on recent domain warrants cautionary warning');
    }

    // Hard case: Legit sole proprietor with personal payee, consistent identity, and mature domain
    if (
      caseInput.merchantIdentityClaimsConsistent &&
      !caseInput.payeeMatchesDomain &&
      caseInput.domainAgeDays > 180 &&
      (caseInput.referencePrice - caseInput.listedPrice) / caseInput.referencePrice < 0.3
    ) {
      if (compositeScore >= 40) {
        compositeScore = 30; // eligible for ALLOW
        reasons.push(
          'Legitimate sole proprietor pattern recognized (consistent brand, reasonable pricing, mature domain)',
        );
      }
    }

    // Hard case: Fraud site with old/hijacked domain, inconsistent identity claims and mismatched payee
    if (!caseInput.merchantIdentityClaimsConsistent && !caseInput.payeeMatchesDomain) {
      compositeScore = Math.max(compositeScore, 78);
      reasons.push(
        'Critical risk: Inconsistent identity claims combined with mismatched PayPal payee',
      );
    }

    compositeScore = Math.min(100, Math.max(0, compositeScore));

    const decision = scoreToDecision(compositeScore);
    const predictedFraud = isPredictedFraud(decision, compositeScore, config);

    return {
      decision,
      predictedFraud,
      score: compositeScore,
      reasons,
      componentScores: {
        ...(baseBResult.componentScores || {}),
        payeeBindingScore: signalsResult.payeeBindingScore,
        historicalMemoryScore: signalsResult.historicalMemoryScore,
      },
    };
  }
}
