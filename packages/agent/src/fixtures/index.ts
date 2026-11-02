import type { ScenarioFixture } from './types.js';
import { scenarioA } from './scenario-a.js';
import { scenarioB } from './scenario-b.js';
import { scenarioC } from './scenario-c.js';
import { scenarioD2 } from './scenario-d2.js';

export const SCENARIOS = {
  A: scenarioA,
  B: scenarioB,
  C: scenarioC,
  D2: scenarioD2,
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export function loadScenario(name: string): ScenarioFixture {
  const key = String(name).trim().toUpperCase() as ScenarioName;
  const fixture = SCENARIOS[key];
  if (!fixture) {
    throw new Error(`Unknown scenario "${name}". Known scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
  }
  return fixture;
}

export type { ScenarioFixture } from './types.js';
