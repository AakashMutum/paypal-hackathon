/**
 * @file contracts-fallback.ts
 * @description Local fallback types for contracts not yet exported by @checkout-guardian/contracts.
 *
 * NOTE: Person 5 owns only /packages/memory and /packages/eval. Per repository guidelines,
 * when shared types (Evidence, Verdict, Decision, DecisionAudit) are missing from
 * @checkout-guardian/contracts, temporary local types are defined in a clearly marked file.
 */

import { DecisionTypes, type DecisionType } from '@checkout-guardian/contracts';

/**
 * Re-export or alias Decision to match DecisionType ('ALLOW' | 'WARN' | 'PAUSE').
 */
export type Decision = DecisionType;
export { DecisionTypes };

/**
 * Temporary local definition of Evidence until exported by contracts.
 */
export interface Evidence {
  type: string;
  source: string;
  value?: unknown;
  confidence?: number;
  details?: Record<string, unknown>;
}

/**
 * Temporary local definition of Verdict until exported by contracts.
 */
export interface Verdict {
  decision: Decision;
  score: number;
  reasons: string[];
  evidence: Evidence[];
}

/**
 * Temporary local definition of DecisionAudit until exported by contracts.
 */
export interface DecisionAudit {
  auditId: string;
  investigationId: string;
  timestamp: string;
  decision: Decision;
  verdict: Verdict;
}
