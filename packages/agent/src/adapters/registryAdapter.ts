import type { CallOpts, RegistryLookup, RegistryPort, RegistryRecord } from '../ports.js';
import type { ScenarioFixture } from '../fixtures/types.js';
import { clone, createGate, type FixtureBehaviour } from './fixtureGate.js';
import { postJson } from './http.js';

const MAX_RECORDS = 5;

export function createFixtureRegistry(
  fixture: ScenarioFixture,
  behaviour: FixtureBehaviour = {}
): RegistryPort {
  const gate = createGate(behaviour);

  return {
    async lookup(input: RegistryLookup, _options: CallOpts): Promise<RegistryRecord[]> {
      await gate('lookup');
      const map =
        input.by === 'merchantId'
          ? fixture.registry.byMerchantId
          : input.by === 'name'
            ? fixture.registry.byName
            : fixture.registry.byDomain;

      const key = input.query.trim().toLowerCase();
      const match = Object.entries(map).find(([candidate]) => candidate.toLowerCase() === key);
      return match ? match[1].slice(0, MAX_RECORDS).map(clone) : [];
    },
  };
}

/** Live implementation; the endpoint contract is owned by the backend (Phase 12). */
export function createHttpRegistry(baseUrl: string, fetchImpl: typeof fetch = fetch): RegistryPort {
  const base = baseUrl.replace(/\/+$/, '');

  return {
    async lookup(input: RegistryLookup, options: CallOpts): Promise<RegistryRecord[]> {
      const records = await postJson<RegistryRecord[]>(`${base}/registry/lookup`, input, options, fetchImpl);
      return Array.isArray(records) ? records.slice(0, MAX_RECORDS) : [];
    },
  };
}
