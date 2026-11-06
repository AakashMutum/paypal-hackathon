/**
 * Embedding providers for the local vector store.
 *
 * Gemini is used when a Gemini/LLM key is configured. A deterministic local hash embedding is
 * the honest fallback: it is lexical, not a neural embedding, and the diagnostics say so.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly model?: string;
  /** Returns a unit-length vector, or null when the provider is unavailable for this text. */
  embed(text: string): Promise<number[] | null>;
}

export interface EmbeddingProviderOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: (event: Record<string, unknown>) => void;
}

export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_EMBEDDING_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const LOCAL_DIMENSIONS = 256;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly cache = new Map<string, number[]>();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly log?: (event: Record<string, unknown>) => void;

  constructor(
    private readonly apiKey: string,
    options: EmbeddingProviderOptions = {},
  ) {
    const env = options.env ?? process.env;
    this.model =
      env.GEMINI_EMBEDDING_MODEL?.trim() ||
      env.LLM_EMBEDDING_MODEL?.trim() ||
      DEFAULT_GEMINI_EMBEDDING_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.log = options.log;
  }

  async embed(text: string): Promise<number[] | null> {
    const input = text.trim().slice(0, 8000);
    if (!input) return null;
    const cached = this.cache.get(input);
    if (cached) return cached;

    try {
      const response = await this.fetchImpl(`${GEMINI_EMBEDDING_BASE}/${encodeURIComponent(this.model)}:embedContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ content: { parts: [{ text: input }] } }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) {
        this.log?.({ evt: 'embedding_failed', provider: this.name, model: this.model, status: response.status });
        return null;
      }
      const body = (await response.json()) as { embedding?: { values?: unknown } };
      const values = body.embedding?.values;
      if (!Array.isArray(values)) return null;
      const vector = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
      if (vector.length === 0) return null;
      const normalized = normalize(vector);
      this.cache.set(input, normalized);
      return normalized;
    } catch (error) {
      this.log?.({
        evt: 'embedding_failed',
        provider: this.name,
        model: this.model,
        detail: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local-hash';
  readonly model = 'v1';

  async embed(text: string): Promise<number[] | null> {
    const vector = new Array<number>(LOCAL_DIMENSIONS).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1);
    if (tokens.length === 0) return null;
    for (const token of tokens) {
      vector[fnv1a(token) % LOCAL_DIMENSIONS] += 1;
    }
    return normalize(vector);
  }
}

export function createEmbeddingProvider(options: EmbeddingProviderOptions = {}): EmbeddingProvider {
  const env = options.env ?? process.env;
  const key = env.GEMINI_API_KEY?.trim() || env.LLM_API_KEY?.trim() || env.EMBEDDING_API_KEY?.trim();
  if (key) return new GeminiEmbeddingProvider(key, options);
  return new LocalHashEmbeddingProvider();
}

export function embeddingLabel(provider: EmbeddingProvider | undefined): string {
  if (!provider) return 'none';
  return provider.model ? `${provider.name}:${provider.model}` : provider.name;
}

export function cosineSimilarity(a: readonly number[] | undefined, b: readonly number[] | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function normalize(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  if (norm === 0) return vector;
  const length = Math.sqrt(norm);
  return vector.map((value) => value / length);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
