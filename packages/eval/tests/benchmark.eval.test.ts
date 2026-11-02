import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvaluation } from '../src/index.js';

test('runEvaluation generates reproducible eval-report.json with all metrics', async () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const testReportPath = path.resolve(currentDir, 'test-eval-report.json');

  try {
    const report = await runEvaluation({
      outputPath: testReportPath,
      silent: true,
    });

    // 1. Top-level metadata
    assert.ok(report.generatedAt);
    assert.equal(report.datasetSize, 50);

    // 2. perBaseline checks
    const baselineKeys = ['baselineA', 'baselineB', 'full'] as const;
    for (const key of baselineKeys) {
      const summary = report.perBaseline[key];
      assert.ok(summary, `perBaseline must contain ${key}`);
      assert.equal(typeof summary.tp, 'number');
      assert.equal(typeof summary.fp, 'number');
      assert.equal(typeof summary.tn, 'number');
      assert.equal(typeof summary.fn, 'number');
      assert.equal(summary.tp + summary.fp + summary.tn + summary.fn, 50);

      assert.ok(summary.precision >= 0 && summary.precision <= 1);
      assert.ok(summary.recall >= 0 && summary.recall <= 1);
      assert.ok(summary.f1 >= 0 && summary.f1 <= 1);
      assert.ok(summary.accuracy >= 0 && summary.accuracy <= 1);

      assert.ok(summary.latency.mean >= 0);
      assert.ok(summary.latency.p50 >= 0);
      assert.ok(summary.latency.p95 >= 0);
      assert.equal(summary.latency.count, 50);
    }

    // 3. Progressive performance hierarchy
    // Full classifier should achieve higher accuracy/F1 than Baseline A on this dataset
    assert.ok(
      report.perBaseline.full.accuracy >= report.perBaseline.baselineA.accuracy,
      `Full classifier (${report.perBaseline.full.accuracy}) should outperform Baseline A (${report.perBaseline.baselineA.accuracy})`,
    );

    // 4. perCaseResults
    for (const key of baselineKeys) {
      const caseResults = report.perCaseResults[key];
      assert.equal(caseResults.length, 50, `${key} must have exactly 50 per-case results`);
      assert.equal(caseResults[0].id, 'case-demo-001', 'Cases should be sorted by ID');
    }

    // 5. File verification
    assert.ok(fs.existsSync(testReportPath), 'eval-report.json file must be written');
    const fileContent = JSON.parse(fs.readFileSync(testReportPath, 'utf-8'));
    assert.equal(fileContent.datasetSize, 50);
    assert.ok(fileContent.perBaseline.full);
  } finally {
    if (fs.existsSync(testReportPath)) {
      fs.unlinkSync(testReportPath);
    }
  }
});
