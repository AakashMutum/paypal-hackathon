/**
 * @file elasticMemoryStore.ts
 * @description Elasticsearch-backed implementation of MemoryStore.
 *
 * Rules:
 * - Reads ELASTIC_NODE and ELASTIC_API_KEY from environment variables (never hardcoded).
 * - Enforces mapping: investigationId, domain, claimedBrand, payeeMerchantId, payeeEmail,
 *   flaggedEvidenceTypes, decision = keyword; riskScore = float; timestamp = date.
 * - Always runs sanitizeRecord before indexing.
 * - Auto-creates the index if missing.
 */

import { Client } from '@elastic/elasticsearch';
import { sanitizeRecord, normalizeDomain, normalizeEmail } from '../sanitizer.js';
import type { HistoricalRecord } from '../types/historicalRecord.js';
import type { MemoryStore, HistorySummary, HistorySummaryQuery } from './memoryStore.interface.js';
import { parseHistorySummaryQuery, buildHistorySummary } from './summaryUtils.js';

export const ELASTIC_MEMORY_MAPPING = {
  properties: {
    investigationId: { type: 'keyword' },
    domain: { type: 'keyword' },
    claimedBrand: { type: 'keyword' },
    payeeMerchantId: { type: 'keyword' },
    payeeEmail: { type: 'keyword' },
    flaggedEvidenceTypes: { type: 'keyword' },
    riskScore: { type: 'float' },
    decision: { type: 'keyword' },
    timestamp: { type: 'date' },
  },
} as const;

export interface ElasticMemoryStoreOptions {
  client?: Client;
  node?: string;
  apiKey?: string;
  indexName?: string;
}

export class ElasticMemoryStore implements MemoryStore {
  private readonly client: Client;
  private readonly indexName: string;
  private indexChecked = false;

  constructor(options: ElasticMemoryStoreOptions = {}) {
    this.indexName = options.indexName || process.env.ELASTIC_INDEX || 'checkout-guardian-memory';

    if (options.client) {
      this.client = options.client;
    } else {
      const node = options.node || process.env.ELASTIC_NODE;
      const apiKey = options.apiKey || process.env.ELASTIC_API_KEY;

      if (!node) {
        throw new Error('ELASTIC_NODE environment variable or options.node must be configured.');
      }

      this.client = new Client({
        node,
        auth: apiKey ? { apiKey } : undefined,
      });
    }
  }

  /**
   * Auto-creates the Elasticsearch index with specified mapping if missing.
   */
  async ensureIndex(): Promise<void> {
    if (this.indexChecked) {
      return;
    }

    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (!exists) {
        await this.client.indices.create({
          index: this.indexName,
          mappings: ELASTIC_MEMORY_MAPPING,
        });
      }
      this.indexChecked = true;
    } catch (err) {
      // If index already exists in race conditions, consider checked
      const errorObj = err as { meta?: { body?: { error?: { type?: string } } } };
      if (errorObj?.meta?.body?.error?.type === 'resource_already_exists_exception') {
        this.indexChecked = true;
        return;
      }
      throw err;
    }
  }

  /**
   * Sanitizes and indexes an investigation record.
   * Strips all PII and unallowed fields before persistence.
   */
  async indexInvestigation(record: unknown): Promise<HistoricalRecord> {
    const sanitized = sanitizeRecord(record);
    await this.ensureIndex();

    await this.client.index({
      index: this.indexName,
      id: sanitized.investigationId,
      document: sanitized,
      refresh: 'wait_for',
    });

    return sanitized;
  }

  /**
   * Finds historical records matching a storefront domain.
   */
  async findByDomain(domain: string): Promise<HistoricalRecord[]> {
    const normalized = normalizeDomain(domain);
    return this.searchByQuery({
      term: { domain: normalized },
    });
  }

  /**
   * Finds historical records matching an observed PayPal merchant ID.
   */
  async findByPayeeMerchantId(id: string): Promise<HistoricalRecord[]> {
    return this.searchByQuery({
      term: { payeeMerchantId: id.trim() },
    });
  }

  /**
   * Finds historical records matching an observed payee email address.
   */
  async findByPayeeEmail(email: string): Promise<HistoricalRecord[]> {
    const normalized = normalizeEmail(email);
    return this.searchByQuery({
      term: { payeeEmail: normalized },
    });
  }

  /**
   * Finds historical records claiming a specific brand name.
   */
  async findByBrand(brand: string): Promise<HistoricalRecord[]> {
    return this.searchByQuery({
      term: { claimedBrand: brand.trim() },
    });
  }

  /**
   * Summarizes historical investigations for a given domain or payee,
   * returning counts of prior WARN/BLOCK decisions and common flagged evidence types.
   */
  async getHistorySummary(query: string | HistorySummaryQuery): Promise<HistorySummary> {
    const parsed = parseHistorySummaryQuery(query);
    const shouldClauses: Array<Record<string, unknown>> = [];

    if (parsed.domain) {
      shouldClauses.push({ term: { domain: parsed.domain } });
    }
    if (parsed.payeeMerchantId) {
      shouldClauses.push({ term: { payeeMerchantId: parsed.payeeMerchantId } });
    }
    if (parsed.payeeEmail) {
      shouldClauses.push({ term: { payeeEmail: parsed.payeeEmail } });
    }

    if (shouldClauses.length === 0) {
      return buildHistorySummary([]);
    }

    const records = await this.searchByQuery({
      bool: {
        should: shouldClauses,
        minimum_should_match: 1,
      },
    });

    return buildHistorySummary(records);
  }

  /**
   * Internal search helper.
   */
  private async searchByQuery(query: Record<string, unknown>): Promise<HistoricalRecord[]> {
    await this.ensureIndex();

    const response = await this.client.search<HistoricalRecord>({
      index: this.indexName,
      query,
      size: 1000,
    });

    const hits = response.hits?.hits ?? [];
    return hits
      .map((hit) => hit._source)
      .filter((doc): doc is HistoricalRecord => doc !== undefined && doc !== null);
  }

  /**
   * Closes the underlying Elasticsearch client.
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}
