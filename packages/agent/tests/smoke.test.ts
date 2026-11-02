import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AgentResultSchema,
  VerdictSchema,
  type AgentResult,
} from '../src/types.js';
import { loadConfig } from '../src/config.js';
import { makeClock } from '../src/clock.js';
import { toOrderDecision, RISK_WEIGHTS } from '../src/adapters/contractsAdapter.js';

function baseResult(): AgentResult {
  return {
    verdict: {
      orderId: 'ORD-TEST-001',
      decision: 'ALLOW',
      score: 0,
      riskScore: 0,
      confidence: 0.92,
      summary: 'The seller checks passed.',
      flaggedEvidenceIds: [],
      recommendedAction: 'PROCEED',
    },
    evidence: [
      {
        id: 'EVD-AGT-REGISTRY_RECORD-01',
        type: 'REGISTRY_RECORD',
        severity: 'info',
        confidence: 1,
        summary: 'A registry record was found for the payee.',
        source: 'registry',
        deterministic: true,
      },
    ],
    trace: [
      {
        step: 1,
        tool: 'lookup_registry',
        why: 'Standard check',
        input: 'merchantId=MERCH-A',
        result: 'Registry: 1 record',
        evidenceIds: ['EVD-AGT-REGISTRY_RECORD-01'],
        ok: true,
        ms: 12,
      },
    ],
    explanation: {
      headline: 'Seller checks passed',
      bullets: [{ text: 'The seller checks passed.', evidenceIds: ['EVD-AGT-REGISTRY_RECORD-01'] }],
    },
    buckets: { domain: 0, merchant: 0, pricing: 0, technical: 0 },
    hardRulesTriggered: [],
    path: 'FAST_ALLOW',
    stats: { ms: 5, llmCalls: 0, followUps: 0, failedBaseline: 0 },
    degraded: false,
  };
}

test('agent result schema accepts a well formed result', () => {
  const parsed = AgentResultSchema.safeParse(baseResult());
  assert.equal(parsed.success, true);
});

test('decision vocabulary is ALLOW/WARN/PAUSE only', () => {
  const verdict = baseResult().verdict;
  assert.equal(VerdictSchema.safeParse({ ...verdict, decision: 'BLOCK' }).success, false);
  for (const decision of ['ALLOW', 'WARN', 'PAUSE'] as const) {
    assert.equal(VerdictSchema.safeParse({ ...verdict, decision }).success, true);
  }
});

test('configuration merges overrides without dropping untouched sections', () => {
  const config = loadConfig({ timeoutMs: 500, features: { memory: false } });
  assert.equal(config.timeoutMs, 500);
  assert.equal(config.features.memory, false);
  assert.equal(config.maxFollowUps, 5);
  assert.equal(config.maxToolCalls, 5);
  assert.ok(config.llm.modelFast.length > 0);
  assert.ok(['live', 'record', 'replay'].includes(config.llm.mode));
});

test('clock reserves the final second of the investigation budget', () => {
  let elapsed = 0;
  const clock = makeClock(12000, () => elapsed);
  try {
    assert.equal(clock.remainingMs(), 12000);
    assert.equal(clock.step(3000), 3000);

    elapsed = 8000;
    assert.equal(clock.remainingMs(), 4000);
    assert.equal(clock.step(5000), 3000);

    elapsed = 11800;
    assert.equal(clock.step(3000), 0);

    elapsed = 12500;
    assert.equal(clock.isExpired(), true);
  } finally {
    clock.dispose();
  }
});

test('contract adapter maps buckets onto the contract risk score fields', () => {
  const payload = toOrderDecision(baseResult());
  assert.equal(payload.decision, 'ALLOW');
  assert.equal(payload.actionTaken, 'PROCEED');
  assert.equal(payload.overallScore, 0);
  assert.deepEqual(payload.scores, {
    domainReputation: 0,
    merchantConsistency: 0,
    pricingAnomaly: 0,
    sslTechnical: 0,
  });
  assert.deepEqual(payload.weights, { ...RISK_WEIGHTS });
  assert.deepEqual(payload.reasons, ['The seller checks passed.']);
});
