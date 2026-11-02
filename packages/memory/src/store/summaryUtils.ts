/**
 * @file summaryUtils.ts
 * @description Helper functions for parsing history queries and summarizing records.
 */

import { normalizeDomain, normalizeEmail } from '../sanitizer.js';
import type { HistoricalRecord } from '../types/historicalRecord.js';
import type {
  HistorySummary,
  HistorySummaryQuery,
  EvidenceTypeCount,
} from './memoryStore.interface.js';

/**
 * Parses a string or query object into a normalized HistorySummaryQuery.
 */
export function parseHistorySummaryQuery(rawQuery: string | HistorySummaryQuery): {
  domain?: string;
  payeeMerchantId?: string;
  payeeEmail?: string;
} {
  if (typeof rawQuery === 'string') {
    const trimmed = rawQuery.trim();
    if (trimmed.includes('@')) {
      return { payeeEmail: normalizeEmail(trimmed) };
    }
    // If it looks like a merchant ID (e.g. starts with M- or contains no dots and uppercase)
    if (trimmed.startsWith('M-') || (/^[A-Z0-9_-]{8,}$/i.test(trimmed) && !trimmed.includes('.'))) {
      return { payeeMerchantId: trimmed };
    }
    // Fallback: treated as storefront domain
    try {
      return { domain: normalizeDomain(trimmed) };
    } catch {
      return { domain: trimmed.toLowerCase() };
    }
  }

  const result: { domain?: string; payeeMerchantId?: string; payeeEmail?: string } = {};
  if (rawQuery.domain) {
    try {
      result.domain = normalizeDomain(rawQuery.domain);
    } catch {
      result.domain = rawQuery.domain.trim().toLowerCase();
    }
  }
  if (rawQuery.payeeMerchantId) {
    result.payeeMerchantId = rawQuery.payeeMerchantId.trim();
  }
  if (rawQuery.payeeEmail) {
    try {
      result.payeeEmail = normalizeEmail(rawQuery.payeeEmail);
    } catch {
      result.payeeEmail = rawQuery.payeeEmail.trim().toLowerCase();
    }
  }
  return result;
}

/**
 * Computes HistorySummary (WARN/BLOCK counts, evidence frequencies) from a list of records.
 */
export function buildHistorySummary(records: HistoricalRecord[]): HistorySummary {
  let warnCount = 0;
  let blockCount = 0;
  let allowCount = 0;
  const evidenceFrequencies = new Map<string, number>();

  for (const record of records) {
    const decisionUpper = (record.decision || '').toUpperCase();
    if (decisionUpper === 'WARN') {
      warnCount += 1;
    } else if (decisionUpper === 'PAUSE' || decisionUpper === 'BLOCK') {
      blockCount += 1;
    } else if (decisionUpper === 'ALLOW') {
      allowCount += 1;
    }

    if (Array.isArray(record.flaggedEvidenceTypes)) {
      for (const evType of record.flaggedEvidenceTypes) {
        if (typeof evType === 'string' && evType.trim()) {
          const key = evType.trim();
          evidenceFrequencies.set(key, (evidenceFrequencies.get(key) || 0) + 1);
        }
      }
    }
  }

  const commonFlaggedEvidenceTypes: EvidenceTypeCount[] = Array.from(evidenceFrequencies.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return {
    totalCount: records.length,
    warnCount,
    blockCount,
    pauseCount: blockCount,
    allowCount,
    commonFlaggedEvidenceTypes,
  };
}
