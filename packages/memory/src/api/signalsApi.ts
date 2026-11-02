/**
 * @file signalsApi.ts
 * @description Documented, lightweight API for Person 2 (Signals / Risk Engine) to query prior indicators and persist investigations.
 *
 * Rules:
 * - Historical flags are indicators, not permanent blacklists or proof of fraud.
 * - All records are automatically sanitized before persistence (no PII stored).
 * - Zero agent logic: purely deterministic data retrieval and storage.
 */

import type { MemoryStore, HistorySummaryQuery } from '../store/memoryStore.interface.js';
import { createMemoryStore } from '../store/factory.js';
import type { HistoricalRecord } from '../types/historicalRecord.js';

export interface PriorSignalsResult {
  /** Total prior investigations matching the domain, payee merchant ID, or payee email */
  priorMatches: number;
  /** Number of prior investigations resulting in a WARN, BLOCK, or PAUSE decision */
  priorBlockCount: number;
  /** Distinct list of flagged evidence types observed across prior matches */
  evidenceTypes: string[];
  /** Mandatory indicator disclaimer: historical flags are contextual indicators, not proof of fraud */
  note: string;
}

export const HISTORICAL_INDICATORS_NOTE =
  'These are historical indicators, not proof of fraud or permanent blacklists. Evaluate in current session context.';

let defaultStoreInstance: MemoryStore | null = null;

/**
 * Returns or initializes a shared default MemoryStore instance (Elastic with fallback to InMemory).
 */
export async function getDefaultMemoryStore(): Promise<MemoryStore> {
  if (!defaultStoreInstance) {
    defaultStoreInstance = await createMemoryStore();
  }
  return defaultStoreInstance;
}

/**
 * Sets or resets the default MemoryStore instance (useful for dependency injection or testing).
 */
export function setDefaultMemoryStore(store: MemoryStore | null): void {
  defaultStoreInstance = store;
}

/**
 * Queries historical investigation signals for a storefront or payee.
 *
 * @param domain Storefront domain (e.g., "discount-shop.com" or "https://discount-shop.com/checkout")
 * @param payeeMerchantId Observed PayPal merchant ID (e.g., "M-12345")
 * @param payeeEmail Observed payee email (e.g., "merchant@example.com")
 * @param store Optional custom or injected MemoryStore instance (defaults to shared store)
 * @returns Prior signals summary including match count, prior blocks, evidence types, and disclaimer note
 */
export async function lookupPriorSignals(
  domain?: string,
  payeeMerchantId?: string,
  payeeEmail?: string,
  store?: MemoryStore
): Promise<PriorSignalsResult> {
  const cleanDomain = domain?.trim();
  const cleanMerchantId = payeeMerchantId?.trim();
  const cleanEmail = payeeEmail?.trim();

  // If no identifying query criteria provided, return empty baseline
  if (!cleanDomain && !cleanMerchantId && !cleanEmail) {
    return {
      priorMatches: 0,
      priorBlockCount: 0,
      evidenceTypes: [],
      note: HISTORICAL_INDICATORS_NOTE,
    };
  }

  const activeStore = store ?? (await getDefaultMemoryStore());

  const query: HistorySummaryQuery = {};
  if (cleanDomain) {
    query.domain = cleanDomain;
  }
  if (cleanMerchantId) {
    query.payeeMerchantId = cleanMerchantId;
  }
  if (cleanEmail) {
    query.payeeEmail = cleanEmail;
  }

  const summary = await activeStore.getHistorySummary(query);

  const evidenceTypes = summary.commonFlaggedEvidenceTypes.map((item) => item.type);

  return {
    priorMatches: summary.totalCount,
    priorBlockCount: summary.blockCount,
    evidenceTypes,
    note: HISTORICAL_INDICATORS_NOTE,
  };
}

/**
 * Sanitizes and persists a completed investigation into the memory store.
 * Automatically strips all customer PII (names, cards, CVV, addresses) and unknown fields.
 *
 * @param record Raw investigation record or HistoricalRecord
 * @param store Optional custom or injected MemoryStore instance (defaults to shared store)
 * @returns The sanitized, immutable HistoricalRecord that was persisted
 */
export async function saveInvestigation(
  record: unknown,
  store?: MemoryStore
): Promise<HistoricalRecord> {
  const activeStore = store ?? (await getDefaultMemoryStore());
  return activeStore.indexInvestigation(record);
}

