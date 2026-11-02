import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Evidence,
  EvidenceSeverity,
  ISignalCollector,
  SignalCollectorOptions,
  SignalRequest,
} from '../types.js';
import { hostnameOf, makeEvidence } from '../util.js';

// src/mocks and dist/mocks are both four levels below the repository root.
const defaultFixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../tests/fixtures');

const KIND_TO_TYPE: Record<string, string> = {
  domain: 'DOMAIN_AGE',
  ssl: 'CERT_STATUS',
  merchant_identity: 'MERCHANT_IDENTITY',
  pricing: 'PRICE_ANOMALY',
};
const SEVERITIES: ReadonlySet<string> = new Set(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/**
 * Maps one fixture evidence item defensively. Fixture items have id, kind, source, observation
 * and severity. They have no confidence or hardFail, so those get defaults. The fixture
 * verdict is deliberately ignored: this package never produces decisions.
 */
export function mapFixtureEvidence(item: unknown, index: number): Evidence {
  const raw = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
  const kind = asString(raw.kind, 'unknown');
  const severityText = asString(raw.severity, 'info').toUpperCase();
  const severity = (SEVERITIES.has(severityText) ? severityText : 'INFO') as EvidenceSeverity;
  return makeEvidence({
    id: asString(raw.id, `fixture-${index}`),
    type: KIND_TO_TYPE[kind] ?? kind.toUpperCase(),
    severity,
    confidence: 0.8,
    summary: asString(raw.observation, 'Fixture evidence without a description.'),
    source: 'mock-fixture',
    hardFail: false,
  });
}

export interface Fixture {
  storefrontHost: string;
  evidence: unknown[];
  request: Record<string, unknown>;
}

export function loadFixtures(dir: string = defaultFixturesDir): Fixture[] {
  const fixtures: Fixture[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      const data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as {
        request?: { storefrontUrl?: unknown };
        evidence?: unknown;
      };
      const url = data.request?.storefrontUrl;
      if (typeof url !== 'string' || !Array.isArray(data.evidence)) continue;
      fixtures.push({
        storefrontHost: hostnameOf(url),
        evidence: data.evidence,
        request: data.request as Record<string, unknown>,
      });
    } catch {
      // Skip unreadable fixtures; the collector reports MOCK_NO_FIXTURE for the request.
    }
  }
  return fixtures;
}

/** Offline collector that replays recorded evidence for the fictional demo stores. */
export class FixtureMockCollector implements ISignalCollector {
  name = 'mock-fixture';

  constructor(private readonly fixturesDir: string = defaultFixturesDir) {}

  async collect(request: SignalRequest, _options: SignalCollectorOptions): Promise<Evidence[]> {
    const host = hostnameOf(request.merchantUrl);
    const match = loadFixtures(this.fixturesDir).find((f) => f.storefrontHost === host);
    if (!match) {
      return [
        makeEvidence({
          type: 'MOCK_NO_FIXTURE',
          severity: 'INFO',
          confidence: 1,
          summary: `No recorded fixture for ${host}.`,
          source: this.name,
        }),
      ];
    }
    return match.evidence.map(mapFixtureEvidence);
  }
}
