import { SCENARIOS } from '../src/fixtures/index.js';
import type { ScenarioFixture } from '../src/fixtures/types.js';
import { createFixtureSignals } from '../src/adapters/signalsAdapter.js';
import { createFixtureRegistry } from '../src/adapters/registryAdapter.js';
import { runInvestigatorAgentDetailed } from '../src/orchestrator.js';
import type { AgentDeps } from '../src/ports.js';

function depsFor(fixture: ScenarioFixture): AgentDeps {
  return {
    signals: createFixtureSignals(fixture),
    registry: createFixtureRegistry(fixture),
    now: () => Date.now(),
    log: () => undefined,
  };
}

const asJson = process.argv.includes('--json');
const rows: string[][] = [];
const goldens: Record<string, unknown>[] = [];

for (const [name, fixture] of Object.entries(SCENARIOS)) {
  const result = await runInvestigatorAgentDetailed(fixture.request, depsFor(fixture));

  rows.push([
    name,
    result.verdict.decision,
    String(result.verdict.score),
    result.verdict.confidence.toFixed(2),
    result.path,
    String(result.stats.ms),
    String(result.stats.llmCalls),
    String(result.stats.followUps),
    String(result.degraded),
  ]);

  goldens.push({
    scenario: name,
    decision: result.verdict.decision,
    score: result.verdict.score,
    confidence: result.verdict.confidence,
    path: result.path,
    hardRules: result.hardRulesTriggered.map((rule) => rule.rule),
    flaggedEvidenceIds: result.verdict.flaggedEvidenceIds,
    followUps: result.stats.followUps,
    llmCalls: result.stats.llmCalls,
    degraded: result.degraded,
  });
}

if (asJson) {
  console.log(JSON.stringify(goldens, null, 2));
} else {
  console.log('scenario | decision | score | confidence | path | ms | llmCalls | followUps | degraded');
  for (const row of rows) console.log(row.join(' | '));
}
