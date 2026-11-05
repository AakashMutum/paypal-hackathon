import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { claimMatch } from '../src/lib/explain.js';
import { paymentSteps } from '../src/lib/payment.js';
import type { Evidence, Investigation } from '../src/types.js';

const payee = (status: Evidence['status']): Evidence => ({ id: 'e4', node: 'PAYEE', title: 'x', status, badge: 'x', confidence: 90, fields: [] });
const base = { status: 'COMPLETE' as const, payeeMismatch: false, payeeName: 'Harborline Outfitters Ltd', evidence: [payee('PASS')], signalAvailability: undefined };

test('claimMatch: MATCH only with a supplied payee and a passed payee check', () => {
  assert.equal(claimMatch(base as Pick<Investigation, 'status' | 'payeeMismatch' | 'payeeName' | 'evidence' | 'signalAvailability'>), 'MATCH');
});

test('claimMatch: MISMATCH from the mismatch flag or a failed payee check', () => {
  assert.equal(claimMatch({ ...base, payeeMismatch: true }), 'MISMATCH');
  assert.equal(claimMatch({ ...base, evidence: [payee('FAIL')] }), 'MISMATCH');
});

test('claimMatch: everything else is NOT_CHECKED, never a guess', () => {
  assert.equal(claimMatch({ ...base, payeeName: null }), 'NOT_CHECKED');
  assert.equal(claimMatch({ ...base, evidence: [payee('WARN')] }), 'NOT_CHECKED');
  assert.equal(claimMatch({ ...base, evidence: [] }), 'NOT_CHECKED');
  assert.equal(claimMatch({ ...base, status: 'RUNNING' }), 'NOT_CHECKED');
  const unsupplied = { ...base, signalAvailability: { payee: 'not_provided' } as Investigation['signalAvailability'] };
  assert.equal(claimMatch(unsupplied), 'NOT_CHECKED');
});

const steps = (over: Partial<Parameters<typeof paymentSteps>[0]>) => paymentSteps({ status: 'COMPLETE', verdict: 'ALLOW', captureState: 'CAPTURED', ...over });

test('the payment has four steps: Authorized, Reviewed, Decision, then the outcome', () => {
  const s = steps({});
  assert.deepEqual(s.map((x) => x.label), ['Authorized', 'Reviewed', 'Decision', 'Captured']);
  assert.ok(s.every((x) => x.state === 'done'));
});

test('a PAUSE is held and says nothing was captured and never will be', () => {
  const s = steps({ verdict: 'PAUSE', captureState: 'HELD' });
  assert.equal(s[3].label, 'Held');
  assert.equal(s[3].state, 'held');
  assert.match(s[3].detail, /never will be/);
});

test('a WARN waits for the person; acknowledging it completes the decision step', () => {
  assert.equal(steps({ verdict: 'WARN', captureState: 'HELD' })[2].state, 'held');
  assert.equal(steps({ verdict: 'WARN', captureState: 'CAPTURED', acknowledged: true })[2].state, 'done');
});

test('voided and failed outcomes have their own wording, and a failure says nothing was captured', () => {
  assert.equal(steps({ verdict: 'WARN', captureState: 'VOIDED' })[3].label, 'Voided');
  const failed = steps({ captureState: 'FAILED' })[3];
  assert.equal(failed.state, 'failed');
  assert.match(failed.detail, /nothing was captured/);
});

test('while the check runs the later steps are not done', () => {
  const s = paymentSteps({ status: 'RUNNING', captureState: 'AUTHORIZED' });
  assert.equal(s[0].state, 'done');
  assert.equal(s[1].state, 'current');
  assert.equal(s[2].state, 'todo');
  assert.equal(s[3].state, 'todo');
});

test('the staged reveal is about 600 ms in all and the animation is skipped for reduced motion', () => {
  const strip = readFileSync(new URL('../src/components/CheckList.tsx', import.meta.url), 'utf8');
  const step = Number(/REVEAL_STEP_MS = (\d+)/.exec(strip)?.[1]);
  assert.ok(step * 4 >= 500 && step * 4 <= 700, `reveal step ${step} ms x 4`);
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*animation: none !important/);
});

test('every existing route still works and the old history address redirects', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  for (const path of ['scanner', 'engine/:id', 'pay/:id', 'history', 'onboarding', 'stores', 'checkout/:id', 'profile', '/store/:id', 'analyst', 'investigations', 'investigations/:id']) {
    assert.ok(app.includes(`path="${path}"`) || app.includes(`path="${path.replace(/:id/, ':id')}"`), `route missing: ${path}`);
  }
  assert.match(app, /path="history" element=\{<Navigate to="\/investigations" replace \/>\}/);
  assert.ok(app.includes('<Route index'), 'the index route');
});

test('the footer carries the independence line', () => {
  const footer = readFileSync(new URL('../src/components/HowChecked.tsx', import.meta.url), 'utf8');
  assert.ok(footer.includes('TrustOra is an independent hackathon project and is not affiliated with PayPal.'));
});
