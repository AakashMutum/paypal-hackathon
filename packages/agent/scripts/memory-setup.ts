import 'dotenv/config';

import { createElasticMemory, ensureScamMemoryIndex } from '../src/adapters/memoryElastic.js';
import { loadSeeds } from '../src/memory/seeds.js';

/**
 * Creates the scam memory index and loads the seed cards.
 * Requires ELASTIC_URL and ELASTIC_API_KEY.
 */
const url = process.env.ELASTIC_URL;
const apiKey = process.env.ELASTIC_API_KEY;
const index = process.env.ELASTIC_INDEX?.trim() || 'guardian-scam-memory';
const inferenceId = process.env.ELASTIC_INFERENCE_ID?.trim() || undefined;

if (!url || !apiKey) {
  console.error('ELASTIC_URL and ELASTIC_API_KEY are required for memory setup.');
  process.exitCode = 1;
} else {
  const config = { url, apiKey, index, ...(inferenceId ? { inferenceId } : {}) };

  await ensureScamMemoryIndex(config);
  const memory = createElasticMemory(config);
  const written = await loadSeeds(memory, { timeoutMs: 5000 });

  console.log(`Index "${index}" is ready with ${written} seed cards.`);
}
