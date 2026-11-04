import type { ZodError, ZodType } from 'zod';
import type { LlmClient, LlmErrorCode, LlmProvider, LlmRequest, LlmResult } from './client.js';

/**
 * JSON handling shared by every model call.
 *
 * The model is asked for a single JSON object. If the reply is fenced, wrapped
 * in prose, or otherwise close, we extract the object. If it still fails to
 * validate, exactly one repair call is made — never more (invariant I5).
 */

export type ParseOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'invalid_json' | 'schema'; issues: string };

export const REPAIR_INSTRUCTION = 'Return only the corrected JSON object.';

export function extractJsonObject(text: unknown): unknown {
  if (typeof text !== 'string') return undefined;
  let value = text.trim();
  if (!value) return undefined;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
  if (fenced && fenced[1].trim()) value = fenced[1].trim();

  const direct = tryParse(value);
  if (direct !== undefined) return direct;

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;

  return tryParse(value.slice(start, end + 1));
}

export function parseJsonWithSchema<T>(text: unknown, schema: ZodType<T>): ParseOutcome<T> {
  const extracted = extractJsonObject(text);
  if (extracted === undefined) {
    return { ok: false, error: 'invalid_json', issues: 'no JSON object found' };
  }

  const parsed = schema.safeParse(extracted);
  if (parsed.success) return { ok: true, data: parsed.data };

  return { ok: false, error: 'schema', issues: summarizeIssues(parsed.error) };
}

export function summarizeIssues(error: ZodError): string {
  const parts = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
  const text = parts.join('; ');
  return text.length <= 300 ? text : `${text.slice(0, 297)}...`;
}

export function buildRepairMessage(originalUser: string, issues: string): string {
  return `${originalUser}\n\nYour previous reply was invalid: ${issues}. ${REPAIR_INSTRUCTION}`;
}

export interface JsonClientOptions {
  now?: () => number;
  maxRepairs?: number;
  log?: (event: Record<string, unknown>) => void;
}

interface AttemptOk {
  ok: true;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  model?: string;
}
interface AttemptFail {
  ok: false;
  error: LlmErrorCode;
  detail?: string;
  model?: string;
}

export function createJsonClient(provider: LlmProvider, options: JsonClientOptions = {}): LlmClient {
  const now = options.now ?? Date.now;
  const maxRepairs = options.maxRepairs ?? 1;

  return {
    async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      const started = now();
      let user = request.user;
      let failure: LlmResult<T> | null = null;

      for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
        const raw = await attemptCompletion(provider, request, user);
        if (!raw.ok) {
          return {
            ok: false,
            error: raw.error,
            detail: raw.detail,
            latencyMs: now() - started,
            ...(raw.model ? { model: raw.model } : {}),
          };
        }

        const parsed = parseJsonWithSchema(raw.text, request.schema);
        if (parsed.ok) {
          return {
            ok: true,
            data: parsed.data,
            latencyMs: now() - started,
            usage: raw.usage,
            ...(raw.model ? { model: raw.model } : {}),
          };
        }

        options.log?.({
          evt: 'llm_parse_failed',
          schemaName: request.schemaName,
          error: parsed.error,
          attempt,
        });

        failure = {
          ok: false,
          error: parsed.error,
          detail: parsed.issues,
          latencyMs: now() - started,
          ...(raw.model ? { model: raw.model } : {}),
        };
        user = buildRepairMessage(request.user, parsed.issues);
      }

      return failure ?? { ok: false, error: 'schema', latencyMs: now() - started };
    },
  };
}

class AttemptTimeoutError extends Error {
  constructor() {
    super('llm_timeout');
    this.name = 'AttemptTimeoutError';
  }
}

async function attemptCompletion<T>(
  provider: LlmProvider,
  request: LlmRequest<T>,
  user: string
): Promise<AttemptOk | AttemptFail> {
  if (request.signal?.aborted) {
    return { ok: false, error: 'aborted' };
  }

  const controller = new AbortController();
  const onExternalAbort = (): void => controller.abort();
  request.signal?.addEventListener('abort', onExternalAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AttemptTimeoutError());
    }, Math.max(1, request.timeoutMs));
    timer.unref?.();
  });

  try {
    const providerPromise = provider.complete({
      tier: request.tier,
      system: request.system,
      user,
      maxOutputTokens: request.maxOutputTokens,
      timeoutMs: request.timeoutMs,
      signal: controller.signal,
    });
    // Prevent floating unhandled rejection if timeout rejects first and provider rejects later on abort
    providerPromise.catch(() => {});

    const response = await Promise.race([
      providerPromise,
      timeout,
    ]);

    if (request.signal?.aborted) return { ok: false, error: 'aborted' };
    return {
      ok: true,
      text: response.text,
      usage: response.usage,
      ...(response.model ? { model: response.model } : {}),
    };
  } catch (error) {
    if (request.signal?.aborted) return { ok: false, error: 'aborted' };
    if (error instanceof AttemptTimeoutError) return { ok: false, error: 'timeout' };
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: 'provider', detail: truncate(detail, 200) };
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}
