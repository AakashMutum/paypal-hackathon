import { createEmbeddingProvider, type EmbeddingProvider } from './embeddings.js';
import { ElasticPatternStore } from './elasticPatternStore.js';
import { FilePatternStore } from './filePatternStore.js';
import { InMemoryPatternStore } from './inMemoryPatternStore.js';
import { loadSeeds } from './seeds.js';
import type { PatternStore, PatternStoreOptions } from './types.js';

export interface CreatePatternStoreOptions extends PatternStoreOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Load the fictional seed patterns when the store is empty. Default true. */
  seed?: boolean;
  /** When set, use the persistent JSON-file store at this path. */
  filePath?: string;
  /** Override the embedding provider (tests and custom deployments). */
  embeddingProvider?: EmbeddingProvider;
  log?: (event: Record<string, unknown>) => void;
}

/**
 * Chooses the strongest configured memory backend:
 *   1. Elasticsearch when ELASTIC_URL and ELASTIC_API_KEY are set.
 *   2. A persistent JSON file when `filePath` is provided.
 *   3. In-memory otherwise (tests and offline mode).
 */
export async function createPatternStore(options: CreatePatternStoreOptions = {}): Promise<PatternStore> {
  const env = options.env ?? process.env;
  const url = env.ELASTIC_URL;
  const apiKey = env.ELASTIC_API_KEY;
  if (url && apiKey) {
    return new ElasticPatternStore({
      ...options,
      url,
      apiKey,
      index: env.ELASTIC_INDEX,
      inferenceId: env.ELASTIC_INFERENCE_ID,
      fetchImpl: options.fetchImpl,
    });
  }

  const embeddingProvider =
    options.embeddingProvider ??
    createEmbeddingProvider({
      env,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.log ? { log: options.log } : {}),
    });

  if (options.filePath) {
    const store = new FilePatternStore({
      ...options,
      filePath: options.filePath,
      embeddingProvider,
    });
    await store.ensureIndex();
    if (options.seed !== false && (await store.size()) === 0) await loadSeeds(store);
    return store;
  }

  const store = new InMemoryPatternStore(options);
  if (options.seed !== false) await loadSeeds(store);
  return store;
}
