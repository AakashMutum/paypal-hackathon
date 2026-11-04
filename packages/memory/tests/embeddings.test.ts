import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GeminiEmbeddingProvider,
  LocalHashEmbeddingProvider,
  cosineSimilarity,
  createEmbeddingProvider,
} from '../src/patterns/embeddings.js';

test('local hash embeddings are deterministic, unit length and lexical', async () => {
  const provider = new LocalHashEmbeddingProvider();
  const first = await provider.embed('lookalike outlet discount');
  const second = await provider.embed('lookalike outlet discount');
  assert.deepEqual(first, second);
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.length, 256);
  assert.ok(Math.abs(Math.hypot(...first) - 1) < 1e-9);
  const unrelated = await provider.embed('invoice accounting software');
  assert.ok(unrelated);
  assert.ok(cosineSimilarity(first, second) > cosineSimilarity(first, unrelated));
});

test('Gemini embeddings use the configure model, header and cache the result', async () => {
  const seen: Array<{ url: string; key: string | null; body: unknown }> = [];
  const provider = new GeminiEmbeddingProvider('test-gemini-key', {
    env: { GEMINI_EMBEDDING_MODEL: 'gemini-embedding-001' },
    fetchImpl: (async (input: string | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        key: new Headers(init?.headers).get('x-goog-api-key'),
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      return new Response(JSON.stringify({ embedding: { values: [3, 4] } }), { status: 200 });
    }) as typeof fetch,
  });

  const vector = await provider.embed('A store imitates a brand.');
  assert.deepEqual(vector, [0.6, 0.8]);
  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /gemini-embedding-001:embedContent$/);
  assert.equal(seen[0].key, 'test-gemini-key');
  assert.deepEqual(seen[0].body, { content: { parts: [{ text: 'A store imitates a brand.' }] } });

  await provider.embed('A store imitates a brand.');
  assert.equal(seen.length, 1, 'the second identical request must come from the cache');
});

test('a failed Gemini embedding returns null instead of throwing', async () => {
  const provider = new GeminiEmbeddingProvider('k', {
    fetchImpl: (async () => new Response('quota', { status: 429 })) as typeof fetch,
  });
  assert.equal(await provider.embed('text'), null);
});

test('the provider factory uses Gemini when a key exists and local hash otherwise', () => {
  assert.equal(createEmbeddingProvider({ env: { GEMINI_API_KEY: 'k' } }).name, 'gemini');
  assert.equal(createEmbeddingProvider({ env: { LLM_API_KEY: 'k' } }).name, 'gemini');
  assert.equal(createEmbeddingProvider({ env: {} }).name, 'local-hash');
});

test('cosine similarity handles empty and mismatched vectors safely', () => {
  assert.equal(cosineSimilarity([], []), 0);
  assert.equal(cosineSimilarity([1], [1, 2]), 0);
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});
