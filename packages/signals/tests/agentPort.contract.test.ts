import assert from 'node:assert/strict';
import test from 'node:test';
// The agent's recorded scenarios are the contract for evidence type names.
import { SCENARIOS } from '../../agent/src/fixtures/index.js';
import { createLocalSignalsPort } from '../src/agentPort/port.js';
import type { AgentEvidence } from '../src/agentPort/types.js';
import { baseOptions, callOpts, channel3With } from './agentPort.helpers.js';

const scenarios = Object.values(SCENARIOS);
const allScenarioTypes = new Set(scenarios.flatMap((s) => s.signalsEvidence.map((e) => e.type)));
// Named by the agent (packages/agent/src/adapters/signalsAdapter.ts and scoring/pointsFor.ts) but not
// present in any recorded scenario.
const UNRECORDED_BUT_KNOWN = ['TLS_INVALID', 'PRICE_UNKNOWN', 'TOOL_UNAVAILABLE'];
const SEVERITIES = new Set(['info', 'low', 'medium', 'high']);
const SOURCES = new Set(['rdap', 'tls', 'kernel', 'channel3', 'registry', 'paypal', 'elastic', 'llm', 'rule']);

function checkShape(e: AgentEvidence): void {
  assert.ok(e.id.length > 0 && e.id.length <= 80, `id length of ${e.id}`);
  assert.ok(e.type.length > 0 && e.type.length <= 60);
  assert.ok(SEVERITIES.has(e.severity), `severity ${e.severity}`);
  assert.ok(SOURCES.has(e.source), `source ${e.source}`);
  assert.ok(e.confidence >= 0 && e.confidence <= 1);
  assert.ok(e.summary.length > 0 && e.summary.length <= 240);
  assert.equal(typeof e.deterministic, 'boolean');
}

for (const scenario of scenarios) {
  test(`live port replaying scenario ${scenario.name} uses only evidence types that scenario uses`, async () => {
    const byType = (type: string) => scenario.signalsEvidence.find((e) => e.type === type);
    const age = byType('DOMAIN_AGE')?.data?.ageDays as number | undefined;
    const binding = byType('PAYEE_BINDING')?.data as
      | { status: string; expectedMerchantId?: string; actualMerchantId?: string }
      | undefined;
    const price = byType('PRICE_DEVIATION')?.data as { medianPrice: number; offerCount: number } | undefined;
    const bindingId =
      binding?.status === 'MATCH' || binding?.status === 'MISMATCH' ? binding.expectedMerchantId : null;

    const port = createLocalSignalsPort(
      baseOptions(
        { rdapDaysAgo: age, bindingMerchantId: bindingId },
        {
          knownBrandDomains: ['veloura-outdoor.example'],
          channel3: price ? channel3With(price.medianPrice, price.offerCount) : undefined,
          claimedBrand: scenario.request.claimedBrand,
        },
      ),
    );

    const domain = new URL(scenario.request.merchantUrl).hostname;
    const out: AgentEvidence[] = [
      ...(await port.getDomainReport(domain, callOpts)),
      ...(await port.checkPayeeBinding(
        { domain, payee: scenario.request.payee, claimedBrand: scenario.request.claimedBrand },
        callOpts,
      )),
      ...(await port.getPriceReport(
        { claims: scenario.claims, items: scenario.request.items, amount: scenario.request.transactionAmount },
        callOpts,
      )),
    ];

    const scenarioTypes = new Set(scenario.signalsEvidence.map((e) => e.type));
    for (const e of out) {
      checkShape(e);
      assert.ok(scenarioTypes.has(e.type), `${e.type} is not used by scenario ${scenario.name}`);
    }
    // The signals the scenario recorded are all reproduced.
    const outTypes = new Set(out.map((e) => e.type));
    for (const type of ['DOMAIN_AGE', 'LOOKALIKE_DOMAIN', 'PAYEE_BINDING', 'PRICE_DEVIATION']) {
      if (scenarioTypes.has(type)) assert.ok(outTypes.has(type), `${type} missing for scenario ${scenario.name}`);
    }
    // A recorded mismatch stays a hard fail.
    if (binding?.status === 'MISMATCH') {
      assert.equal(out.find((e) => e.type === 'PAYEE_BINDING')?.hardFail, true);
    }
  });
}

test('mock mode only uses evidence type names that some agent scenario uses', async () => {
  const port = createLocalSignalsPort({ mode: 'mock' });
  const stores = [
    ['www.harborline-outfitters.example', 'MERCH-HARBORLINE'],
    ['www.bargainbarn-outlet.example', 'MERCH-BARGAINBARN'],
    ['www.harborlyne-outfitters-sale.example', 'MERCH-HARBORLINE'],
  ];
  let total = 0;
  for (const [domain, merchantId] of stores) {
    const claims = await port.getPageClaims(`https://${domain}/`, callOpts);
    const out = [
      ...(await port.getDomainReport(domain, callOpts)),
      ...(await port.checkPayeeBinding({ domain, payee: { merchantId } }, callOpts)),
      ...(await port.getPriceReport({ claims }, callOpts)),
    ];
    assert.ok(out.length >= 3, domain);
    for (const e of out) {
      checkShape(e);
      assert.ok(
        allScenarioTypes.has(e.type) || UNRECORDED_BUT_KNOWN.includes(e.type),
        `${e.type} is not used by any scenario`,
      );
    }
    total += out.length;
  }
  assert.ok(total > 0);
});

test('mock mode keeps the impersonator hard fail and the genuine store clean', async () => {
  const port = createLocalSignalsPort({ mode: 'mock' });
  const genuine = await port.checkPayeeBinding(
    { domain: 'www.harborline-outfitters.example', payee: { merchantId: 'M' } },
    callOpts,
  );
  assert.equal((genuine[0].data as { status: string }).status, 'MATCH');
  const fake = await port.checkPayeeBinding(
    { domain: 'www.harborlyne-outfitters-sale.example', payee: { merchantId: 'M' } },
    callOpts,
  );
  assert.equal(fake[0].hardFail, true);
  const lookalike = await port.getDomainReport('www.harborlyne-outfitters-sale.example', callOpts);
  assert.ok(lookalike.some((e) => e.type === 'LOOKALIKE_DOMAIN'));
  assert.ok(lookalike.some((e) => e.type === 'TLS_INVALID'));
  const unknown = await port.getDomainReport('nobody.example', callOpts);
  assert.deepEqual(unknown, []);
});
