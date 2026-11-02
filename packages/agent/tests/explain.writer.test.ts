import test from 'node:test';
import assert from 'node:assert/strict';

import type { Evidence, HardRuleTrigger } from '../src/types.js';
import { buildWriterUser, writeExplanation } from '../src/explain/writer.js';
import { FakeLlm, ScriptedProvider } from '../src/llm/fakeLlm.js';
import { createJsonClient } from '../src/llm/json.js';

const evidence: Evidence[] = [
  {
    id: 'EVD-DOMAIN',
    type: 'DOMAIN_AGE',
    severity: 'medium',
    confidence: 1,
    summary: 'The domain was registered twelve days ago.',
    source: 'rdap',
    deterministic: true,
    data: { ageDays: 12 },
  },
];

const hardRules: HardRuleTrigger[] = [];

test('the writer message carries the decision and the citable evidence', () => {
  const user = buildWriterUser({
    decision: 'WARN',
    score: 61,
    confidence: 0.95,
    evidence,
    hardRules,
  });

  assert.match(user, /Decision: WARN \(score 61, confidence 0\.95\)/);
  assert.ok(user.includes('EVD-DOMAIN'));
  assert.ok(user.includes('ageDays=12'));
  assert.match(user, /Every bullet must cite ids/);
});

test('the writer message lists hard rules when present', () => {
  const user = buildWriterUser({
    decision: 'PAUSE',
    score: 94,
    confidence: 0.99,
    evidence,
    hardRules: [{ rule: 'HF1', evidenceIds: ['EVD-DOMAIN'], description: 'test' }],
  });
  assert.match(user, /Hard rules: HF1 \(EVD-DOMAIN\)/);
});

test('the writer message includes identity gaps when provided', () => {
  const user = buildWriterUser({
    decision: 'WARN',
    score: 55,
    confidence: 0.8,
    evidence,
    hardRules,
    identityGaps: ['The registered city differs.'],
  });
  assert.match(user, /Identity gaps:/);
  assert.match(user, /The registered city differs\./);
});

test('without a client the writer is not attempted', async () => {
  const result = await writeExplanation({
    decision: 'WARN',
    score: 61,
    confidence: 0.9,
    evidence,
    hardRules,
  });
  assert.equal(result.attempted, false);
  assert.equal(result.ok, false);
});

test('the feature flag can disable the writer', async () => {
  const llm = new FakeLlm([{ data: { headline: 'x', bullets: [{ text: 'y', evidenceIds: ['EVD-DOMAIN'] }] } }]);
  const result = await writeExplanation(
    { decision: 'WARN', score: 61, confidence: 0.9, evidence, hardRules },
    { llm, useLlm: false }
  );
  assert.equal(result.attempted, false);
  assert.equal(llm.calls.length, 0);
});

test('a valid reply is returned as an explanation', async () => {
  const llm = new FakeLlm([
    {
      data: {
        headline: 'Payment held for review',
        bullets: [{ text: 'The site was registered twelve days ago.', evidenceIds: ['EVD-DOMAIN'] }],
      },
    },
  ]);

  const result = await writeExplanation(
    { decision: 'WARN', score: 61, confidence: 0.9, evidence, hardRules },
    { llm }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.ok, true);
  assert.equal(result.explanation?.bullets.length, 1);
});

test('a model failure is reported, not thrown', async () => {
  const llm = new FakeLlm([{ error: 'timeout' }]);
  const result = await writeExplanation(
    { decision: 'WARN', score: 61, confidence: 0.9, evidence, hardRules },
    { llm }
  );
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.equal(result.explanation, undefined);
});

test('an extra field in the reply is rejected by the schema', async () => {
  const provider = new ScriptedProvider([
    { text: '{"headline":"Held","bullets":[{"text":"A reason.","evidenceIds":["EVD-DOMAIN"],"score":0}]}' },
  ]);
  const client = createJsonClient(provider);

  const result = await writeExplanation(
    { decision: 'WARN', score: 61, confidence: 0.9, evidence, hardRules },
    { llm: client }
  );

  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 2);
});
