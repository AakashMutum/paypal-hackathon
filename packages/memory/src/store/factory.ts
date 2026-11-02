/**
 * @file factory.ts
 * @description Factory function for initializing MemoryStore with safe Elasticsearch fallback.
 *
 * Rules:
 * - Attempts to connect to Elasticsearch using ELASTIC_NODE and ELASTIC_API_KEY from env.
 * - If env is missing or Elasticsearch is unreachable (short timeout), logs a warning
 *   and gracefully falls back to InMemoryMemoryStore.
 */

import { Client } from '@elastic/elasticsearch';
import type { MemoryStore } from './memoryStore.interface.js';
import { InMemoryMemoryStore } from './inMemoryMemoryStore.js';
import { ElasticMemoryStore, type ElasticMemoryStoreOptions } from './elasticMemoryStore.js';

export interface CreateMemoryStoreOptions extends ElasticMemoryStoreOptions {
  /** Connection timeout in milliseconds before falling back to in-memory (default: 1500ms) */
  timeoutMs?: number;
  /** Custom logger for warning message (defaults to console.warn) */
  logger?: {
    warn: (message: string) => void;
  };
}

/**
 * Creates an instance of MemoryStore.
 * Tries ElasticMemoryStore first; falls back to InMemoryMemoryStore with a warning
 * if ELASTIC_NODE is missing or the Elasticsearch cluster is unreachable.
 */
export async function createMemoryStore(
  options: CreateMemoryStoreOptions = {}
): Promise<MemoryStore> {
  const logger = options.logger ?? console;
  const node = options.node ?? process.env.ELASTIC_NODE;
  const apiKey = options.apiKey ?? process.env.ELASTIC_API_KEY;
  const timeoutMs = options.timeoutMs ?? 1500;

  if (!node && !options.client) {
    logger.warn(
      '[MemoryStore] ELASTIC_NODE environment variable is missing; falling back to InMemoryMemoryStore.'
    );
    return new InMemoryMemoryStore();
  }

  try {
    const store = new ElasticMemoryStore({
      node,
      apiKey,
      indexName: options.indexName,
      client: options.client,
    });

    // Access underlying client to verify connectivity within timeout
    const client: Client = (store as unknown as { client: Client }).client;

    let timer: NodeJS.Timeout | undefined;
    try {
      const pingPromise = client.ping();
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Elasticsearch ping timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      });

      await Promise.race([pingPromise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    await store.ensureIndex();
    return store;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[MemoryStore] Elasticsearch connection failed (${message}); falling back to InMemoryMemoryStore.`
    );
    return new InMemoryMemoryStore();
  }
}

