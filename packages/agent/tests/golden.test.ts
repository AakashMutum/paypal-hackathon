import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SCENARIOS } from '../src/fixtures/index.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import { depsFor } from './helpers.js';

const FILES: Record<string, string> = {
  A: 'a.json',
  B: 'b.json',
  C: 'c.json',
  D2: 'd2.json',
};

for (const [name, file] of Object.entries(FILES)) {
  test(`scenario ${name} matches its golden file`, async () => {
    const golden = JSON.parse(
      readFileSync(new URL(`./golden/${file}`, import.meta.url), 'utf8')
    ) as {
      decision: string;
      score: number;
      confidence: number;
      path: string;
      hardRules: string[];
      flaggedEvidenceIds: string[];
      followUps: number;
      llmCalls: number;
      degraded: boolean;
    };

    const fixture = SCENARIOS[name as keyof typeof SCENARIOS];
    const result = await runInvestigatorAgentDetailed(fixture.request, depsFor(fixture));

    assert.equal(result.verdict.decision, golden.decision, 'decision');
    assert.equal(result.verdict.score, golden.score, 'score');
    assert.ok(
      Math.abs(result.verdict.confidence - golden.confidence) <= 0.01,
      `confidence ${result.verdict.confidence} vs ${golden.confidence}`
    );
    assert.equal(result.path, golden.path, 'path');
    assert.deepEqual(
      result.hardRulesTriggered.map((rule) => rule.rule),
      golden.hardRules,
      'hard rules'
    );
    assert.deepEqual(result.verdict.flaggedEvidenceIds, golden.flaggedEvidenceIds, 'flagged evidence');
    assert.equal(result.stats.followUps, golden.followUps, 'follow-ups');
    assert.equal(result.stats.llmCalls, golden.llmCalls, 'llm calls');
    assert.equal(result.degraded, golden.degraded, 'degraded');
  });
}

test('every golden verdict cites only evidence that exists', async () => {
  for (const fixture of Object.values(SCENARIOS)) {
    const result = await runInvestigatorAgentDetailed(fixture.request, depsFor(fixture));
    const ids = new Set(result.evidence.map((entry) => entry.id));

    for (const id of result.verdict.flaggedEvidenceIds) assert.ok(ids.has(id), id);
    for (const bullet of result.explanation.bullets) {
      for (const id of bullet.evidenceIds) assert.ok(ids.has(id), id);
    }
  }
});
