import test from 'node:test';
import assert from 'node:assert/strict';

import type { LlmRequest } from '../src/llm/client.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import { HEADLINES } from '../src/explain/template.js';
import { scenarioA } from '../src/fixtures/scenario-a.js';
import { scenarioB } from '../src/fixtures/scenario-b.js';
import { scenarioC } from '../src/fixtures/scenario-c.js';
import { FakeLlm } from '../src/llm/fakeLlm.js';
import { depsFor } from './helpers.js';

const isWriter = (request: LlmRequest<unknown>): boolean => request.schemaName === 'Explanation';

test('scenario C uses the writer output when it is valid', async () => {
  const llm = new FakeLlm([
    {
      match: isWriter,
      data: {
        headline: 'Payment stopped before capture',
        bullets: [
          {
            text: 'The payment account is not the registered merchant.',
            evidenceIds: ['EVD-SIG-C-BINDING-01'],
          },
        ],
      },
    },
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioC.request, depsFor(scenarioC, {}, llm));

  assert.equal(llm.calls.length, 1);
  assert.equal(result.explanation.headline, 'Payment stopped before capture');
  assert.deepEqual(result.explanation.bullets[0].evidenceIds, ['EVD-SIG-C-BINDING-01']);
  assert.equal(result.degraded, false);
  assert.equal(result.verdict.decision, 'PAUSE');
});

test('hard rules are still cited when the writer forgets them', async () => {
  const llm = new FakeLlm([
    {
      match: isWriter,
      data: {
        headline: 'Payment stopped',
        bullets: [{ text: 'The site was registered four days ago.', evidenceIds: ['EVD-SIG-C-DOMAIN-01'] }],
      },
    },
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioC.request, depsFor(scenarioC, {}, llm));

  const ids = result.explanation.bullets.flatMap((bullet) => bullet.evidenceIds);
  assert.ok(ids.includes('EVD-SIG-C-BINDING-01'), 'HF1 evidence should be cited');
  assert.ok(ids.includes('EVD-SIG-C-LOOKALIKE-01'), 'HF2 evidence should be cited');
});

test('an invented evidence ID sends the explanation back to the template', async () => {
  const llm = new FakeLlm([
    {
      match: isWriter,
      data: {
        headline: 'Payment stopped',
        bullets: [{ text: 'Something happened.', evidenceIds: ['EVD-FAKE'] }],
      },
    },
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioC.request, depsFor(scenarioC, {}, llm));

  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'explanation_fallback');
  assert.equal(result.explanation.headline, HEADLINES.PAUSE);
  assert.equal(result.verdict.decision, 'PAUSE');

  const ids = new Set(result.evidence.map((entry) => entry.id));
  for (const bullet of result.explanation.bullets) {
    for (const id of bullet.evidenceIds) assert.ok(ids.has(id));
  }
});

test('a banned word in the writer output falls back to the template', async () => {
  const llm = new FakeLlm([
    {
      match: isWriter,
      data: {
        headline: 'Payment stopped',
        bullets: [{ text: 'This seller is a fraud.', evidenceIds: ['EVD-SIG-C-BINDING-01'] }],
      },
    },
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioC.request, depsFor(scenarioC, {}, llm));
  assert.equal(result.degraded, true);
  assert.equal(result.fallbackReason, 'explanation_fallback');
});

test('the fast ALLOW path never calls the writer', async () => {
  const llm = new FakeLlm([
    { match: isWriter, data: { headline: 'x', bullets: [{ text: 'y', evidenceIds: ['EVD-SIG-A-DOMAIN-01'] }] } },
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioA.request, depsFor(scenarioA, {}, llm));

  assert.equal(llm.calls.length, 0);
  assert.equal(result.path, 'FAST_ALLOW');
  assert.equal(result.explanation.headline, HEADLINES.ALLOW);
});

test('an ambiguous case runs the investigator and then the writer', async () => {
  const llm = new FakeLlm([
    {
      match: (request) => request.schemaName === 'InvestigatorTurn',
      once: true,
      data: { action: 'finish', why: 'Enough evidence.' },
    },
    {
      match: (request) => request.schemaName === 'PromotionalLanguage',
      data: { tactics: [] },
    },
    {
      match: isWriter,
      data: {
        headline: 'Payment held for review',
        bullets: [{ text: 'The site was registered 12 days ago.', evidenceIds: ['EVD-SIG-B-DOMAIN-01'] }],
      },
    },
  ]);

  const result = await runInvestigatorAgentDetailed(scenarioB.request, depsFor(scenarioB, {}, llm));

  // The investigator turn, the promotional-language read and the writer.
  assert.equal(llm.calls.length, 3);
  assert.equal(result.explanation.headline, 'Payment held for review');
  assert.equal(result.verdict.score, 61);
  assert.equal(result.degraded, false);
});
