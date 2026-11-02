/**
 * @file signalsStandIn.ts
 * @description Pluggable interface and deterministic rule-based stand-in for Person 2 (Risk/Signals Agent).
 *
 * Designed behind an interface so the real Person 2 Agent can be plugged in when available.
 */

import {
  lookupPriorSignals,
  type MemoryStore,
  type PriorSignalsResult,
} from '@checkout-guardian/memory';
import type { EvaluationCase } from '../dataset/schema.js';

export interface SignalsEvaluationResult {
  /** Payee binding risk score contribution (0 - 100) */
  payeeBindingScore: number;
  /** Historical memory risk score contribution (0 - 100) */
  historicalMemoryScore: number;
  /** Explanatory findings from signals analysis */
  findings: string[];
  /** Historical memory signals summary if available */
  priorSignals?: PriorSignalsResult;
}

/**
 * Standard interface for the signals evaluation provider.
 */
export interface SignalsAgentProvider {
  readonly name: string;
  evaluate(
    caseInput: EvaluationCase,
    memoryStore?: MemoryStore
  ): Promise<SignalsEvaluationResult> | SignalsEvaluationResult;
}

/**
 * Deterministic rule-based stand-in provider implementing PayPal payee binding
 * and historical memory lookups.
 */
export class RuleBasedSignalsStandIn implements SignalsAgentProvider {
  readonly name = 'Rule-Based Signals Stand-In';

  async evaluate(
    caseInput: EvaluationCase,
    memoryStore?: MemoryStore
  ): Promise<SignalsEvaluationResult> {
    const findings: string[] = [];

    // 1. PayPal Payee Binding Analysis
    let payeeBindingScore = 0;
    const isPersonalEmail = /@(gmail|yahoo|hotmail|outlook|protonmail|tutanota)\.com$/i.test(
      caseInput.payeeEmail
    );

    if (caseInput.payeeMatchesDomain) {
      payeeBindingScore = 0;
      findings.push('PayPal payee matches storefront domain');
    } else {
      // Payee does not match storefront domain
      if (isPersonalEmail) {
        if (caseInput.merchantIdentityClaimsConsistent && caseInput.domainAgeDays > 60) {
          // Hard case: Legit sole proprietor/artisan using a personal PayPal email
          payeeBindingScore = 15;
          findings.push(
            'Personal payee email observed on storefront with consistent identity claims (potential sole proprietor)'
          );
        } else {
          // Personal/disposable email with inconsistent claims or brand new domain
          payeeBindingScore = 50;
          findings.push(
            `Suspicious personal webmail payee "${caseInput.payeeEmail}" mismatching storefront domain`
          );
        }
      } else {
        payeeBindingScore = 35;
        findings.push(
          `PayPal payee email "${caseInput.payeeEmail}" does not match storefront domain`
        );
      }
    }

    // 2. Historical Memory Lookup
    let historicalMemoryScore = 0;
    let priorSignals: PriorSignalsResult | undefined;

    try {
      let domain = caseInput.merchantUrl;
      try {
        domain = new URL(caseInput.merchantUrl).hostname;
      } catch {
        // fallback
      }

      priorSignals = await lookupPriorSignals(
        domain,
        caseInput.payeeMerchantId,
        caseInput.payeeEmail,
        memoryStore
      );

      if (priorSignals.priorBlockCount > 0) {
        historicalMemoryScore = Math.min(40, priorSignals.priorBlockCount * 20);
        findings.push(
          `Historical memory indicates ${priorSignals.priorBlockCount} prior blocked session(s). Types: ${priorSignals.evidenceTypes.join(', ')}. (${priorSignals.note})`
        );
      } else if (priorSignals.priorMatches > 0) {
        // Known clean merchant history provides mild mitigation
        historicalMemoryScore = -5;
        findings.push(
          `Historical memory shows ${priorSignals.priorMatches} prior benign session(s)`
        );
      }
    } catch {
      // If memory store lookup fails, treat as neutral
      findings.push('Historical memory lookup unavailable (neutral indicator)');
    }

    return {
      payeeBindingScore,
      historicalMemoryScore,
      findings,
      priorSignals,
    };
  }
}

