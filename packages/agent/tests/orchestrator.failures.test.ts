import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentResultSchema } from '../src/types.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import { scenarioA } from '../src/fixtures/scenario-a.js';
import { scenarioB } from '../src/fixtures/scenario-b.js';
import { FakeLlm } from '../src/llm/fakeLlm.js';
import { depsFor, mutate } from './helpers.js';

test('two surviving baseline tools force a WARN with low confidence', async () => {
  const result = await runInvestigatorAgentDetailed(
    scenarioA.request,
    depsFor(scenarioA, {
      failures: {
        getPageClaims: 99,
        getDomainReport: 99,
        checkPayeeBinding: 99,
        lookup: 99,
      },
    })
  );

  assert.equal(result.verdict.decision, 'WARN');
  assert.equal(result.verdict.confidence, 0.3);
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'tool_unavailable');
  assert.equal(AgentResultSchema.safeParse(result).success, true);
});

test('a failing identity model degrades to the deterministic comparison', async () => {
  const fixture = mutate(scenarioA, (draft) => {
    const binding = draft.signalsEvidence.find((entry) => entry.type === 'PAYEE_BINDING');
    if (binding) binding.data = { status: 'NO_BINDING', actualMerchantId: 'MERCH-A' };

    for (const records of Object.values(draft.registry.byMerchantId)) {
      for (const record of records) {
        record.legalName = 'Zenith Trading LLC';
        record.brandNames = [];
      }
    }
  });

  const llm = new FakeLlm([
    { match: (request) => request.schemaName === 'IdentityMatch', error: 'timeout' },
    {
      match: (request) => request.schemaName === 'Explanation',
      data: {
        headline: 'Payment held for review',
        bullets: [
          {
            text: 'The seller website is not linked to the receiving account.',
            evidenceIds: ['EVD-SIG-A-BINDING-01'],
          },
        ],
      },
    },
  ]);

  const result = await runInvestigatorAgentDetailed(
    fixture.request,
    depsFor(fixture, {}, llm),
    { features: { investigatorLoop: false } }
  );

  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'identity_llm_failed');
  assert.ok(result.evidence.some((entry) => entry.type === 'IDENTITY_MATCH'));
  assert.equal(AgentResultSchema.safeParse(result).success, true);
});

test('a slow model still finishes near the deadline and marks it', async () => {
  const llm = new FakeLlm([
    { once: true, delayMs: 4800, data: { action: 'finish', why: 'Done.' } },
  ]);

  const started = Date.now();
  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, llm),
    { timeoutMs: 4600, modelBudgetMs: 0 }
  );
  const elapsed = Date.now() - started;

  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'deadline');
  assert.equal(AgentResultSchema.safeParse(result).success, true);
  assert.ok(elapsed < 6500, `took ${elapsed}ms`);
});
