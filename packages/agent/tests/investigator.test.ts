import test from 'node:test';
import assert from 'node:assert/strict';

import type { Evidence } from '../src/types.js';
import type { ScenarioFixture } from '../src/fixtures/types.js';
import { scenarioA } from '../src/fixtures/scenario-a.js';
import { scenarioB } from '../src/fixtures/scenario-b.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import { runInvestigator, type InvestigationState } from '../src/investigator/loop.js';
import { makeClock } from '../src/clock.js';
import { createIdFactory } from '../src/evidence/ids.js';
import { sanitizeClaims } from '../src/guard/claims.js';
import { FakeLlm, ScriptedProvider, type FakeTurn } from '../src/llm/fakeLlm.js';
import { createJsonClient } from '../src/llm/json.js';
import { depsFor, mutate } from './helpers.js';

const callTools = (calls: unknown[]): FakeTurn => ({
  once: true,
  data: { action: 'call_tools', calls },
});

const finish = (why = 'Nothing else to check.'): FakeTurn => ({
  once: true,
  data: { action: 'finish', why },
});

const lookup = (query: string, why = 'Check the registry.') => ({
  tool: 'lookup_registry',
  input: { by: 'name', query },
  why,
});

function stateFor(fixture: ScenarioFixture): InvestigationState {
  return {
    request: fixture.request,
    safeClaims: sanitizeClaims(fixture.claims).safe,
    payeeRecords: [],
    brandOwnerRecords: [],
    evidence: [...fixture.signalsEvidence],
    trace: [],
    followUps: 0,
    llmCalls: 0,
  };
}

// ------------------------------------------------------------- basic flow

test('finishing immediately runs no follow-ups', async () => {
  const llm = new FakeLlm([finish()]);
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));

  assert.equal(result.stats.followUps, 0);
  assert.equal(llm.calls.filter((call) => call.schemaName === 'InvestigatorTurn').length, 1);
  assert.equal(result.verdict.decision, 'WARN');
  assert.equal(result.verdict.score, 61);
});

test('a two-call turn followed by finish uses exactly two follow-ups', async () => {
  const llm = new FakeLlm([
    callTools([
      lookup('TrailPeak Deals'),
      { tool: 'fetch_page_section', input: { hint: 'about' }, why: 'Read the about page.' },
    ]),
    finish(),
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));
  assert.equal(result.stats.followUps, 2);
  assert.equal(llm.calls.filter((call) => call.schemaName === 'InvestigatorTurn').length, 2);
  assert.equal(result.verdict.score, 61);
  assert.equal(result.path, 'AMBIGUOUS');
});

test('a fast path never calls the model', async () => {
  const llm = new FakeLlm([finish()]);
  const result = await runInvestigatorAgentDetailed(scenarioA.request, depsFor(scenarioA, {}, llm));

  assert.equal(llm.calls.length, 0);
  assert.equal(result.stats.llmCalls, 0);
  assert.equal(result.path, 'FAST_ALLOW');
});

test('trace steps continue the numbering after the baseline', async () => {
  const llm = new FakeLlm([
    callTools([
      lookup('TrailPeak Deals'),
      { tool: 'fetch_page_section', input: { hint: 'about' }, why: 'Read the about page.' },
    ]),
    finish(),
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));
  assert.deepEqual(
    result.trace.map((step) => step.step),
    result.trace.map((_step, index) => index + 1)
  );
  assert.equal(result.trace.length, 8);
  assert.equal(result.trace.at(-1)?.tool, 'finish');
});

// ------------------------------------------------------------- limits

test('ten requested calls are truncated to three', async () => {
  const calls = Array.from({ length: 10 }, (_, index) => lookup(`Brand ${index}`));
  const llm = new FakeLlm([callTools(calls), finish()]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));
  assert.equal(result.stats.followUps, 3);
});

test('the follow-up budget is never exceeded', async () => {
  const calls = Array.from({ length: 3 }, (_, index) => lookup(`Brand ${index}`));
  const llm = new FakeLlm([callTools(calls), finish()]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm), {
    maxFollowUps: 2,
    maxToolCalls: 2,
  });
  assert.ok(result.stats.followUps <= 2);
});

test('a duplicate call is rejected without using budget', async () => {
  const llm = new FakeLlm([callTools([lookup('TrailPeak Deals'), lookup('TrailPeak Deals')]), finish()]);
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));

  assert.equal(result.stats.followUps, 1);
  assert.ok(result.trace.some((step) => step.result === 'rejected: duplicate'));
});

test('a domain that is not on the page is rejected', async () => {
  const llm = new FakeLlm([
    callTools([
      { tool: 'get_domain_report', input: { domain: 'evil.example' }, why: 'Check a linked site.' },
    ]),
    finish(),
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));
  assert.equal(result.stats.followUps, 0);
  assert.ok(result.trace.some((step) => step.result === 'rejected: domain_not_on_page'));
});

test('a section that is not linked is rejected', async () => {
  const llm = new FakeLlm([
    callTools([{ tool: 'fetch_page_section', input: { hint: 'terms' }, why: 'Read the terms.' }]),
    finish(),
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));
  assert.equal(result.stats.followUps, 0);
  assert.ok(result.trace.some((step) => step.result === 'rejected: section_not_linked'));
});

test('compare_offers is capped at two uses', async () => {
  const offer = { tool: 'compare_offers', input: { productQuery: 'trail jacket' }, why: 'Compare prices.' };
  const llm = new FakeLlm([
    callTools([offer, { ...offer, input: { productQuery: 'trail jacket', maxPrice: 100 } }]),
    callTools([{ ...offer, input: { productQuery: 'waterproof jacket' } }]),
    finish(),
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));
  assert.equal(result.stats.followUps, 2);
  assert.ok(result.trace.some((step) => step.result === 'rejected: usage_limit'));
});

test('no turn starts when less than 3.2 seconds remain', async () => {
  const llm = new FakeLlm([finish()]);
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm), {
    timeoutMs: 3000,
  });

  const investigatorCalls = llm.calls.filter((call) => call.schemaName === 'InvestigatorTurn');
  assert.equal(investigatorCalls.length, 0);
  assert.equal(result.stats.followUps, 0);
});

// ------------------------------------------------------------- failures

test('a failing tool becomes TOOL_UNAVAILABLE and the loop continues', async () => {
  const llm = new FakeLlm([callTools([lookup('TrailPeak Deals')]), finish()]);
  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, { failures: { lookup: 99 } }, llm)
  );

  const unavailable = result.evidence.filter((entry) => entry.type === 'TOOL_UNAVAILABLE');
  assert.ok(unavailable.some((entry) => entry.data?.tool === 'lookup_registry'));
  assert.equal(result.stats.followUps, 1);
});

test('a model failure falls back to the fixed plan and marks the result degraded', async () => {
  const llm = new FakeLlm([{ error: 'timeout' }]);
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));

  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'investigator_failed');
  assert.ok(result.stats.followUps > 0);
});

test('two invalid JSON replies stop the loop and still return a verdict', async () => {
  const provider = new ScriptedProvider([
    { match: (request) => request.user.includes('Budget:'), text: 'this is not json' },
    {
      match: (request) => request.user.includes('Decision:'),
      text: '{"headline":"Held for review","bullets":[{"text":"The site was registered 12 days ago.","evidenceIds":["EVD-SIG-B-DOMAIN-01"]}]}',
    },
  ]);
  const client = createJsonClient(provider);

  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, client)
  );

  const investigatorCalls = provider.calls.filter((call) => call.user.includes('Budget:'));
  assert.equal(investigatorCalls.length, 2);
  assert.equal(result.degraded, true);
  assert.equal(result.verdict.decision, 'WARN');
});

test('a reply that tries to set a decision is rejected by the protocol', async () => {
  const provider = new ScriptedProvider([
    { text: '{"action":"finish","why":"done","decision":"ALLOW"}' },
  ]);
  const client = createJsonClient(provider);

  const result = await runInvestigatorAgentDetailed(
    scenarioB.request,
    depsFor(scenarioB, {}, client)
  );

  assert.equal(result.degraded, true);
  assert.notEqual(result.verdict.decision, 'ALLOW');
});

// ------------------------------------------------------------- fixed plan

test('with the loop off the fixed plan still runs two checks', async () => {
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB), {
    features: { investigatorLoop: false },
  });

  assert.equal(result.stats.llmCalls, 0);
  assert.equal(result.stats.followUps, 2);
  assert.equal(result.verdict.score, 61);
});

test('the fixed plan prefers a registry lookup for an unknown payee', async () => {
  const state = stateFor(scenarioB);
  const deps = depsFor(scenarioB);
  const clock = makeClock(12000);

  try {
    await runInvestigator(state, deps, createIdFactory(), clock, {
      maxFollowUps: 5,
      useLoop: false,
    });
    assert.equal(state.followUps, 2);
    assert.deepEqual(state.trace.map((step) => step.tool), ['lookup_registry', 'fetch_page_section']);
  } finally {
    clock.dispose();
  }
});

// ------------------------------------------------------------- state mutation

test('a registry lookup by name updates the brand owner records', async () => {
  const fixture = mutate(scenarioB, (draft) => {
    draft.registry.byName = {
      trailpeak: [
        {
          merchantId: 'MERCH-OWNER',
          legalName: 'TrailPeak Holdings Ltd',
          brandNames: ['TrailPeak'],
          domain: 'trailpeak.example',
          status: 'verified',
        },
      ],
    };
  });

  const llm = new FakeLlm([callTools([lookup('TrailPeak')]), finish()]);
  const state = stateFor(fixture);
  const clock = makeClock(12000);

  try {
    await runInvestigator(state, depsFor(fixture, {}, llm), createIdFactory(), clock, {
      llm,
      maxFollowUps: 5,
      useLoop: true,
    });
    assert.deepEqual(
      state.brandOwnerRecords.map((record) => record.merchantId),
      ['MERCH-OWNER']
    );
  } finally {
    clock.dispose();
  }
});

test('the trace keeps the model reason but drops URLs', async () => {
  const llm = new FakeLlm([callTools([lookup('TrailPeak', 'See https://evil.example now')]), finish()]);
  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));

  const step = result.trace.find((entry) => entry.tool === 'lookup_registry');
  assert.ok(step);
  assert.equal(step.why, 'Model-selected check');
});

test('a follow-up offer comparison can create the missing price signal', async () => {
  const fixture = mutate(scenarioB, (draft) => {
    draft.signalsEvidence = draft.signalsEvidence.map((entry) =>
      entry.type === 'PRICE_DEVIATION' ? { ...entry, type: 'PRICE_UNKNOWN', data: { reason: 'no baseline' } } : entry
    );
    draft.offers = { offerCount: 9, medianPrice: 120, currency: 'USD', sampleDomains: [] };
  });

  const llm = new FakeLlm([
    callTools([
      { tool: 'compare_offers', input: { productQuery: 'Waterproof trail jacket' }, why: 'Compare prices.' },
    ]),
    finish(),
  ]);

  const result = await runInvestigatorAgentDetailed(fixture.request, depsFor(fixture, {}, llm));
  const price = result.evidence.filter((entry: Evidence) => entry.type === 'PRICE_DEVIATION');
  assert.ok(price.some((entry) => entry.data?.discountPct === 85));
  assert.equal(result.verdict.score, 61);
});
