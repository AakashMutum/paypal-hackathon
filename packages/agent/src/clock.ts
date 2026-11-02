/**
 * Deadline helper for a single investigation.
 *
 * `step(maxMs)` returns the time a stage may use: never more than `maxMs` and
 * never so much that the 1000 ms reserved for scoring and validation is eaten.
 */

export const RESERVED_MS = 1000;

export interface Clock {
  readonly signal: AbortSignal;
  now(): number;
  elapsedMs(): number;
  remainingMs(): number;
  step(maxMs: number): number;
  isExpired(): boolean;
  dispose(): void;
}

export function makeClock(totalMs: number, now: () => number = Date.now): Clock {
  const startedAt = now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error('agent_deadline'));
  }, Math.max(0, totalMs));
  timer.unref?.();

  const remainingMs = (): number => Math.max(0, totalMs - (now() - startedAt));

  return {
    signal: controller.signal,
    now,
    elapsedMs: () => Math.max(0, now() - startedAt),
    remainingMs,
    step: (maxMs: number) => Math.max(0, Math.min(maxMs, remainingMs() - RESERVED_MS)),
    isExpired: () => remainingMs() <= 0,
    dispose: () => clearTimeout(timer),
  };
}
