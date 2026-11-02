/**
 * @file evalRunner.ts
 * @description Benchmark harness: Runs all 3 baselines deterministically over the 50 dataset cases,
 * prints a console summary table, and writes eval-report.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { InMemoryMemoryStore } from '@checkout-guardian/memory';
import { loadEvaluationDataset } from '../dataset/loader.js';
import type { EvaluationCase } from '../dataset/schema.js';
import { BaselineAClassifier } from '../baselines/baselineA.js';
import { BaselineBClassifier } from '../baselines/baselineB.js';
import { FullClassifier } from '../baselines/fullClassifier.js';
import type { BaselineClassifier } from '../baselines/types.js';
import {
  calculateConfusionMatrix,
  calculateClassificationMetrics,
} from '../metrics/confusionMatrix.js';
import { calculateLatencyMetrics } from '../metrics/latency.js';
import type { EvalReport, BaselineSummaryMetrics, CaseEvaluationResult } from './types.js';

export interface RunEvaluationOptions {
  /** Optional custom output file path for eval-report.json */
  outputPath?: string;
  /** Whether to suppress console table printing (default: false) */
  silent?: boolean;
  /** Custom dataset if overriding default */
  dataset?: EvaluationCase[];
}

export function getDefaultReportPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // Resolves to packages/eval/eval-report.json
  return path.resolve(currentDir, '../../eval-report.json');
}

/**
 * Runs all 3 baselines over the 50 cases in fixed order and generates eval-report.json.
 */
export async function runEvaluation(options: RunEvaluationOptions = {}): Promise<EvalReport> {
  const silent = options.silent ?? false;
  const outputPath = options.outputPath || getDefaultReportPath();

  // 1. Load dataset and sort by ID for strict reproducibility
  const rawDataset = options.dataset || loadEvaluationDataset();
  const sortedDataset = [...rawDataset].sort((a, b) => a.id.localeCompare(b.id));

  // 2. Set up isolated memory store to ensure zero external network calls or state pollution
  const memoryStore = new InMemoryMemoryStore();

  // 3. Define the 3 baselines
  const baselines: Array<{ key: string; name: string; classifier: BaselineClassifier }> = [
    {
      key: 'baselineA',
      name: 'Baseline A (Domain + Discount)',
      classifier: new BaselineAClassifier(),
    },
    {
      key: 'baselineB',
      name: 'Baseline B (A + Identity Claims)',
      classifier: new BaselineBClassifier(),
    },
    {
      key: 'full',
      name: 'Full Classifier (B + Payee + Memory)',
      classifier: new FullClassifier({ memoryStore }),
    },
  ];

  const perBaseline: Record<string, BaselineSummaryMetrics> = {};
  const perCaseResults: Record<string, CaseEvaluationResult[]> = {};

  // 4. Execute benchmarks
  for (const { key, classifier } of baselines) {
    const caseResults: CaseEvaluationResult[] = [];
    const predictionRecords: Array<{
      actual: 'fraud' | 'legit';
      predicted: 'fraud' | 'legit';
      latencyMs: number;
    }> = [];

    for (const testCase of sortedDataset) {
      const startTime = performance.now();
      const result = await classifier.classify(testCase);
      const endTime = performance.now();
      const latencyMs = Number((endTime - startTime).toFixed(4));

      const predictedLabel: 'fraud' | 'legit' = result.predictedFraud ? 'fraud' : 'legit';
      const isCorrect = testCase.label === predictedLabel;

      caseResults.push({
        id: testCase.id,
        merchantUrl: testCase.merchantUrl,
        claimedBrand: testCase.claimedBrand,
        actual: testCase.label,
        predicted: predictedLabel,
        isCorrect,
        decision: result.decision,
        score: result.score,
        latencyMs,
        reasons: result.reasons,
      });

      predictionRecords.push({
        actual: testCase.label,
        predicted: predictedLabel,
        latencyMs,
      });
    }

    // Compute metrics
    const confusion = calculateConfusionMatrix(predictionRecords);
    const classification = calculateClassificationMetrics(confusion);
    const latency = calculateLatencyMetrics(predictionRecords.map((p) => p.latencyMs));

    perBaseline[key] = {
      tp: confusion.truePositives,
      fp: confusion.falsePositives,
      tn: confusion.trueNegatives,
      fn: confusion.falseNegatives,
      precision: Number(classification.precision.toFixed(4)),
      recall: Number(classification.recall.toFixed(4)),
      f1: Number(classification.f1Score.toFixed(4)),
      accuracy: Number(classification.accuracy.toFixed(4)),
      latency: {
        mean: Number(latency.mean.toFixed(3)),
        p50: Number(latency.p50.toFixed(3)),
        p95: Number(latency.p95.toFixed(3)),
        p99: Number(latency.p99.toFixed(3)),
        min: Number(latency.min.toFixed(3)),
        max: Number(latency.max.toFixed(3)),
        count: latency.count,
      },
    };

    perCaseResults[key] = caseResults;
  }

  // 5. Construct full report
  const report: EvalReport = {
    generatedAt: new Date().toISOString(),
    datasetSize: sortedDataset.length,
    perBaseline: {
      baselineA: perBaseline.baselineA,
      baselineB: perBaseline.baselineB,
      full: perBaseline.full,
    },
    perCaseResults: {
      baselineA: perCaseResults.baselineA,
      baselineB: perCaseResults.baselineB,
      full: perCaseResults.full,
    },
  };

  // 6. Write eval-report.json to disk
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  // 7. Print readable console table
  if (!silent) {
    printConsoleTable(report);
    console.log(`\nReport successfully written to: ${outputPath}\n`);
  }

  return report;
}

function printConsoleTable(report: EvalReport): void {
  console.log(
    '\n========================================================================================',
  );
  console.log(
    `  CHECKOUT GUARDIAN BENCHMARK EVALUATION REPORT (${report.datasetSize} cases, ${report.generatedAt})`,
  );
  console.log(
    '========================================================================================\n',
  );

  const rows = [
    {
      Baseline: 'Baseline A (Domain + Discount)',
      Accuracy: `${(report.perBaseline.baselineA.accuracy * 100).toFixed(1)}%`,
      Precision: `${(report.perBaseline.baselineA.precision * 100).toFixed(1)}%`,
      Recall: `${(report.perBaseline.baselineA.recall * 100).toFixed(1)}%`,
      'F1 Score': `${(report.perBaseline.baselineA.f1 * 100).toFixed(1)}%`,
      'TP/FP/TN/FN': `${report.perBaseline.baselineA.tp}/${report.perBaseline.baselineA.fp}/${report.perBaseline.baselineA.tn}/${report.perBaseline.baselineA.fn}`,
      'Mean (ms)': `${report.perBaseline.baselineA.latency.mean}ms`,
      'p50 (ms)': `${report.perBaseline.baselineA.latency.p50}ms`,
      'p95 (ms)': `${report.perBaseline.baselineA.latency.p95}ms`,
    },
    {
      Baseline: 'Baseline B (A + Identity Claims)',
      Accuracy: `${(report.perBaseline.baselineB.accuracy * 100).toFixed(1)}%`,
      Precision: `${(report.perBaseline.baselineB.precision * 100).toFixed(1)}%`,
      Recall: `${(report.perBaseline.baselineB.recall * 100).toFixed(1)}%`,
      'F1 Score': `${(report.perBaseline.baselineB.f1 * 100).toFixed(1)}%`,
      'TP/FP/TN/FN': `${report.perBaseline.baselineB.tp}/${report.perBaseline.baselineB.fp}/${report.perBaseline.baselineB.tn}/${report.perBaseline.baselineB.fn}`,
      'Mean (ms)': `${report.perBaseline.baselineB.latency.mean}ms`,
      'p50 (ms)': `${report.perBaseline.baselineB.latency.p50}ms`,
      'p95 (ms)': `${report.perBaseline.baselineB.latency.p95}ms`,
    },
    {
      Baseline: 'Full (B + Payee + Memory)',
      Accuracy: `${(report.perBaseline.full.accuracy * 100).toFixed(1)}%`,
      Precision: `${(report.perBaseline.full.precision * 100).toFixed(1)}%`,
      Recall: `${(report.perBaseline.full.recall * 100).toFixed(1)}%`,
      'F1 Score': `${(report.perBaseline.full.f1 * 100).toFixed(1)}%`,
      'TP/FP/TN/FN': `${report.perBaseline.full.tp}/${report.perBaseline.full.fp}/${report.perBaseline.full.tn}/${report.perBaseline.full.fn}`,
      'Mean (ms)': `${report.perBaseline.full.latency.mean}ms`,
      'p50 (ms)': `${report.perBaseline.full.latency.p50}ms`,
      'p95 (ms)': `${report.perBaseline.full.latency.p95}ms`,
    },
  ];

  console.table(rows);
}
