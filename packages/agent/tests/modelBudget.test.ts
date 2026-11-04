import assert from 'node:assert/strict';
import test from 'node:test';

import { scenarioB } from '../src/fixtures/scenario-b.js';
import { FakeLlm, type FakeTurn } from '../src/llm/fakeLlm.js';
import { MODEL_BUDGET_EXHAUSTED, withModelBudget } from '../src/llm/budget.js';
import { loadConfig } from '../src/config.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import { AgentResultSchema } from '../src/types.js';
import { z } from 'zod';
import { depsFor } from './helpers.js';

const request = (timeoutMs = 5000) => ({
  tier: 'fast' as const,
  system: 's',
  user: 'u',
  schema: z.object({ ok: z.boolean() }),
  schemaName: 'T',
  maxOutputTokens: 10,
  timeoutMs,
});

test('AGENT_MODEL_BUDGET_MS defaults to 1200 and can be set; 0 means no limit', () => {
  const saved = process.env.AGENT_MODEL_BUDGET_MS;
  try {
    delete process.env.AGENT_MODEL_BUDGET_MS;
    assert.equal(loadConfig().modelBudgetMs, 1200);
    process.env.AGENT_MODEL_BUDGET_MS = '800';
    assert.equal(loadConfig().modelBudgetMs, 800);
    process.env.AGENT_MODEL_BUDGET_MS = '0';
    assert.equal(loadConfig().modelBudgetMs, 0);
    process.env.AGENT_MODEL_BUDGET_MS = 'not-a-number';
    assert.equal(loadConfig().modelBudgetMs, 1200);
  } finally {
    if (saved === undefined) delete process.env.AGENT_MODEL_BUDGET_MS;
    else process.env.AGENT_MODEL_BUDGET_MS = saved;
  }
});

test('calls inside the budget pass through and the budget stays open', async () => {
  const fake = new FakeLlm([{ data: { ok: true } }]);
  const { client, summary } = withModelBudget(fake, 1000);
  const result = await client.generateJson(request());
  assert.equal(result.ok, true);
  assert.equal(summary().exhausted, false);
  assert.equal(summary().skippedCalls, 0);
});

test('a call that starts after the budget is not sent', async () => {
  let clock = 0;
  const fake = new FakeLlm([{ data: { ok: true } }]);
  const { client, summary } = withModelBudget(fake, 1000, () => clock);
  await client.generateJson(request());
  clock = 1500;
  const late = await client.generateJson(request());
  assert.equal(late.ok, false);
  assert.equal(!late.ok && late.detail, MODEL_BUDGET_EXHAUSTED);
  assert.equal(fake.calls.length, 1, 'the second call must not reach the model');
  assert.equal(summary().exhausted, true);
  assert.equal(summary().skippedCalls, 1);
});

test('a call still running when the budget closes is cut off', async () => {
  const fake = new FakeLlm([{ delayMs: 400, data: { ok: true } }]);
  const { client, summary } = withModelBudget(fake, 50);
  const result = await client.generateJson(request());
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.detail, MODEL_BUDGET_EXHAUSTED);
  assert.equal(summary().exhausted, true);
});

test('the request timeout is lowered to what is left of the budget', async () => {
  const fake = new FakeLlm([{ data: { ok: true } }]);
  const { client } = withModelBudget(fake, 700);
  await client.generateJson(request(9000));
  assert.ok(fake.calls[0].timeoutMs <= 700);
});

const isInvestigator = (r: { schemaName: string }): boolean => r.schemaName === 'InvestigatorTurn';
const slow = (delayMs: number): FakeTurn[] => [
  { match: isInvestigator, delayMs, data: { action: 'finish', why: 'Done.' } },
  { match: (r) => r.schemaName === 'Explanation', delayMs, data: { headline: 'Held', bullets: [{ text: 'x', evidenceIds: ['EVD-SIG-B-DOMAIN-01'] }] } },
  { match: (r) => r.schemaName === 'PromotionalLanguage', delayMs, data: { tactics: [] } },
  { delayMs, data: {} },
];

test('an exhausted budget skips the remaining model steps and uses the deterministic output', async () => {
  const llm = new FakeLlm(slow(600));
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm), {
    modelBudgetMs: 200,
  });

  assert.equal(AgentResultSchema.safeParse(result).success, true);
  assert.equal(result.stats.modelBudget?.limitMs, 200);
  assert.equal(result.stats.modelBudget?.exhausted, true);
  assert.ok((result.stats.modelBudget?.skippedCalls ?? 0) >= 1);
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'model_budget');
  // The deterministic explanation is used, so the headline is a template headline, not "Held".
  assert.notEqual(result.explanation.headline, 'Held');
  // The decision comes from the deterministic evidence, whatever the model did.
  assert.ok(['ALLOW', 'WARN', 'PAUSE'].includes(result.verdict.decision));
});

test('the decision and score do not depend on the budget', async () => {
  const unlimited = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, new FakeLlm(slow(0))),
    { modelBudgetMs: 0 },
  );
  const limited = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, new FakeLlm(slow(600))),
    { modelBudgetMs: 150 },
  );
  assert.equal(limited.verdict.decision, unlimited.verdict.decision);
  assert.equal(limited.verdict.score, unlimited.verdict.score);
  assert.equal(unlimited.stats.modelBudget, undefined);
});

test('a fast model inside the budget is not marked degraded', async () => {
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, new FakeLlm(slow(0))), {
    modelBudgetMs: 1200,
  });
  assert.equal(result.stats.modelBudget?.exhausted, false);
  assert.notEqual(result.fallbackReason, 'model_budget');
});
