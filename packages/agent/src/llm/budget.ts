import type { LlmClient, LlmRequest, LlmResult } from './client.js';

/**
 * A time budget for all model calls of one investigation.
 *
 * The window opens when the first model call starts and is shared by calls that run in parallel.
 * A call that would start after the window has closed is not sent. A call still running when the
 * window closes is cut off. Both return a normal failed result, so every caller falls back to its
 * deterministic output (the template explanation, the string-math identity match, no extra
 * follow-up checks). Nothing is disabled up front: with a fast model every step still runs.
 */

export const MODEL_BUDGET_EXHAUSTED = 'model_budget_exhausted';

export interface ModelBudgetSummary {
  limitMs: number;
  /** Time from the first model call to the last one that finished or was cut off. */
  usedMs: number;
  exhausted: boolean;
  /** Calls that were not sent, or were cut off, because the budget ran out. */
  skippedCalls: number;
}

export interface BudgetedLlm {
  client: LlmClient;
  summary(): ModelBudgetSummary;
}

export function withModelBudget(llm: LlmClient, limitMs: number, now: () => number = Date.now): BudgetedLlm {
  let openedAt: number | undefined;
  let lastEndAt: number | undefined;
  let exhausted = false;
  let skipped = 0;

  const cutOff = <T>(): LlmResult<T> => {
    exhausted = true;
    skipped += 1;
    return { ok: false, error: 'timeout', detail: MODEL_BUDGET_EXHAUSTED, latencyMs: 0 };
  };

  const client: LlmClient = {
    async generateJson<T>(request: LlmRequest<T>): Promise<LlmResult<T>> {
      const start = now();
      if (openedAt === undefined) openedAt = start;
      const remaining = limitMs - (start - openedAt);
      if (remaining <= 0) return cutOff<T>();

      let timer: NodeJS.Timeout | undefined;
      const expiry = new Promise<'expired'>((resolve) => {
        timer = setTimeout(() => resolve('expired'), remaining);
      });
      try {
        const outcome = await Promise.race([
          llm.generateJson({ ...request, timeoutMs: Math.max(1, Math.min(request.timeoutMs, remaining)) }),
          expiry,
        ]);
        if (outcome === 'expired') return cutOff<T>();
        return outcome;
      } finally {
        if (timer) clearTimeout(timer);
        lastEndAt = now();
      }
    },
  };

  return {
    client,
    summary: () => ({
      limitMs,
      usedMs: openedAt === undefined ? 0 : Math.max(0, Math.min(limitMs, (lastEndAt ?? openedAt) - openedAt)),
      exhausted,
      skippedCalls: skipped,
    }),
  };
}
