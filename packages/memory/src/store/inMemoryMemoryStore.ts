/**
 * @file inMemoryMemoryStore.ts
 * @description In-memory implementation of MemoryStore with identical behavior to ElasticMemoryStore.
 */

import { sanitizeRecord, normalizeDomain, normalizeEmail } from '../sanitizer.js';
import type { HistoricalRecord } from '../types/historicalRecord.js';
import type {
  MemoryStore,
  HistorySummary,
  HistorySummaryQuery,
} from './memoryStore.interface.js';
import { parseHistorySummaryQuery, buildHistorySummary } from './summaryUtils.js';

export class InMemoryMemoryStore implements MemoryStore {
  private readonly records = new Map<string, HistoricalRecord>();

  /**
   * Sanitizes and indexes an investigation record.
   * Strips all PII and unallowed fields before persistence.
   */
  async indexInvestigation(record: unknown): Promise<HistoricalRecord> {
    const sanitized = sanitizeRecord(record);
    this.records.set(sanitized.investigationId, sanitized);
    return sanitized;
  }

  /**
   * Finds historical records matching a storefront domain.
   */
  async findByDomain(domain: string): Promise<HistoricalRecord[]> {
    const normalized = normalizeDomain(domain);
    const results: HistoricalRecord[] = [];
    for (const record of this.records.values()) {
      if (record.domain === normalized) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Finds historical records matching an observed PayPal merchant ID.
   */
  async findByPayeeMerchantId(id: string): Promise<HistoricalRecord[]> {
    const target = id.trim().toLowerCase();
    const results: HistoricalRecord[] = [];
    for (const record of this.records.values()) {
      if (record.payeeMerchantId.toLowerCase() === target) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Finds historical records matching an observed payee email address.
   */
  async findByPayeeEmail(email: string): Promise<HistoricalRecord[]> {
    const normalized = normalizeEmail(email);
    const results: HistoricalRecord[] = [];
    for (const record of this.records.values()) {
      if (record.payeeEmail === normalized) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Finds historical records claiming a specific brand name.
   */
  async findByBrand(brand: string): Promise<HistoricalRecord[]> {
    const target = brand.trim().toLowerCase();
    const results: HistoricalRecord[] = [];
    for (const record of this.records.values()) {
      if (record.claimedBrand.toLowerCase() === target) {
        results.push(record);
      }
    }
    return results;
  }

  /**
   * Summarizes historical investigations for a given domain or payee,
   * returning counts of prior WARN/BLOCK decisions and common flagged evidence types.
   */
  async getHistorySummary(query: string | HistorySummaryQuery): Promise<HistorySummary> {
    const parsed = parseHistorySummaryQuery(query);
    const matched: HistoricalRecord[] = [];

    for (const record of this.records.values()) {
      let isMatch = false;
      if (parsed.domain && record.domain === parsed.domain) {
        isMatch = true;
      }
      if (parsed.payeeMerchantId && record.payeeMerchantId.toLowerCase() === parsed.payeeMerchantId.toLowerCase()) {
        isMatch = true;
      }
      if (parsed.payeeEmail && record.payeeEmail === parsed.payeeEmail) {
        isMatch = true;
      }

      if (isMatch) {
        matched.push(record);
      }
    }

    return buildHistorySummary(matched);
  }

  /**
   * Clears in-memory records.
   */
  async close(): Promise<void> {
    this.records.clear();
  }
}

