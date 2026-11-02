import type { EvalReport, SystemReport } from './run.js';

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const ci = (i: { low: number; high: number }): string => `${pct(i.low)} to ${pct(i.high)}`;
const ms = (n: number): string => `${n.toFixed(2)} ms`;

function systemRow(s: SystemReport): string {
  const c = s.rates.confusion;
  return [
    s.name,
    pct(s.rates.accuracy),
    ci(s.intervals.accuracy),
    pct(s.rates.precision),
    pct(s.rates.recall),
    pct(s.rates.f1),
    pct(s.rates.falsePositiveRate),
    pct(s.rates.falseNegativeRate),
    `${c.truePositives}/${c.falsePositives}/${c.trueNegatives}/${c.falseNegatives}`,
  ].join(' | ');
}

export function renderConsole(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Evaluation of ${report.dataset.total} synthetic cases (${report.dataset.fraud} fraud, ${report.dataset.legit} legit)`);
  lines.push('');
  lines.push(['System', 'Accuracy', 'Precision', 'Recall', 'F1', 'FPR', 'FNR', 'TP/FP/TN/FN', 'p50', 'p95', 'max'].join('\t'));
  for (const s of report.systems) {
    const c = s.rates.confusion;
    lines.push(
      [
        s.name,
        pct(s.rates.accuracy),
        pct(s.rates.precision),
        pct(s.rates.recall),
        pct(s.rates.f1),
        pct(s.rates.falsePositiveRate),
        pct(s.rates.falseNegativeRate),
        `${c.truePositives}/${c.falsePositives}/${c.trueNegatives}/${c.falseNegatives}`,
        ms(s.latency.p50),
        ms(s.latency.p95),
        ms(s.latency.max),
      ].join('\t'),
    );
  }
  lines.push('');
  lines.push(`Memory lift (warm minus cold): accuracy ${pct(report.memoryLift.accuracyDelta)}, recall ${pct(report.memoryLift.recallDelta)}, decisions changed ${report.memoryLift.decisionsChanged}`);
  for (const inv of report.invariants) lines.push(`Invariant "${inv.name}": ${inv.violations} violations in ${inv.applicable} applicable cases`);
  lines.push(`Injection: hostile detected ${report.injection.hostileDetected}/${report.injection.hostileTotal}, harmless untouched ${report.injection.harmlessUntouched}/${report.injection.harmlessTotal}`);
  return lines.join('\n');
}

export function renderMarkdown(report: EvalReport): string {
  const out: string[] = [];
  const day = report.generatedAt.slice(0, 10);
  out.push('# Evaluation results', '');
  out.push(`Generated ${day} at commit \`${report.commit}\` by \`npm run eval -w @checkout-guardian/eval\`.`, '');
  out.push('These numbers describe how the systems behave on a small synthetic benchmark. They are not a claim about real-world accuracy. See the limitations below.', '');

  out.push('## Summary', '');
  out.push('A case counts as flagged when the decision is WARN or PAUSE. Intervals are 95% bootstrap intervals (2000 resamples, fixed seed).', '');
  out.push('| System | Accuracy | Accuracy 95% interval | Precision | Recall | F1 | False-positive rate | False-negative rate | TP/FP/TN/FN |');
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of report.systems) out.push(`| ${systemRow(s)} |`);
  out.push('');
  out.push('| System | F1 95% interval | Recall 95% interval | False-positive rate 95% interval | PAUSE-only recall | PAUSE-only false-positive rate |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of report.systems) {
    out.push(`| ${s.name} | ${ci(s.intervals.f1)} | ${ci(s.intervals.recall)} | ${ci(s.intervals.falsePositiveRate)} | ${pct(s.strictRates.recall)} | ${pct(s.strictRates.falsePositiveRate)} |`);
  }
  out.push('');

  out.push('## Latency', '');
  out.push('Wall-clock time per case on the machine that ran the evaluation, with in-process fixtures (no network). Not comparable to a deployed system.', '');
  out.push('| System | p50 | p95 | max |', '| --- | --- | --- | --- |');
  for (const s of report.systems) out.push(`| ${s.name} | ${ms(s.latency.p50)} | ${ms(s.latency.p95)} | ${ms(s.latency.max)} |`);
  out.push('');

  out.push('## Method', '');
  out.push('- Each case holds only raw observables: domain age, listed and reference price, payee email and merchant id, the merchant id the site publishes (or none), the payee registry record (or none), the claimed brand and legal name, and the page text including any hidden text. The label is the author\'s ground truth and is used only for scoring.');
  out.push('- Baseline A scores domain age and discount with the agent\'s scoring table. Baseline B adds the identity match computed by the agent\'s identity matcher.');
  out.push('- The full agent is `runInvestigatorAgentDetailed` from `@checkout-guardian/agent`, run with fixture signals and registry built from the observables, and no language model (deterministic fallbacks).');
  out.push('- Cold memory is empty. Warm memory holds an anonymous record of every other fraud-labelled case (leave-one-out), so the case under test is never in memory.');
  out.push('');

  out.push('## Cases per category', '');
  out.push('| Category | Cases | Accuracy of full agent (cold) |', '| --- | --- | --- |');
  const full = report.systems[2];
  for (const [category, n] of Object.entries(report.dataset.perCategory)) {
    out.push(`| ${category} | ${n} | ${pct(full.perCategory[category]?.accuracy ?? 0)} |`);
  }
  out.push('', `Total: ${report.dataset.total} cases (${report.dataset.fraud} fraud, ${report.dataset.legit} legit).`, '');

  out.push('## Per-category accuracy', '');
  const categories = Object.keys(report.dataset.perCategory);
  out.push(`| System | ${categories.join(' | ')} |`, `| --- | ${categories.map(() => '---').join(' | ')} |`);
  for (const s of report.systems) out.push(`| ${s.name} | ${categories.map((c) => pct(s.perCategory[c]?.accuracy ?? 0)).join(' | ')} |`);
  out.push('');

  out.push('## Stage ablation', '');
  out.push('The full agent with one stage removed at a time (no memory in these runs).', '');
  out.push('| Variant | Accuracy | Recall | F1 | False-positive rate |', '| --- | --- | --- | --- | --- |');
  for (const a of report.ablation) out.push(`| ${a.name} | ${pct(a.accuracy)} | ${pct(a.recall)} | ${pct(a.f1)} | ${pct(a.falsePositiveRate)} |`);
  out.push('');

  const m = report.memoryLift;
  out.push('## Memory lift', '');
  out.push(`Warm minus cold, with ${m.warmRecords} remembered fraud patterns: accuracy ${pct(m.accuracyDelta)}, recall ${pct(m.recallDelta)}, F1 ${pct(m.f1Delta)}, false-positive rate ${pct(m.falsePositiveRateDelta)}. Decisions that changed: ${m.decisionsChanged} of ${report.dataset.total}.`, '');

  const inj = report.injection;
  out.push('## Prompt-injection robustness', '');
  out.push(`- Hostile samples from \`packages/agent/src/fixtures/injection\`: ${inj.hostileDetected} of ${inj.hostileTotal} detected and neutralised by the agent's text shield.`);
  out.push(`- Harmless samples left untouched: ${inj.harmlessUntouched} of ${inj.harmlessTotal}.`);
  out.push(`- Benchmark pages with hidden instructions: ${inj.pagesWithHiddenInstructions}; flagged as an injection attempt: ${inj.pagesFlagged}; not allowed through: ${inj.pagesNotAllowed}.`, '');

  out.push('## Invariants', '');
  out.push('| Invariant | Applicable cases | Violations |', '| --- | --- | --- |');
  for (const inv of report.invariants) out.push(`| ${inv.name} | ${inv.applicable} | ${inv.violations}${inv.caseIds.length ? ` (${inv.caseIds.join(', ')})` : ''} |`);
  out.push('');

  out.push('## Explanation faithfulness', '');
  out.push(`${report.faithfulness.faithful} of ${report.faithfulness.explained} explanations from the cold full agent pass \`checkExplanation\` without being dropped or replaced by a template.`, '');

  out.push('## Limitations', '');
  out.push('- The cases are synthetic and were written by the people who built the systems. They are small in number (see the totals above), so the intervals are wide.');
  out.push('- Labels are the author\'s ground truth, not independent review. Categories were designed with the systems in mind.');
  out.push('- The categories were written knowing the agent\'s rules, so a score near the ceiling shows the rules behave as designed on these cases. It does not show they generalise to stores nobody wrote a category for.');
  out.push('- Signals, registry and memory are deterministic stand-ins built from each case\'s observables. No live service, language model or payment provider is contacted, so live behaviour (timeouts, noisy data, model errors) is not measured.');
  out.push('- Consumer webmail addresses are represented by a placeholder domain that the harness swaps for a provider the agent recognises.');
  out.push('- Memory lift depends on how similar the invented scam patterns are to each other. It says little about patterns the system has never seen.');
  out.push('- Latency reflects in-process fixtures on one machine.');
  out.push('- This is not a real-world accuracy claim.', '');
  return `${out.join('\n')}\n`;
}
