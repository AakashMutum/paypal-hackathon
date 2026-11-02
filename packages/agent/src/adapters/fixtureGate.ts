export interface FixtureBehaviour {
  /** Number of consecutive failures before a tool starts succeeding. */
  failures?: Partial<Record<string, number>>;
  /** Artificial latency per tool, in milliseconds. */
  delays?: Partial<Record<string, number>>;
}

export type FixtureGate = (tool: string) => Promise<void>;

export function createGate(behaviour: FixtureBehaviour = {}): FixtureGate {
  const counters = new Map<string, number>();

  return async function gate(tool: string): Promise<void> {
    const delay = behaviour.delays?.[tool] ?? 0;
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        timer.unref?.();
      });
    }

    const used = counters.get(tool) ?? 0;
    counters.set(tool, used + 1);

    const allowedFailures = behaviour.failures?.[tool] ?? 0;
    if (used < allowedFailures) {
      throw new Error(`fixture failure: ${tool}`);
    }
  };
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}
