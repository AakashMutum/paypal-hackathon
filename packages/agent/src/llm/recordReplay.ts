import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LlmClient, LlmErrorCode, LlmMode, LlmRequest, LlmResult } from './client.js';
import { summarizeIssues } from './json.js';

/**
 * Record and replay.
 *
 * The cache key covers everything that can change the answer: tier, schema name,
 * system prompt and user message. Replay never calls the provider, which makes
 * the demo deterministic and removes network risk on demo day.
 */

export interface RecordReplayOptions {
  mode: LlmMode;
  dir: string;
  log?: (event: Record<string, unknown>) => void;
}

interface StoredEntry {
  key: string;
  tier: string;
  schemaName: string;
  savedAt: string;
  result:
    | { ok: true; data: unknown; usage?: { inputTokens?: number; outputTokens?: number } }
    | { ok: false; error: LlmErrorCode; detail?: string };
}

export function llmCacheKey(request: {
  tier: string;
  schemaName: string;
  system: string;
  user: string;
}): string {
  return createHash('sha256')
    .update([request.tier, request.schemaName, request.system, request.user].join('\u0000'))
    .digest('hex');
}

export function withRecordReplay(inner: LlmClient, options: RecordReplayOptions): LlmClient {
  if (options.mode === 'live') return inner;

  return {
    async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      const key = llmCacheKey(request);
      const path = join(options.dir, `${key}.json`);

      if (options.mode === 'replay') {
        return replay(request, path, key, options);
      }

      const result = await inner.generateJson(request);
      const entry: StoredEntry = {
        key,
        tier: request.tier,
        schemaName: request.schemaName,
        savedAt: new Date().toISOString(),
        result: result.ok
          ? { ok: true, data: result.data, usage: result.usage }
          : { ok: false, error: result.error, detail: result.detail },
      };

      try {
        await mkdir(options.dir, { recursive: true });
        await writeFile(path, JSON.stringify(entry, null, 2), 'utf8');
      } catch (error) {
        options.log?.({
          evt: 'llm_record_failed',
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      return result;
    },
  };
}

async function replay<T>(
  request: LlmRequest<T>,
  path: string,
  key: string,
  options: RecordReplayOptions
): Promise<LlmResult<T>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    options.log?.({ evt: 'llm_replay_miss', key, schemaName: request.schemaName });
    return { ok: false, error: 'provider', detail: 'replay_miss', latencyMs: 0 };
  }

  let entry: StoredEntry;
  try {
    entry = JSON.parse(raw) as StoredEntry;
  } catch {
    return { ok: false, error: 'provider', detail: 'replay_corrupt', latencyMs: 0 };
  }

  if (!entry?.result || typeof entry.result !== 'object') {
    return { ok: false, error: 'provider', detail: 'replay_corrupt', latencyMs: 0 };
  }

  if (!entry.result.ok) {
    return { ok: false, error: entry.result.error, detail: entry.result.detail, latencyMs: 0 };
  }

  const parsed = request.schema.safeParse(entry.result.data);
  if (!parsed.success) {
    return { ok: false, error: 'schema', detail: summarizeIssues(parsed.error), latencyMs: 0 };
  }

  return { ok: true, data: parsed.data, latencyMs: 0, usage: entry.result.usage };
}
