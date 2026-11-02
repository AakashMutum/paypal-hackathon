import type { AgentDeps, MemoryPort } from '../src/ports.js';
import type { LlmClient } from '../src/llm/client.js';
import { createFixtureSignals } from '../src/adapters/signalsAdapter.js';
import { createFixtureRegistry } from '../src/adapters/registryAdapter.js';
import type { FixtureBehaviour } from '../src/adapters/fixtureGate.js';
import type { ScenarioFixture } from '../src/fixtures/types.js';

export function depsFor(
  fixture: ScenarioFixture,
  behaviour: FixtureBehaviour = {},
  llm?: LlmClient,
  memory?: MemoryPort
): AgentDeps {
  return {
    signals: createFixtureSignals(fixture, behaviour),
    registry: createFixtureRegistry(fixture, behaviour),
    ...(llm ? { llm } : {}),
    ...(memory ? { memory } : {}),
    now: () => Date.now(),
    log: () => undefined,
  };
}

export function mutate<T>(value: T, change: (draft: T) => void): T {
  const copy = structuredClone(value);
  change(copy);
  return copy;
}

export function findEvidence<T extends { type: string }>(evidence: T[], type: string): T | undefined {
  return evidence.find((entry) => entry.type === type);
}
