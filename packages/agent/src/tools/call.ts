import type { CallOpts } from '../ports.js';

/**
 * Runs one port call with a hard timeout and at most one retry (invariant I5).
 * The timeout is enforced here even if an adapter ignores the abort signal.
 */

export interface CallOutcome<T> {
  ok: boolean;
  value?: T;
  error?: string;
  ms: number;
  attempts: number;
}

export interface CallOptions {
  timeoutMs: number;
  attempts?: number;
  now?: () => number;
}

export async function callWithRetry<T>(
  fn: (options: CallOpts) => Promise<T>,
  options: CallOptions
): Promise<CallOutcome<T>> {
  const now = options.now ?? Date.now;
  const attempts = Math.max(1, options.attempts ?? 2);
  const started = now();
  let lastError = 'unknown error';

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await withTimeout(fn, options.timeoutMs);
      return { ok: true, value, ms: Math.max(0, now() - started), attempts: attempt + 1 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    ok: false,
    error: truncate(lastError, 160),
    ms: Math.max(0, now() - started),
    attempts,
  };
}

function withTimeout<T>(fn: (options: CallOpts) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`timed out after ${timeoutMs}ms`));
    }, Math.max(1, timeoutMs));
    timer.unref?.();

    fn({ signal: controller.signal, timeoutMs }).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

export function truncate(value: string, maxLength: number): string {
  const text = String(value ?? '');
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
