import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderConsole, renderMarkdown } from './format.js';
import { runEvaluation, toSummary } from './run.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '../..');
const repoRoot = resolve(packageRoot, '../..');

function commitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const report = await runEvaluation({ commit: commitSha() });
console.log(renderConsole(report));

mkdirSync(resolve(packageRoot, 'out'), { recursive: true });
mkdirSync(resolve(packageRoot, 'results'), { recursive: true });
mkdirSync(resolve(repoRoot, 'docs'), { recursive: true });

writeFileSync(resolve(packageRoot, 'out/report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(resolve(packageRoot, 'results/summary.json'), `${JSON.stringify(toSummary(report), null, 2)}\n`);
writeFileSync(resolve(repoRoot, 'docs/eval-results.md'), renderMarkdown(report));
console.log('\nWrote packages/eval/out/report.json (ignored), packages/eval/results/summary.json and docs/eval-results.md');
