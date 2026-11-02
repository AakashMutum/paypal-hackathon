import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkExplanation, sanitizeText } from '@checkout-guardian/agent';
import { CATEGORIES, type EvaluationCase } from '../dataset/schema.js';
import { loadEvaluationDataset } from '../dataset/loader.js';
import { discountPct } from '../harness/fixtures.js';
import {
  baselineA,
  baselineB,
  coldMemory,
  runFull,
  toScamRecord,
  warmMemoryExcluding,
  type FullOptions,
  type Outcome,
  type ScamRecord,
} from '../harness/systems.js';
import { calculateLatencyMetrics } from '../metrics/latency.js';
import {
  bootstrapIntervals,
  perCategoryAccuracy,
  ratesFor,
  type BootstrapIntervals,
  type Rates,
  type ScoredRow,
} from '../metrics/stats.js';
import type { LatencyMetrics } from '../metrics/types.js';

export const BOOTSTRAP_SEED = 20261102;
export const BOOTSTRAP_ITERATIONS = 2000;

export interface SystemReport {
  name: string;
  description: string;
  rates: Rates;
  /** Same rates when only PAUSE counts as flagged (WARN counts as legit). */
  strictRates: Rates;
  intervals: BootstrapIntervals;
  perCategory: Record<string, { n: number; accuracy: number }>;
  latency: LatencyMetrics;
}

export interface InjectionReport {
  hostileTotal: number;
  hostileDetected: number;
  harmlessTotal: number;
  harmlessUntouched: number;
  pagesWithHiddenInstructions: number;
  pagesFlagged: number;
  pagesNotAllowed: number;
}

export interface InvariantReport {
  name: string;
  applicable: number;
  violations: number;
  caseIds: string[];
}

export interface EvalReport {
  generatedAt: string;
  commit: string;
  seed: number;
  dataset: { total: number; fraud: number; legit: number; perCategory: Record<string, number> };
  systems: SystemReport[];
  ablation: Array<{ name: string; accuracy: number; f1: number; recall: number; falsePositiveRate: number }>;
  memoryLift: {
    accuracyDelta: number;
    recallDelta: number;
    f1Delta: number;
    falsePositiveRateDelta: number;
    decisionsChanged: number;
    warmRecords: number;
  };
  injection: InjectionReport;
  invariants: InvariantReport[];
  faithfulness: { explained: number; faithful: number };
  rows: Array<{ caseId: string; category: string; label: string; decisions: Record<string, string> }>;
}

const isFlagged = (d: string): boolean => d === 'WARN' || d === 'PAUSE';

function toRows(cases: readonly EvaluationCase[], outcomes: readonly Outcome[], strict = false): ScoredRow[] {
  return cases.map((c, i) => ({
    caseId: c.id,
    category: c.category,
    actual: c.label,
    predicted: (strict ? outcomes[i].decision === 'PAUSE' : isFlagged(outcomes[i].decision)) ? 'fraud' : 'legit',
  }));
}

function summarise(
  name: string,
  description: string,
  cases: readonly EvaluationCase[],
  outcomes: readonly Outcome[],
): SystemReport {
  const rows = toRows(cases, outcomes);
  return {
    name,
    description,
    rates: ratesFor(rows),
    strictRates: ratesFor(toRows(cases, outcomes, true)),
    intervals: bootstrapIntervals(rows, BOOTSTRAP_ITERATIONS, BOOTSTRAP_SEED),
    perCategory: perCategoryAccuracy(rows),
    latency: calculateLatencyMetrics(outcomes.map((o) => o.ms)),
  };
}

async function inSequence<T>(cases: readonly EvaluationCase[], fn: (c: EvaluationCase) => Promise<T> | T): Promise<T[]> {
  const out: T[] = [];
  for (const c of cases) out.push(await fn(c));
  return out;
}

export function injectionDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../../agent/src/fixtures/injection');
}

function textsStartingWith(prefix: string): string[] {
  const dir = injectionDir();
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.txt'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'));
}

export function measureInjection(
  cases: readonly EvaluationCase[],
  full: readonly Outcome[],
): InjectionReport {
  const hostile = textsStartingWith('hostile-');
  const harmless = textsStartingWith('harmless-');
  const hostileDetected = hostile.filter((t) => sanitizeText(t, { location: 'hidden' }).findings.length > 0).length;
  const harmlessUntouched = harmless.filter((t) => {
    const r = sanitizeText(t, { location: 'visible' });
    return r.findings.length === 0;
  }).length;

  let hidden = 0;
  let flagged = 0;
  let notAllowed = 0;
  cases.forEach((c, i) => {
    if (!c.hiddenText) return;
    hidden += 1;
    if (full[i].result?.evidence.some((e) => e.type === 'INJECTION_ATTEMPT')) flagged += 1;
    if (full[i].decision !== 'ALLOW') notAllowed += 1;
  });

  return {
    hostileTotal: hostile.length,
    hostileDetected,
    harmlessTotal: harmless.length,
    harmlessUntouched,
    pagesWithHiddenInstructions: hidden,
    pagesFlagged: flagged,
    pagesNotAllowed: notAllowed,
  };
}

export function checkInvariants(cases: readonly EvaluationCase[], full: readonly Outcome[]): InvariantReport[] {
  const mismatch: string[] = [];
  const mismatchApplicable: string[] = [];
  const discountAlone: string[] = [];
  const discountApplicable: string[] = [];

  cases.forEach((c, i) => {
    if (c.bindingMerchantId !== null && c.bindingMerchantId !== c.payeeMerchantId) {
      mismatchApplicable.push(c.id);
      if (full[i].decision !== 'PAUSE') mismatch.push(c.id);
    }
    const consistent = c.bindingMerchantId === c.payeeMerchantId && c.registryRecord !== null;
    if (c.domainAgeDays >= 365 && discountPct(c) >= 70 && consistent) {
      discountApplicable.push(c.id);
      if (full[i].decision === 'PAUSE') discountAlone.push(c.id);
    }
  });

  return [
    {
      name: 'A payee mismatch is always PAUSE',
      applicable: mismatchApplicable.length,
      violations: mismatch.length,
      caseIds: mismatch,
    },
    {
      name: 'A big discount alone on an established domain is never PAUSE',
      applicable: discountApplicable.length,
      violations: discountAlone.length,
      caseIds: discountAlone,
    },
  ];
}

export function measureFaithfulness(full: readonly Outcome[]): { explained: number; faithful: number } {
  let explained = 0;
  let faithful = 0;
  for (const o of full) {
    const r = o.result;
    if (!r?.explanation) continue;
    explained += 1;
    const checked = checkExplanation({
      candidate: r.explanation,
      evidence: r.evidence,
      decision: r.verdict.decision,
      hardRules: r.hardRulesTriggered,
    });
    if (!checked.usedTemplate && checked.dropped === 0) faithful += 1;
  }
  return { explained, faithful };
}

export async function runEvaluation(
  options: { cases?: readonly EvaluationCase[]; commit?: string; generatedAt?: string } = {},
): Promise<EvalReport> {
  const cases = options.cases ?? loadEvaluationDataset();

  const a = await inSequence(cases, (c) => baselineA(c));
  const b = await inSequence(cases, (c) => baselineB(c));
  const cold = await inSequence(cases, (c) => runFull(c, { memory: coldMemory() }));

  // Leave-one-out warm memory: every other fraud-labelled case is remembered, never the case itself.
  const records: ScamRecord[] = [];
  cases.forEach((c, i) => {
    const result = cold[i].result;
    if (c.label === 'fraud' && result) records.push(toScamRecord(c, result));
  });
  const warm = await inSequence(cases, async (c) => runFull(c, { memory: await warmMemoryExcluding(c.id, records) }));

  const variants: Array<[string, FullOptions]> = [
    ['Full, no memory', {}],
    ['Full, no investigator loop', { memory: undefined, overrides: { features: { investigatorLoop: false } } }],
    ['Full, no domain report', { signals: { domain: false } }],
    ['Full, no price report', { signals: { price: false } }],
    ['Full, no payee binding', { signals: { binding: false } }],
    ['Full, no registry', { registry: false }],
  ];
  const ablation: EvalReport['ablation'] = [];
  const coldRates = ratesFor(toRows(cases, cold));
  ablation.push({ name: 'Full, cold memory (reference)', accuracy: coldRates.accuracy, f1: coldRates.f1, recall: coldRates.recall, falsePositiveRate: coldRates.falsePositiveRate });
  for (const [name, opts] of variants) {
    const outcomes = await inSequence(cases, (c) => runFull(c, opts));
    const r = ratesFor(toRows(cases, outcomes));
    ablation.push({ name, accuracy: r.accuracy, f1: r.f1, recall: r.recall, falsePositiveRate: r.falsePositiveRate });
  }

  const systems = [
    summarise('Baseline A', 'Domain age and discount only', cases, a),
    summarise('Baseline B', 'A plus identity consistency from the agent identity matcher', cases, b),
    summarise('Full, cold memory', 'Full agent, empty memory', cases, cold),
    summarise('Full, warm memory', 'Full agent, memory holds every other fraud-labelled case', cases, warm),
  ];

  const coldR = systems[2].rates;
  const warmR = systems[3].rates;
  const counts: Record<string, number> = {};
  for (const category of CATEGORIES) counts[category] = cases.filter((c) => c.category === category).length;

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    commit: options.commit ?? 'unknown',
    seed: BOOTSTRAP_SEED,
    dataset: {
      total: cases.length,
      fraud: cases.filter((c) => c.label === 'fraud').length,
      legit: cases.filter((c) => c.label === 'legit').length,
      perCategory: counts,
    },
    systems,
    ablation,
    memoryLift: {
      accuracyDelta: warmR.accuracy - coldR.accuracy,
      recallDelta: warmR.recall - coldR.recall,
      f1Delta: warmR.f1 - coldR.f1,
      falsePositiveRateDelta: warmR.falsePositiveRate - coldR.falsePositiveRate,
      decisionsChanged: cold.filter((o, i) => o.decision !== warm[i].decision).length,
      warmRecords: records.length,
    },
    injection: measureInjection(cases, cold),
    invariants: checkInvariants(cases, cold),
    faithfulness: measureFaithfulness(cold),
    rows: cases.map((c, i) => ({
      caseId: c.id,
      category: c.category,
      label: c.label,
      decisions: {
        'Baseline A': a[i].decision,
        'Baseline B': b[i].decision,
        'Full, cold memory': cold[i].decision,
        'Full, warm memory': warm[i].decision,
      },
    })),
  };
}

/** Metrics only: nothing that changes between runs on the same code and data. */
export function toSummary(report: EvalReport): Record<string, unknown> {
  return {
    seed: report.seed,
    dataset: report.dataset,
    systems: report.systems.map((s) => ({
      name: s.name,
      accuracy: s.rates.accuracy,
      precision: s.rates.precision,
      recall: s.rates.recall,
      f1: s.rates.f1,
      falsePositiveRate: s.rates.falsePositiveRate,
      falseNegativeRate: s.rates.falseNegativeRate,
      confusion: s.rates.confusion,
      strictPauseOnly: { recall: s.strictRates.recall, falsePositiveRate: s.strictRates.falsePositiveRate },
      intervals95: s.intervals,
      perCategoryAccuracy: s.perCategory,
    })),
    ablation: report.ablation,
    memoryLift: report.memoryLift,
    injection: report.injection,
    invariants: report.invariants,
    faithfulness: report.faithfulness,
  };
}
