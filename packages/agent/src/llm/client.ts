import type { ZodType } from 'zod';

/**
 * The model boundary. Everything above this line speaks structured JSON;
 * everything below it speaks text. Provider details never leak upwards.
 */

export type LlmTier = 'fast' | 'strong';
export type LlmMode = 'live' | 'record' | 'replay';

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type LlmErrorCode = 'timeout' | 'invalid_json' | 'schema' | 'provider' | 'aborted';

export interface LlmRequest<T> {
  tier: LlmTier;
  /** Static text only. Never contains anything from a web page. */
  system: string;
  /** Sanitised, delimited data and code-built facts. */
  user: string;
  schema: ZodType<T>;
  schemaName: string;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type LlmResult<T> =
  | { ok: true; data: T; latencyMs: number; usage?: LlmUsage; model?: string }
  | { ok: false; error: LlmErrorCode; detail?: string; latencyMs: number; model?: string };

export interface LlmClient {
  generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>>;
}

export interface RawLlmRequest {
  tier: LlmTier;
  system: string;
  user: string;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RawLlmResponse {
  text: string;
  usage?: LlmUsage;
  /** The model that actually produced the answer, after any fallback. */
  model?: string;
}

/** A provider returns text. Turning that text into validated data is the client's job. */
export interface LlmProvider {
  complete(request: RawLlmRequest): Promise<RawLlmResponse>;
}
