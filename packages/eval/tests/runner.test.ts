import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coldMemory,
  loadEvaluationDataset,
  renderMarkdown,
  runEvaluation,
  runFull,
  toScamRecord,
  toSummary,
  warmMemoryExcluding,
  type ScamRecord,
} from '../src/index.js';

test('two runs give identical metrics (latency aside)', async () => {
  const a = await runEvaluation({ commit: 'test', generatedAt: '2026-01-01T00:00:00.000Z' });
  const b = await runEvaluation({ commit: 'test', generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(toSummary(a), toSummary(b));
  assert.deepEqual(a.rows, b.rows);
});

test('the report covers every required measurement', async () => {
  const report = await runEvaluation({ commit: 'test' });
  assert.deepEqual(
    report.systems.map((s) => s.name),
    ['Baseline A', 'Baseline B', 'Full, cold memory', 'Full, warm memory'],
  );
  for (const s of report.systems) {
    assert.equal(s.rates.confusion.total, report.dataset.total);
    assert.ok(s.intervals.accuracy.low <= s.rates.accuracy && s.rates.accuracy <= s.intervals.accuracy.high);
    assert.ok(s.latency.p50 <= s.latency.p95 && s.latency.p95 <= s.latency.max);
    assert.ok(Object.keys(s.perCategory).length >= 8);
  }
  assert.ok(report.ablation.length >= 6);
  assert.equal(report.injection.hostileDetected, report.injection.hostileTotal);
  assert.equal(report.injection.harmlessUntouched, report.injection.harmlessTotal);
  for (const inv of report.invariants) assert.equal(inv.violations, 0, inv.name);
  assert.ok(report.faithfulness.explained > 0);
  assert.ok(report.memoryLift.warmRecords > 0);
});

test('warm memory never contains the case under test', async () => {
  const cases = loadEvaluationDataset()
    .filter((c) => c.label === 'fraud')
    .slice(0, 3);
  const records: ScamRecord[] = [];
  for (const c of cases) {
    const result = (await runFull(c, { memory: coldMemory() })).result;
    assert.ok(result);
    records.push(toScamRecord(c, result));
  }
  const memory = await warmMemoryExcluding(cases[0].id, records);
  const target = records[0].document as { registrableDomain: string; payeeMerchantId: string; patternText: string };
  const hits = await memory.search(
    { patternText: target.patternText, registrableDomain: target.registrableDomain, payeeMerchantId: target.payeeMerchantId },
    { timeoutMs: 100 },
  );
  assert.equal(
    hits.some((h) => h.matchType === 'exact_domain' || h.matchType === 'exact_payee'),
    false,
  );
});

test('the markdown report states its limitations and is not an accuracy claim', async () => {
  const report = await runEvaluation({ commit: 'abc1234', generatedAt: '2026-11-02T00:00:00.000Z' });
  const md = renderMarkdown(report);
  assert.match(md, /## Limitations/);
  assert.match(md, /synthetic/i);
  assert.match(md, /not a real-world accuracy claim/i);
  assert.match(md, /abc1234/);
});
