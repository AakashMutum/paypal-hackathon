import { ElasticPatternStore } from './elasticPatternStore.js';
import { InMemoryPatternStore } from './inMemoryPatternStore.js';
import { loadSeeds } from './seeds.js';
import type { PatternStore, PatternStoreOptions } from './types.js';

export interface CreatePatternStoreOptions extends PatternStoreOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Load the fictional seed patterns into an in-memory store. Default true. */
  seed?: boolean;
}

/**
 * The demo default is an in-memory store seeded with fictional patterns, so nothing needs
 * Elasticsearch. Elastic is used only when both ELASTIC_URL and ELASTIC_API_KEY are set; its
 * index is created by `npm run index:create -w @checkout-guardian/memory`.
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
  const store = new InMemoryPatternStore(options);
  if (options.seed !== false) await loadSeeds(store);
  return store;
}
