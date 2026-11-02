/**
 * @file memoryStore.interface.ts
 * @description Interface definition for Checkout Guardian investigation memory store.
 */

import type { HistoricalRecord } from '../types/historicalRecord.js';

export interface HistorySummaryQuery {
  domain?: string;
  payeeMerchantId?: string;
  payeeEmail?: string;
}

export interface EvidenceTypeCount {
  type: string;
  count: number;
}

export interface HistorySummary {
  /** Total matching investigations analyzed */
  totalCount: number;
  /** Count of investigations resulting in a WARN decision */
  warnCount: number;
  /** Count of investigations resulting in a BLOCK/PAUSE decision */
  blockCount: number;
  /** Alias for blockCount to match PAUSE contract naming */
  pauseCount: number;
  /** Count of investigations resulting in an ALLOW decision */
  allowCount: number;
  /** Flagged evidence types sorted descending by frequency */
  commonFlaggedEvidenceTypes: EvidenceTypeCount[];
}

export interface MemoryStore {
  /**
   * Sanitizes and indexes an investigation record.
   * Strips all PII and unallowed fields before persistence.
   */
  indexInvestigation(record: unknown): Promise<HistoricalRecord>;

  /**
   * Finds historical records matching a storefront domain.
   */
  findByDomain(domain: string): Promise<HistoricalRecord[]>;

  /**
   * Finds historical records matching an observed PayPal merchant ID.
   */
  findByPayeeMerchantId(id: string): Promise<HistoricalRecord[]>;

  /**
   * Finds historical records matching an observed payee email address.
   */
  findByPayeeEmail(email: string): Promise<HistoricalRecord[]>;

  /**
   * Finds historical records claiming a specific brand name.
   */
  findByBrand(brand: string): Promise<HistoricalRecord[]>;

  /**
   * Summarizes historical investigations for a given domain or payee,
   * returning counts of prior WARN/BLOCK decisions and common flagged evidence types.
   */
  getHistorySummary(query: string | HistorySummaryQuery): Promise<HistorySummary>;

  /**
   * Optional cleanup/disconnection hook.
   */
  close?(): Promise<void>;
}
