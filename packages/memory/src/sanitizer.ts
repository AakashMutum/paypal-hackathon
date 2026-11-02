/**
 * @file sanitizer.ts
 * @description Strict allowlist-based sanitizer for HistoricalRecord objects.
 *
 * Rules:
 * - Never store PII (customer names, card data, CVV, shipping/billing addresses).
 * - Strips any unknown extra fields via strict allowlist picking.
 * - Lowercases domain and email fields.
 */

import { DecisionTypes, type Decision } from './types/contracts-fallback.js';
import {
  HISTORICAL_RECORD_ALLOWED_KEYS,
  type HistoricalRecord,
} from './types/historicalRecord.js';

export class RecordSanitizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordSanitizationError';
  }
}

/**
 * Normalizes storefront domain to lowercase and removes protocol/trailing paths if present.
 */
export function normalizeDomain(rawDomain: string): string {
  if (typeof rawDomain !== 'string' || !rawDomain.trim()) {
    throw new RecordSanitizationError('Domain must be a non-empty string');
  }

  let cleaned = rawDomain.trim().toLowerCase();
  try {
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      const parsed = new URL(cleaned);
      cleaned = parsed.hostname;
    }
  } catch {
    // If URL parsing fails, continue with fallback string cleanup
  }

  // Strip path or query remnants
  cleaned = cleaned.replace(/[/?#].*$/, '');

  // Strip leading www. if present for consistency, or keep domain as hostname
  return cleaned;
}

/**
 * Normalizes email address to lowercase and trimmed string.
 */
export function normalizeEmail(rawEmail: string): string {
  if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
    throw new RecordSanitizationError('Payee email must be a non-empty string');
  }

  return rawEmail.trim().toLowerCase();
}

/**
 * Normalizes and validates ISO 8601 timestamp string.
 */
export function normalizeTimestamp(rawTimestamp: string | Date | unknown): string {
  if (rawTimestamp instanceof Date) {
    if (Number.isNaN(rawTimestamp.getTime())) {
      throw new RecordSanitizationError('Timestamp date is invalid');
    }
    return rawTimestamp.toISOString();
  }

  if (typeof rawTimestamp === 'string' && rawTimestamp.trim()) {
    const parsed = new Date(rawTimestamp.trim());
    if (Number.isNaN(parsed.getTime())) {
      throw new RecordSanitizationError(`Invalid timestamp format: "${rawTimestamp}"`);
    }
    return parsed.toISOString();
  }

  throw new RecordSanitizationError('Timestamp must be a valid ISO date string or Date object');
}

/**
 * Validates decision against allowed DecisionTypes.
 */
export function validateDecision(rawDecision: unknown): Decision {
  if (
    rawDecision === DecisionTypes.ALLOW ||
    rawDecision === DecisionTypes.WARN ||
    rawDecision === DecisionTypes.PAUSE
  ) {
    return rawDecision;
  }

  throw new RecordSanitizationError(
    `Invalid decision: "${String(rawDecision)}". Must be one of: ALLOW, WARN, PAUSE.`
  );
}

/**
 * Validates risk score as a float number.
 */
export function validateRiskScore(rawScore: unknown): number {
  const score = typeof rawScore === 'number' ? rawScore : parseFloat(String(rawScore));
  if (Number.isNaN(score) || !Number.isFinite(score)) {
    throw new RecordSanitizationError(`Risk score must be a finite float number, got: ${String(rawScore)}`);
  }
  return score;
}

/**
 * Sanitizes an incoming record by strictly picking only allowlisted fields,
 * transforming domains and emails to lowercase, validating formats,
 * and entirely dropping all PII and unknown extra fields.
 *
 * @param input Raw input candidate record
 * @returns A strictly sanitized HistoricalRecord containing only allowlisted fields
 */
export function sanitizeRecord(input: unknown): HistoricalRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new RecordSanitizationError('Input record must be a non-null object');
  }

  const record = input as Record<string, unknown>;

  // 1. investigationId
  const rawId = record.investigationId ?? record.id;
  if (typeof rawId !== 'string' || !rawId.trim()) {
    throw new RecordSanitizationError('investigationId must be a non-empty string');
  }
  const investigationId = rawId.trim();

  // 2. domain (lowercase)
  const rawDomain = record.domain ?? record.storefrontUrl;
  const domain = normalizeDomain(String(rawDomain ?? ''));

  // 3. claimedBrand
  const rawBrand = record.claimedBrand ?? record.claimedMerchantName ?? '';
  if (typeof rawBrand !== 'string') {
    throw new RecordSanitizationError('claimedBrand must be a string');
  }
  const claimedBrand = rawBrand.trim();

  // 4. payeeMerchantId
  const rawMerchantId = record.payeeMerchantId ?? record.merchantId ?? '';
  if (typeof rawMerchantId !== 'string') {
    throw new RecordSanitizationError('payeeMerchantId must be a string');
  }
  const payeeMerchantId = rawMerchantId.trim();

  // 5. payeeEmail (lowercase)
  const rawEmail = record.payeeEmail ?? record.email ?? '';
  const payeeEmail = normalizeEmail(String(rawEmail));

  // 6. riskScore (float)
  const riskScore = validateRiskScore(record.riskScore ?? record.overallScore);

  // 7. decision (ALLOW, WARN, PAUSE)
  const decision = validateDecision(record.decision);

  // 8. flaggedEvidenceTypes (string[])
  let flaggedEvidenceTypes: string[] = [];
  if (Array.isArray(record.flaggedEvidenceTypes)) {
    flaggedEvidenceTypes = record.flaggedEvidenceTypes
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } else if (record.flaggedEvidenceTypes === undefined || record.flaggedEvidenceTypes === null) {
    flaggedEvidenceTypes = [];
  } else {
    throw new RecordSanitizationError('flaggedEvidenceTypes must be an array of strings');
  }

  // 9. timestamp (ISO)
  const timestamp = normalizeTimestamp(record.timestamp ?? record.createdAt);

  // Strictly construct the output object with ONLY the 9 allowlisted fields.
  // Any extra properties (customerName, cardNumber, CVV, shippingAddress, etc.)
  // are never transferred.
  const sanitized: HistoricalRecord = {
    investigationId,
    domain,
    claimedBrand,
    payeeMerchantId,
    payeeEmail,
    riskScore,
    decision,
    flaggedEvidenceTypes,
    timestamp,
  };

  // Confirm that the returned record keys strictly match the allowed keys.
  const actualKeys = Object.keys(sanitized);
  for (const key of actualKeys) {
    if (!HISTORICAL_RECORD_ALLOWED_KEYS.includes(key as keyof HistoricalRecord)) {
      throw new RecordSanitizationError(`Unexpected key in sanitized record: ${key}`);
    }
  }

  return Object.freeze(sanitized);
}

