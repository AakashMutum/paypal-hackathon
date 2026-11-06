// Measures scan latency against a running API.
//
//   npm run measure:latency                         (10 scans per store against http://localhost:3000)
//   npm run measure:latency -- --runs 20 --base http://localhost:3100
//   npm run measure:latency -- --write              (also writes docs/latency.md)
//
// For each of the three invented demo stores it sends N sequential POST /api/scan requests and
// times each one from request to the end of the response body. The first request to each store is
// reported separately from the warm requests; the very first request overall is the cold start.
// It uses no secrets: only the public scan route. Nothing is sent to any real site by this script.
// The API decides what the scan does (recorded or live signals, model or no model); the modes are
// read from GET /health and printed so the numbers are not read out of context.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { summarize } from './latency-stats.mjs';

const TARGET_MS = 2000;
const STORES = [
  { id: 'harborline-outfitters', label: 'Harborline Outfitters (genuine)', url: 'https://www.harborline-outfitters.example/' },
  { id: 'bargainbarn-outlet', label: 'Bargain Barn Outlet (discount)', url: 'https://www.bargainbarn-outlet.example/' },
  { id: 'harborlyne-outfitters-sale', label: 'Harborlyne Outfitters Sale (impersonator)', url: 'https://www.harborlyne-outfitters-sale.example/' },
];

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--') ? process.argv[index + 1] : fallback;
}

const base = String(option('--base', process.env.BASE_URL ?? 'http://localhost:3000')).replace(/\/+$/, '');
const runs = Number(option('--runs', 10));
const write = process.argv.includes('--write');
const note = option('--note', '');
if (!Number.isInteger(runs) || runs < 2 || runs > 200) {
  console.error('--runs must be a whole number from 2 to 200 (the first request is reported separately).');
  process.exit(2);
}

async function getJson(path) {
  const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(70000) });
  return res.json();
}

async function scan(url) {
  const started = performance.now();
  const res = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(70000),
  });
  const body = await res.json().catch(() => ({}));
  const ms = performance.now() - started;
  if (res.status === 429) throw new Error('Rate limited (429). Lower --runs or raise RATE_LIMIT_MAX on the API for this run.');
  if (!res.ok) throw new Error(`Scan failed with HTTP ${res.status}`);
  return { ms, verdict: body.verdict };
}

const health = await getJson('/health').catch(() => undefined);
const modes = health?.data?.modes ?? health?.modes ?? {};

const results = [];
let globalFirst = true;
for (const store of STORES) {
  const samples = [];
  let verdict;
  for (let i = 0; i < runs; i += 1) {
    const out = await scan(store.url);
    samples.push(out.ms);
    verdict = out.verdict;
  }
  const first = samples[0];
  const warm = samples.slice(1);
  results.push({ store, first, cold: globalFirst, warm: summarize(warm, TARGET_MS), verdict, samples });
  globalFirst = false;
}

const fmt = (value) => (value === null ? 'n/a' : String(Math.round(value)));
const lines = [];
lines.push(`Base: ${base}   runs per store: ${runs} (1 first + ${runs - 1} warm)   modes: ${JSON.stringify(modes)}`);
lines.push('');
lines.push('store                                       first   min  median  p95   max  warm<2000ms');
for (const r of results) {
  lines.push(
    `${r.store.label.padEnd(43)} ${fmt(r.first).padStart(5)} ${fmt(r.warm.min).padStart(5)} ${fmt(r.warm.median).padStart(6)} ${fmt(r.warm.p95).padStart(5)} ${fmt(r.warm.max).padStart(5)}  ${r.warm.under}/${r.warm.n}${r.cold ? '   (first = cold start of the API)' : ''}`,
  );
}
console.log(lines.join('\n'));

const warmAll = results.flatMap((r) => r.samples.slice(1));
const allFirst = results.map((r) => r.first);
const overall = summarize(warmAll, TARGET_MS);
const firstUnder = allFirst.filter((v) => v < TARGET_MS).length;
console.log(`\nWarm requests under ${TARGET_MS} ms: ${overall.under}/${overall.n}. First requests under ${TARGET_MS} ms: ${firstUnder}/${allFirst.length}.`);

if (write) {
  const verdictLine =
    overall.under === overall.n && firstUnder === allFirst.length
      ? `Every measured request, including the first request to each store, finished under ${TARGET_MS} ms in this run.`
      : overall.under === overall.n
        ? `All ${overall.n} warm requests finished under ${TARGET_MS} ms, but ${allFirst.length - firstUnder} of ${allFirst.length} first requests did not.`
        : `The ${TARGET_MS} ms target was NOT consistently met in this run: ${overall.n - overall.under} of ${overall.n} warm requests were at or over ${TARGET_MS} ms.`;
  const scope =
    modes.llm === 'live'
      ? ''
      : ' This run used no live model and the demo stores are answered from recorded signals, so it does not show that a live scan meets the target.';
  const rows = results
    .map(
      (r) =>
        `| ${r.store.label} | ${fmt(r.first)}${r.cold ? ' (cold start)' : ''} | ${fmt(r.warm.min)} | ${fmt(r.warm.median)} | ${fmt(r.warm.p95)} | ${fmt(r.warm.max)} | ${r.warm.under}/${r.warm.n} | ${r.verdict ?? 'n/a'} |`,
    )
    .join('\n');
  // A block between these markers is written by hand (experiments) and is kept when the file is regenerated.
  const docPath = new URL('../docs/latency.md', import.meta.url);
  const previous = existsSync(docPath) ? readFileSync(docPath, 'utf8') : '';
  const kept =
    /<!-- manual:start -->[\s\S]*?<!-- manual:end -->/.exec(previous)?.[0] ?? '<!-- manual:start -->\n<!-- manual:end -->';
  const verdictText = verdictLine + scope;
  const doc = `# Latency

Generated by \`npm run measure:latency -- --write\` on ${new Date().toISOString().slice(0, 10)}. Re-run it to refresh the numbers; do not edit the table by hand.

## What was measured

- ${runs} sequential \`POST /api/scan\` requests per store, to ${base}, timed from sending the request to reading the whole response body.
- The first request to each store is reported separately. The very first request of the run is the cold start of the API process; if the API was already warm, it is not.
- The three stores are invented (\`.example\` domains). With \`SIGNALS_MODE=auto\` they are answered from recorded signals, so the scan does not touch the network for them. Live signals for other sites were not measured here.
- Modes reported by \`/health\` during the run: \`${JSON.stringify(modes)}\`. The model time budget (\`AGENT_MODEL_BUDGET_MS\`, default 1200) is read by the API process and is not reported by \`/health\`; use \`--note\` to record a non-default value.
- Machine: ${cpus()[0]?.model ?? 'unknown CPU'} (${cpus().length} logical cores), ${(totalmem() / 2 ** 30).toFixed(1)} GiB RAM, ${platform()} ${release()}, Node ${process.version}. The client and the API ran on the same machine, so there is no network latency in these numbers.${note ? `\n- Note: ${note}` : ''}

## Result (milliseconds)

| Store | First | Warm min | Warm median | Warm p95 | Warm max | Warm under ${TARGET_MS} ms | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

${verdictText}

## What this does and does not show

- It measures the API as it was configured for the run. If the language model was off or answering from recordings, these numbers say nothing about a live model: a live model adds its own network time, which is bounded by \`AGENT_MODEL_BUDGET_MS\` (default 1200 ms) but not measured here unless the modes above say \`"llm":"live"\`.
- The previous local measurement reported by the team, 5 live scans of 1733, 1848, 1887, 2055 and 3740 ms (the cold first request was 3.74 s), was not reproduced by this script.
- The run is small and on one machine. It is not a service-level measurement.

${kept}

## The hosted instance

The free Render instance sleeps after about 15 minutes without traffic. The first request after that wakes the service and is cold: it can take far longer than 2 seconds (the smoke script allows up to about 70 seconds). Judges who open the hosted demo after it has been idle should expect a slow first request; later requests are warm. No hosted measurement exists yet because nothing is deployed. Run \`BASE_URL=<hosted url> npm run measure:latency -- --write\` after deploying and read the first row separately.
`;
  writeFileSync(docPath, doc);
  console.log('Wrote docs/latency.md');
}
