# Evaluation results

Generated 2026-11-02 at commit `b693f4e` by `npm run eval -w @checkout-guardian/eval`.

These numbers describe how the systems behave on a small synthetic benchmark. They are not a claim about real-world accuracy. See the limitations below.

## Summary

A case counts as flagged when the decision is WARN or PAUSE. Intervals are 95% bootstrap intervals (2000 resamples, fixed seed).

| System | Accuracy | Accuracy 95% interval | Precision | Recall | F1 | False-positive rate | False-negative rate | TP/FP/TN/FN |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline A | 64.5% | 53.2% to 75.8% | 100.0% | 21.4% | 35.3% | 0.0% | 78.6% | 6/0/34/22 |
| Baseline B | 75.8% | 64.5% to 85.5% | 100.0% | 46.4% | 63.4% | 0.0% | 53.6% | 13/0/34/15 |
| Full, cold memory | 100.0% | 100.0% to 100.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% | 28/0/34/0 |
| Full, warm memory | 96.8% | 91.9% to 100.0% | 93.3% | 100.0% | 96.6% | 5.9% | 0.0% | 28/2/32/0 |

| System | F1 95% interval | Recall 95% interval | False-positive rate 95% interval | PAUSE-only recall | PAUSE-only false-positive rate |
| --- | --- | --- | --- | --- | --- |
| Baseline A | 13.8% to 54.5% | 7.4% to 37.5% | 0.0% to 0.0% | 0.0% | 0.0% |
| Baseline B | 43.8% to 79.2% | 28.0% to 65.5% | 0.0% to 0.0% | 0.0% | 0.0% |
| Full, cold memory | 100.0% to 100.0% | 100.0% to 100.0% | 0.0% to 0.0% | 64.3% | 0.0% |
| Full, warm memory | 90.6% to 100.0% | 100.0% to 100.0% | 0.0% to 15.2% | 64.3% | 0.0% |

## Latency

Wall-clock time per case on the machine that ran the evaluation, with in-process fixtures (no network). Not comparable to a deployed system.

| System | p50 | p95 | max |
| --- | --- | --- | --- |
| Baseline A | 0.02 ms | 0.09 ms | 1.49 ms |
| Baseline B | 0.07 ms | 0.26 ms | 5.97 ms |
| Full, cold memory | 0.78 ms | 4.05 ms | 20.86 ms |
| Full, warm memory | 0.97 ms | 1.99 ms | 2.96 ms |

## Method

- Each case holds only raw observables: domain age, listed and reference price, payee email and merchant id, the merchant id the site publishes (or none), the payee registry record (or none), the claimed brand and legal name, and the page text including any hidden text. The label is the author's ground truth and is used only for scoring.
- Baseline A scores domain age and discount with the agent's scoring table. Baseline B adds the identity match computed by the agent's identity matcher.
- The full agent is `runInvestigatorAgentDetailed` from `@checkout-guardian/agent`, run with fixture signals and registry built from the observables, and no language model (deterministic fallbacks).
- Cold memory is empty. Warm memory holds an anonymous record of every other fraud-labelled case (leave-one-out), so the case under test is never in memory.

## Cases per category

| Category | Cases | Accuracy of full agent (cold) |
| --- | --- | --- |
| easy_legit | 10 | 100.0% |
| easy_fraud | 8 | 100.0% |
| lookalike_impersonator | 8 | 100.0% |
| new_but_legit | 8 | 100.0% |
| big_clearance_but_legit | 8 | 100.0% |
| sole_proprietor_webmail | 8 | 100.0% |
| aged_hijacked_domain | 6 | 100.0% |
| injection_page | 6 | 100.0% |

Total: 62 cases (28 fraud, 34 legit).

## Per-category accuracy

| System | easy_legit | easy_fraud | lookalike_impersonator | new_but_legit | big_clearance_but_legit | sole_proprietor_webmail | aged_hijacked_domain | injection_page |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline A | 100.0% | 75.0% | 0.0% | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% |
| Baseline B | 100.0% | 75.0% | 87.5% | 100.0% | 100.0% | 100.0% | 0.0% | 0.0% |
| Full, cold memory | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| Full, warm memory | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 75.0% | 100.0% | 100.0% |

## Stage ablation

The full agent with one stage removed at a time (no memory in these runs).

| Variant | Accuracy | Recall | F1 | False-positive rate |
| --- | --- | --- | --- | --- |
| Full, cold memory (reference) | 100.0% | 100.0% | 100.0% | 0.0% |
| Full, no memory | 100.0% | 100.0% | 100.0% | 0.0% |
| Full, no investigator loop | 100.0% | 100.0% | 100.0% | 0.0% |
| Full, no domain report | 96.8% | 92.9% | 96.3% | 0.0% |
| Full, no price report | 100.0% | 100.0% | 100.0% | 0.0% |
| Full, no payee binding | 98.4% | 96.4% | 98.2% | 0.0% |
| Full, no registry | 95.2% | 89.3% | 94.3% | 0.0% |

## Memory lift

Warm minus cold, with 28 remembered fraud patterns: accuracy -3.2%, recall 0.0%, F1 -3.4%, false-positive rate 5.9%. Decisions that changed: 2 of 62.

## Prompt-injection robustness

- Hostile samples from `packages/agent/src/fixtures/injection`: 15 of 15 detected and neutralised by the agent's text shield.
- Harmless samples left untouched: 12 of 12.
- Benchmark pages with hidden instructions: 6; flagged as an injection attempt: 6; not allowed through: 6.

## Invariants

| Invariant | Applicable cases | Violations |
| --- | --- | --- |
| A payee mismatch is always PAUSE | 7 | 0 |
| A big discount alone on an established domain is never PAUSE | 4 | 0 |

## Explanation faithfulness

62 of 62 explanations from the cold full agent pass `checkExplanation` without being dropped or replaced by a template.

## Limitations

- The cases are synthetic and were written by the people who built the systems. They are small in number (see the totals above), so the intervals are wide.
- Labels are the author's ground truth, not independent review. Categories were designed with the systems in mind.
- The categories were written knowing the agent's rules, so a score near the ceiling shows the rules behave as designed on these cases. It does not show they generalise to stores nobody wrote a category for.
- Signals, registry and memory are deterministic stand-ins built from each case's observables. No live service, language model or payment provider is contacted, so live behaviour (timeouts, noisy data, model errors) is not measured.
- Consumer webmail addresses are represented by a placeholder domain that the harness swaps for a provider the agent recognises.
- Memory lift depends on how similar the invented scam patterns are to each other. It says little about patterns the system has never seen.
- Latency reflects in-process fixtures on one machine.
- This is not a real-world accuracy claim.

