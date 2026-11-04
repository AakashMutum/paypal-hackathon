// First-request latency after a fresh API start, warm-up off versus on.
//   npm run build && node scripts/latency-experiments/warmup-trial.mjs 6
// Starts the built API on local ports, so build first. Uses only the invented demo stores.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const trials = Number(process.argv[2] ?? 6);
const stores = ['https://www.harborline-outfitters.example/', 'https://www.bargainbarn-outlet.example/', 'https://www.harborlyne-outfitters-sale.example/'];

async function trial(warm, port, url) {
  const child = spawn('node', ['apps/api/dist/src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), WARMUP: warm ? 'on' : 'off' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  const start = Date.now();
  while (!log.includes('listening')) {
    if (Date.now() - start > 20000) throw new Error('no start');
    await new Promise((r) => setTimeout(r, 50));
  }
  // Give the warm-up (when on) time to finish before the first request, like a user arriving later.
  await new Promise((r) => setTimeout(r, 2500));
  const warmLine = /Warm-up finished in (\d+) ms/.exec(log);
  const t0 = performance.now();
  const res = await fetch(`http://localhost:${port}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  await res.json();
  const ms = performance.now() - t0;
  child.kill();
  await new Promise((r) => setTimeout(r, 400));
  return { ms: Math.round(ms), warmMs: warmLine ? Number(warmLine[1]) : null };
}

const out = { off: [], on: [] };
let port = 3120;
for (let i = 0; i < trials; i += 1) {
  for (const warm of [false, true]) {
    const url = stores[i % stores.length];
    const r = await trial(warm, (port += 1), url);
    out[warm ? 'on' : 'off'].push({ url: url.split('.')[1], ...r });
  }
}
console.log(JSON.stringify(out, null, 1));
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log('first-request ms, warm-up off:', out.off.map((r) => r.ms).join(' '), 'median', med(out.off.map((r) => r.ms)));
console.log('first-request ms, warm-up on :', out.on.map((r) => r.ms).join(' '), 'median', med(out.on.map((r) => r.ms)), 'warm-up took', out.on.map((r) => r.warmMs).join(' '));
