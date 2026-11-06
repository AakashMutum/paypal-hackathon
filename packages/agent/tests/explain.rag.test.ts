import assert from 'node:assert/strict';
import test from 'node:test';

import type { Evidence, Explanation } from '../src/types.js';
import { checkExplanation } from '../src/explain/checker.js';
import { buildWriterUser, writeExplanation } from '../src/explain/writer.js';
import { FakeLlm } from '../src/llm/fakeLlm.js';

const evidence: Evidence = {
  id: 'EVD-AGE-01',
  type: 'DOMAIN_AGE',
  severity: 'info',
  confidence: 1,
  summary: 'The domain was registered 4000 days ago.',
  source: 'rdap',
  deterministic: true,
  data: { ageDays: 4000 },
};

const retrieved = [
  {
    caseId: 'case-lookalike-1',
    patternText: 'A new store imitates a known brand and sells far below market price.',
    decision: 'PAUSE' as const,
    score: 0.82,
    retrieval: 'embedding',
  },
];

test('the writer prompt includes retrieved cases as context only', () => {
  const prompt = buildWriterUser({
    decision: 'WARN',
    score: 61,
    confidence: 0.7,
    evidence: [evidence],
    hardRules: [],
    retrievedCases: retrieved,
  });
  assert.match(prompt, /case-lookalike-1/);
  assert.match(prompt, /context only/i);
  assert.match(prompt, /never a reason to change the decision/i);
  assert.match(prompt, /retrievedCases/);
});

test('a valid retrieved case relevance is kept and an unknown case is dropped', () => {
  const candidate: Explanation = {
    headline: 'Payment held for review',
    bullets: [{ text: 'The website has been registered for 4000 days.', evidenceIds: ['EVD-AGE-01'] }],
    retrievedCases: [
      { caseId: 'case-lookalike-1', relevance: 'The same lookalike-and-discount pattern was seen before.' },
      { caseId: 'invented-case', relevance: 'This id was not provided.' },
    ],
  };
  const checked = checkExplanation({
    candidate,
    evidence: [evidence],
    decision: 'WARN',
    hardRules: [],
    allowedCaseIds: ['case-lookalike-1'],
  });
  assert.deepEqual(checked.explanation?.retrievedCases, [
    { caseId: 'case-lookalike-1', relevance: 'The same lookalike-and-discount pattern was seen before.' },
  ]);
});

test('an unsafe or URL-bearing relevance sentence is dropped', () => {
  const candidate: Explanation = {
    headline: 'Payment held for review',
    bullets: [{ text: 'The website has been registered for 4000 days.', evidenceIds: ['EVD-AGE-01'] }],
    retrievedCases: [
      { caseId: 'case-lookalike-1', relevance: 'Contact the seller at https://evil.example for details.' },
    ],
  };
  const checked = checkExplanation({
    candidate,
    evidence: [evidence],
    decision: 'WARN',
    hardRules: [],
    allowedCaseIds: ['case-lookalike-1'],
  });
  assert.equal(checked.explanation?.retrievedCases, undefined);
});

test('the Gemini writer can return validated retrieved-case relevance', async () => {
  const llm = new FakeLlm([
    {
      data: {
        headline: 'Payment held for review',
        bullets: [{ text: 'The website has been registered for 4000 days.', evidenceIds: ['EVD-AGE-01'] }],
        retrievedCases: [
          { caseId: 'case-lookalike-1', relevance: 'A similar lookalike-and-discount pattern was stored before.' },
        ],
      },
    },
  ]);

  const result = await writeExplanation(
    {
      decision: 'WARN',
      score: 61,
      confidence: 0.7,
      evidence: [evidence],
      hardRules: [],
      retrievedCases: retrieved,
    },
    { llm },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.explanation?.retrievedCases, [
    { caseId: 'case-lookalike-1', relevance: 'A similar lookalike-and-discount pattern was stored before.' },
  ]);
});
