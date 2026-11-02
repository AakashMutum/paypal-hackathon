# @checkout-guardian/eval

Evaluation harness, labeled benchmark dataset, and deterministic baseline comparison engine for Checkout Guardian.

---

## Quick Start

Run the complete evaluation benchmark:

```bash
# From repository root
npm --workspace=@checkout-guardian/eval run test:eval

# Or from within /packages/eval
npm run test:eval
```

This command executes all 3 baselines over the 50 labeled cases, outputs a readable console summary table, and writes the results to `eval-report.json`.

---

## Benchmark Output Example

```text
========================================================================================
  CHECKOUT GUARDIAN BENCHMARK EVALUATION REPORT (50 cases, 2026-11-02T10:22:51.611Z)
========================================================================================

┌─────────┬────────────────────────────────────┬──────────┬───────────┬──────────┬──────────┬─────────────┬───────────┬───────────┬───────────┐
│ (index) │ Baseline                           │ Accuracy │ Precision │ Recall   │ F1 Score │ TP/FP/TN/FN │ Mean (ms) │ p50 (ms)  │ p95 (ms)  │
├─────────┼────────────────────────────────────┼──────────┼───────────┼──────────┼──────────┼─────────────┼───────────┼───────────┼───────────┤
│ 0       │ 'Baseline A (Domain + Discount)'   │ '92.0%'  │ '86.2%'   │ '100.0%' │ '92.6%'  │ '25/4/21/0' │ '0.005ms' │ '0.001ms' │ '0.014ms' │
│ 1       │ 'Baseline B (A + Identity Claims)' │ '100.0%' │ '100.0%'  │ '100.0%' │ '100.0%' │ '25/0/25/0' │ '0.003ms' │ '0.002ms' │ '0.008ms' │
│ 2       │ 'Full (B + Payee + Memory)'        │ '100.0%' │ '100.0%'  │ '100.0%' │ '100.0%' │ '25/0/25/0' │ '0.066ms' │ '0.035ms' │ '0.165ms' │
└─────────┴────────────────────────────────────┴──────────┴───────────┴──────────┴──────────┴─────────────┴───────────┴───────────┴───────────┘
```

---

## Guide for Person 4 (Analyst Console Integration)

The evaluation runner writes `eval-report.json` directly to `/packages/eval/eval-report.json`. Person 4 can import or read this JSON to render interactive charts and diagnostic tables in the Analyst Console.

### JSON Structure Specification

```typescript
export interface EvalReport {
  /** ISO 8601 generation timestamp */
  generatedAt: string;
  /** Number of test cases evaluated (50) */
  datasetSize: number;
  /** Aggregate confusion matrix and telemetry metrics per baseline */
  perBaseline: {
    baselineA: BaselineSummaryMetrics;
    baselineB: BaselineSummaryMetrics;
    full: BaselineSummaryMetrics;
  };
  /** Granular case-by-case outputs for detailed drill-down */
  perCaseResults: {
    baselineA: CaseEvaluationResult[];
    baselineB: CaseEvaluationResult[];
    full: CaseEvaluationResult[];
  };
}

export interface BaselineSummaryMetrics {
  tp: number;         // True Positives (actual fraud, predicted fraud)
  fp: number;         // False Positives (actual legit, predicted fraud)
  tn: number;         // True Negatives (actual legit, predicted legit)
  fn: number;         // False Negatives (actual fraud, predicted legit)
  precision: number;  // TP / (TP + FP) [0.0 - 1.0]
  recall: number;     // TP / (TP + FN) [0.0 - 1.0]
  f1: number;         // 2 * (P * R) / (P + R) [0.0 - 1.0]
  accuracy: number;   // (TP + TN) / Total [0.0 - 1.0]
  latency: {
    mean: number;     // Average execution latency in milliseconds
    p50: number;      // Median (50th percentile) latency in milliseconds
    p95: number;      // 95th percentile latency in milliseconds
    p99: number;      // 99th percentile latency in milliseconds
    min: number;      // Minimum observed latency in milliseconds
    max: number;      // Maximum observed latency in milliseconds
    count: number;    // Sample count
  };
}

export interface CaseEvaluationResult {
  id: string;          // e.g. "case-demo-001"
  merchantUrl: string; // Storefront checkout URL
  claimedBrand: string;// Brand name claimed on storefront
  actual: 'fraud' | 'legit';
  predicted: 'fraud' | 'legit';
  isCorrect: boolean;  // actual === predicted
  decision: string;    // 'ALLOW' | 'WARN' | 'PAUSE'
  score: number;       // Risk score [0.0 - 100.0]
  latencyMs: number;   // Measured execution duration in ms
  reasons: string[];   // Decision explanation notes
}
```

### Charting Recommendations for Analyst Console

1. **Model Comparison Bar Chart:**
   * Plot `f1`, `precision`, `recall`, and `accuracy` side-by-side for `baselineA`, `baselineB`, and `full`.
2. **Confusion Matrix Cards:**
   * Render a $2 \times 2$ grid for each baseline displaying `tp`, `fp`, `tn`, and `fn`.
3. **Latency Percentile Comparison:**
   * Render a grouped bar chart comparing `p50` vs `p95` response times across the models.
4. **Drill-down Diagnostic Table:**
   * Table displaying `perCaseResults.full` with filter toggles for `isCorrect: false` to highlight edge cases or misclassifications for manual review.

---

## Dataset Description

The evaluation dataset in `src/dataset/cases.json` contains **50 labeled cases** (25 fraud, 25 legit) covering:
- **Person 4 Demo Stores:** `acme-audio.com` (legit), `mega-dealsoutlet.net` (fraud), `gucci-outletdeals.com` (fraud).
- **Hard Cases:**
  - New-but-legit domains (< 30 days old with verified identity).
  - Clearance sales on mature domains (> 60% discounts).
  - Independent artisans/sole proprietors using personal PayPal accounts.
  - Fraudulent storefronts using aged/hijacked domains.

