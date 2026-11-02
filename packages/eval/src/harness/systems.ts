/**
 * The systems under comparison. Each takes a case and returns a decision. None reads the label.
 */

import {
  buildPatternFacts,
  bucketAge,
  bucketDiscount,
  createIdFactory,
  matchIdentity,
  pointsFor,
  runInvestigatorAgentDetailed,
  scoreAndDecide,
  templatePatternSentence,
  type AgentDeps,
  type AgentResult,
  type Decision,
  type DeepPartial,
  type InvestigatorAgentConfig,
} from '@checkout-guardian/agent';
import {
  InMemoryPatternStore,
  asAgentMemoryPort,
  type AgentMemoryPort,
} from '@checkout-guardian/memory';
import type { EvaluationCase } from '../dataset/schema.js';
import {
  buildRegistry,
  buildRequest,
  buildSignals,
  discountPct,
  domainAgeEvidence,
  hostOfUrl,
  payeeRegistryRecord,
  priceEvidence,
  registrableOf,
  type SignalSwitches,
} from './fixtures.js';

export interface Outcome {
  decision: Decision;
  score: number;
  ms: number;
  result?: AgentResult;
}

const now = (): number => performance.now();

export function baselineA(c: EvaluationCase): Outcome {
  const started = now();
  const scored = scoreAndDecide([domainAgeEvidence(c), priceEvidence(c)]);
  return { decision: scored.decision, score: scored.score, ms: now() - started };
}

export async function baselineB(c: EvaluationCase): Promise<Outcome> {
  const started = now();
  const record = payeeRegistryRecord(c);
  const identity = await matchIdentity(
    {
      siteName: c.claimedBrand,
      legalName: c.pageLegalName ?? undefined,
      claimedBrand: c.claimedBrand,
      payeeRecord: record
        ? { merchantId: record.merchantId, legalName: record.legalName, brandNames: record.brandNames, city: record.city, country: record.country }
        : null,
    },
    createIdFactory('EVD-B'),
    { useLlm: false },
  );
  const scored = scoreAndDecide([domainAgeEvidence(c), priceEvidence(c), ...identity.evidence]);
  return { decision: scored.decision, score: scored.score, ms: now() - started };
}

export interface FullOptions {
  memory?: AgentMemoryPort;
  signals?: SignalSwitches;
  registry?: boolean;
  overrides?: DeepPartial<InvestigatorAgentConfig>;
}

/** The full agent: deterministic fixtures, no language model, optional memory. */
export async function runFull(c: EvaluationCase, options: FullOptions = {}): Promise<Outcome> {
  const deps: AgentDeps = {
    signals: buildSignals(c, options.signals),
    registry: buildRegistry(c, options.registry ?? true),
    ...(options.memory ? { memory: options.memory } : {}),
    now: () => Date.now(),
    log: () => undefined,
  };
  const started = now();
  const result = await runInvestigatorAgentDetailed(buildRequest(c), deps, options.overrides);
  return { decision: result.verdict.decision, score: result.verdict.score, ms: now() - started, result };
}

export function coldMemory(): AgentMemoryPort {
  return asAgentMemoryPort(new InMemoryPatternStore({ minSimilarity: 0.2 }));
}

export interface ScamRecord {
  caseId: string;
  document: Record<string, unknown>;
}

/** Turns a cold run of a fraud-labelled case into the anonymous record that would have been stored. */
export function toScamRecord(c: EvaluationCase, result: AgentResult): ScamRecord {
  const evidence = result.evidence;
  const facts = buildPatternFacts(evidence);
  return {
    caseId: c.id,
    document: {
      registrableDomain: registrableOf(hostOfUrl(c.merchantUrl)),
      payeeMerchantId: c.payeeMerchantId,
      decision: 'PAUSE',
      riskScore: 0.9,
      evidenceTypes: [...new Set(evidence.filter((e) => (pointsFor(e)?.points ?? 0) > 0).map((e) => e.type))],
      domainAgeBucket: bucketAge(c.domainAgeDays),
      discountBucket: bucketDiscount(discountPct(c)),
      patternText: templatePatternSentence(facts),
    },
  };
}

/** Memory that holds every other fraud-labelled case, never the case under test. */
export async function warmMemoryExcluding(caseId: string, records: readonly ScamRecord[]): Promise<AgentMemoryPort> {
  const store = new InMemoryPatternStore({ minSimilarity: 0.2 });
  for (const r of records) {
    if (r.caseId === caseId) continue;
    try {
      await store.upsert(r.document);
    } catch {
      // A record the sanitizer refuses is simply not remembered.
    }
  }
  return asAgentMemoryPort(store);
}
