// Smoke test for a deployed (or local) API. No dependencies.
//
//   BASE_URL=https://your-api.onrender.com node scripts/smoke-deploy.mjs
//   BASE_URL=http://localhost:3000 REQUIRE_DB=true node scripts/smoke-deploy.mjs --flow
//
// Checks GET /health. With REQUIRE_DB=true it also requires database.status "healthy"; without it
// a missing database only prints a warning, because the API runs in memory without one.
// With --flow it posts one fictional store to POST /api/scan and checks the response has a verdict
// (ALLOW, WARN or PAUSE). It also checks that /health reports the modes and prints them.
// For an https URL it reports the negotiated TLS protocol and the certificate expiry. That is a
// report only: no TLS version is asserted.
// With REQUIRE_AUDIT_ENCRYPTION=true it fails unless /health says auditEncryption is "enabled".

import { connect } from 'node:tls';
import { checkAuditEncryption, checkModes, describeTls } from './smoke-checks.mjs';

const VERDICTS = new Set(['ALLOW', 'WARN', 'PAUSE']);

function arg(name) {
  return process.argv.includes(name);
}

const base = (process.env.BASE_URL ?? process.argv.find((a) => a.startsWith('http')) ?? '').replace(/\/+$/, '');
if (!base) {
  console.error('Set BASE_URL, for example BASE_URL=http://localhost:3000');
  process.exit(2);
}
const requireDb = process.env.REQUIRE_DB === 'true';
const requireAuditEncryption = process.env.REQUIRE_AUDIT_ENCRYPTION === 'true';
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 70000); // a sleeping free-tier service can take about a minute to wake

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

/** Opens one TLS connection to read the negotiated protocol and certificate. Never throws. */
function readTls(url) {
  const target = new URL(url);
  if (target.protocol !== 'https:') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const socket = connect(
      { host: target.hostname, port: Number(target.port) || 443, servername: target.hostname, rejectUnauthorized: false, timeout: 15000 },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          protocol: socket.getProtocol() ?? undefined,
          validTo: cert && cert.valid_to ? cert.valid_to : undefined,
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        });
        socket.end();
      },
    );
    socket.on('timeout', () => {
      resolve({ error: 'timed out' });
      socket.destroy();
    });
    socket.on('error', (error) => resolve({ error: error.code ?? error.message }));
  });
}

let failed = false;
const fail = (message) => {
  console.error(`FAIL ${message}`);
  failed = true;
};

console.log(describeTls(await readTls(base)));

try {
  const health = await call('GET', '/health');
  const data = health.json?.data;
  console.log(`GET /health -> ${health.status}`, data ? JSON.stringify(data) : health.text.slice(0, 200));
  if (health.status !== 200 || data?.status !== 'ok') {
    fail('health check did not return ok');
  } else {
    const modes = data.modes;
    const modeProblems = checkModes(modes);
    if (modeProblems.length === 0) {
      console.log(`Modes: paypal ${modes.paypal}, store ${modes.store}, signals ${modes.signals}, llm ${modes.llm}, memory ${modes.memory}, auditEncryption ${modes.auditEncryption ?? 'not reported'}`);
    } else {
      for (const problem of modeProblems) fail(problem);
    }
    const audit = checkAuditEncryption(modes, requireAuditEncryption);
    if (audit.problem) fail(audit.problem);
    else if (requireAuditEncryption) console.log('OK auditEncryption is enabled');
    const db = data.database?.status;
    if (db === 'healthy') {
      console.log('OK database is healthy');
    } else if (requireDb) {
      fail(`REQUIRE_DB=true but database.status is "${db}"`);
    } else {
      console.warn(`WARN database.status is "${db}": the API may be running in memory without a database`);
    }
  }

  if (arg('--flow')) {
    const scan = await call('POST', '/api/scan', { url: 'harborline-outfitters.example' });
    console.log(`POST /api/scan -> ${scan.status}`, scan.json ? `verdict ${scan.json.verdict}` : scan.text.slice(0, 200));
    if (scan.status !== 200 || !VERDICTS.has(scan.json?.verdict)) {
      fail('scan did not return a verdict of ALLOW, WARN or PAUSE');
    } else {
      console.log('OK scan returned a verdict');
    }
  }
} catch (error) {
  fail(`request failed: ${error instanceof Error ? error.message : String(error)}`);
}

if (failed) process.exit(1);
console.log('Smoke test passed.');
