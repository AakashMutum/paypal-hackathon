/**
 * @file historicalRecord.ts
 * @description Historical record model representing previous investigation findings.
 *
 * Rules:
 * - Never store PII (customer names, card numbers, CVV, shipping addresses).
 * - Historical records are indicators, not permanent blacklists.
 */

import type { Decision } from './contracts-fallback.js';

export interface HistoricalRecord {
  /** Unique investigation identifier */
  investigationId: string;
  /** Normalized lowercase storefront domain */
  domain: string;
  /** Brand claimed by the storefront */
  claimedBrand: string;
  /** Observed PayPal merchant identifier */
  payeeMerchantId: string;
  /** Observed normalized lowercase payee email address */
  payeeEmail: string;
  /** Risk score calculated during assessment (float 0.0 - 100.0) */
  riskScore: number;
  /** Final decision rendered (ALLOW, WARN, PAUSE) */
  decision: Decision;
  /** List of flagged risk evidence types associated with the session */
  flaggedEvidenceTypes: string[];
  /** ISO 8601 formatted timestamp of the investigation */
  timestamp: string;
}

export const HISTORICAL_RECORD_ALLOWED_KEYS: ReadonlyArray<keyof HistoricalRecord> = [
  'investigationId',
  'domain',
  'claimedBrand',
  'payeeMerchantId',
  'payeeEmail',
  'riskScore',
  'decision',
  'flaggedEvidenceTypes',
  'timestamp',
] as const;

