# @checkout-guardian/eval

Benchmark for the investigation agent: a labelled synthetic dataset, four systems to compare,
metrics with confidence intervals, and a runner that writes a report.

Results are in [`docs/eval-results.md`](../../docs/eval-results.md). They come from a small
synthetic benchmark and are not a claim about real-world accuracy.

## Run it

```bash
# From the repository root
npm run eval -w @checkout-guardian/eval
npm test -w @checkout-guardian/eval
npm run dataset:generate -w @checkout-guardian/eval
```

`eval` prints a table and writes three files:

| File | Committed | Contents |
| --- | --- | --- |
| `packages/eval/out/report.json` | no (ignored) | Everything, including latency and per-case decisions |
| `packages/eval/results/summary.json` | yes | Metrics only, stable between runs on the same code and data |
| `docs/eval-results.md` | yes | Summary table, method, cases per category, commit, date, limitations |

`eval-report.json` from older versions is no longer produced. Generated output goes to `out/`.

## Dataset

`src/dataset/cases.json` holds 62 invented stores, written by `scripts/generateDataset.ts` from a
fixed seed. Every domain and email address ends in `.example`; every brand is invented.

A case holds raw observables only: domain age in days, listed and reference price, payee email
and merchant id, the merchant id the site publishes in its binding file (or none), the registry
record of the payee (legal name and brand names, or none), the registry record of the real brand
owner, the claimed brand and legal name on the page, and the page text including any hidden text.
It holds no judgment such as "identity is consistent" or "payee matches the domain"; a test fails
if one appears. The `label` is the author's ground truth and is used only for scoring.

| Category | Label |
| --- | --- |
| `easy_legit` | legit |
| `easy_fraud` | fraud |
| `lookalike_impersonator` | fraud |
| `new_but_legit` | legit |
| `big_clearance_but_legit` | legit |
| `sole_proprietor_webmail` | legit |
| `aged_hijacked_domain` | fraud |
| `injection_page` | fraud |

Legit stores are deliberately imperfect: many publish no binding file, some are missing from the
registry. Consumer webmail is written as `freemail.example`; the harness swaps in a provider the
agent recognises when it builds the agent's request.

## Systems compared

| System | What it is |
| --- | --- |
| Baseline A | Domain age and discount only, scored with the agent's scoring table |
| Baseline B | A plus identity consistency computed by the agent's identity matcher |
| Full, cold memory | `runInvestigatorAgentDetailed` with fixture signals and registry built from the observables, no language model, empty memory |
| Full, warm memory | The same, with memory holding every other fraud-labelled case (leave-one-out) |

Signals and registry are built from the observables in `src/harness/fixtures.ts`, never from the
label or category. A test flips both and checks the decisions do not change.

## Metrics

Confusion matrix, accuracy, precision, recall, F1, false-positive rate on legit cases,
false-negative rate, per-category accuracy, seeded bootstrap 95% intervals, latency p50, p95 and
max, stage ablation, memory lift (cold versus warm), prompt-injection robustness, two invariants
and explanation faithfulness. A case counts as flagged when the decision is WARN or PAUSE; the
PAUSE-only variant is reported too.

Prompt-injection robustness uses the hostile and harmless samples in
`packages/agent/src/fixtures/injection` plus the benchmark pages that carry hidden instructions.

Invariants checked:

1. A payee mismatch (the site publishes a different merchant id) is always PAUSE.
2. A big discount alone on an established domain, with a matching binding and a registry record,
   is never PAUSE.

## Layout

```
scripts/generateDataset.ts   deterministic dataset generator
src/dataset/                 schema (zod), loader, cases.json
src/harness/fixtures.ts      case observables to agent inputs
src/harness/systems.ts       baselines, full agent, memory helpers
src/metrics/                 confusion matrix, latency, rates, bootstrap
src/runner/                  evaluation, console and markdown output, CLI
results/summary.json         committed metrics
```

The memory used for the warm runs is `@checkout-guardian/memory` (`InMemoryPatternStore` through
`asAgentMemoryPort`), so the evaluation exercises the same anonymising store the agent would use.
