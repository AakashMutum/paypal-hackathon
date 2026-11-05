import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { decisionSentence, fieldState, findingText, groupRan, groupState, humanAge, outcome, summaryCounts } from '../src/lib/checks.js';
import { buildCommands, looksLikeUrl } from '../src/lib/palette.js';
import { PANEL_WIDE, panelKey, readPanel, savePanel } from '../src/lib/panel.js';
import type { Evidence, SignalAvailability } from '../src/types.js';

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const ev = (node: Evidence['node'], status: Evidence['status'], badge = 'CHECKED'): Evidence => ({ id: node, node, title: node, status, badge, confidence: 80, fields: [] });
const av = (over: Partial<SignalAvailability>): SignalAvailability => ({ page: 'ok', domainAge: 'known', registry: 'found', price: 'known', tls: 'valid', payee: 'provided', registrarReputation: 'not_assessed', ...over });

// --- Honest check states -------------------------------------------------------------------

test('a price check that had no comparison is Not checked, never a pass', () => {
  assert.equal(groupState(ev('PRICE', 'PASS'), av({ price: 'unavailable' })), 'none');
  assert.equal(groupState(ev('PRICE', 'PASS'), av({ price: 'known' })), 'pass');
});

test('a payee check with no payee supplied is Not checked', () => {
  assert.equal(groupRan('PAYEE', av({ payee: 'not_provided' })), false);
  assert.equal(groupState(ev('PAYEE', 'PASS'), av({ payee: 'not_provided' })), 'none');
});

test('a badge that says Not checked is neutral whatever the status', () => {
  assert.equal(groupState(ev('MERCHANT', 'WARN', 'Not checked'), av({})), 'none');
});

test('group states map status to pass, warn and fail', () => {
  assert.equal(groupState(ev('SURFACE', 'PASS')), 'pass');
  assert.equal(groupState(ev('SURFACE', 'WARN')), 'warn');
  assert.equal(groupState(ev('SURFACE', 'FAIL')), 'fail');
});

test('findings that say a check could not run are Not checked even inside a passing group', () => {
  assert.equal(fieldState({ label: 'Identity Unverifiable', value: 'Name could not be compared' }, 'pass'), 'none');
  assert.equal(fieldState({ label: 'Price Unknown', value: 'x' }, 'warn'), 'none');
  assert.equal(fieldState({ label: 'Site Name', value: 'x' }, 'pass'), 'pass');
  assert.equal(fieldState({ label: 'Site Name', value: 'x' }, 'warn'), 'info');
  assert.equal(fieldState({ label: 'Tls Invalid', value: 'x', flag: true }, 'fail'), 'fail');
  assert.equal(fieldState({ label: 'Tls Invalid', value: 'x', flag: true }, 'warn'), 'warn');
});

test('domain age is shown in human units with the exact days kept as detail', () => {
  assert.equal(humanAge(8766), 'about 24 years');
  assert.equal(humanAge(400), 'about 1 year');
  assert.equal(humanAge(150), 'about 5 months');
  assert.equal(humanAge(12), '12 days');
  assert.equal(humanAge(null), 'Unknown');
  const t = findingText({ label: 'Domain Age', value: '8,766 days' });
  assert.equal(t.text, 'about 24 years');
  assert.equal(t.detail, '8,766 days');
  assert.deepEqual(findingText({ label: 'Site Name', value: 'Harborline' }), { text: 'Harborline' });
});

test('a clean scan with no payee reads "No red flags found" and says the account was not checked', () => {
  const scan = { status: 'COMPLETE' as const, verdict: 'ALLOW' as const, signalAvailability: av({ payee: 'not_provided' }), payeeName: null, orderId: undefined, reasons: [] };
  assert.equal(outcome(scan).headline, 'No red flags found');
  assert.match(outcome(scan).note ?? '', /receiving account was not checked/);
  assert.match(decisionSentence(scan), /not a clearance/);
  const paid = { ...scan, signalAvailability: av({}), payeeName: 'Harborline Outfitters Ltd' };
  assert.equal(outcome(paid).headline, 'Cleared');
  assert.equal(outcome({ ...scan, verdict: 'PAUSE' }).headline, 'Held');
});

test('the summary counts a clean scan with no payee apart from a cleared checkout', () => {
  const done = { status: 'COMPLETE' as const, orderId: undefined };
  const list = [
    { ...done, verdict: 'ALLOW' as const, signalAvailability: av({}), payeeName: 'A' },
    { ...done, verdict: 'ALLOW' as const, signalAvailability: av({ payee: 'not_provided' }), payeeName: null },
    { ...done, verdict: 'WARN' as const, signalAvailability: av({}), payeeName: 'B' },
    { ...done, verdict: 'PAUSE' as const, signalAvailability: av({}), payeeName: 'C' },
    { status: 'RUNNING' as const, verdict: undefined, signalAvailability: undefined, payeeName: null, orderId: undefined },
  ];
  assert.deepEqual(summaryCounts(list), { total: 4, cleared: 1, noFlags: 1, review: 1, held: 1 });
});

// --- Command palette --------------------------------------------------------------------------

test('looksLikeUrl accepts addresses and rejects searches', () => {
  for (const ok of ['store-name.example', 'https://www.harborline-outfitters.example/bag', 'a.b.co:8080/x?y=1']) assert.ok(looksLikeUrl(ok), ok);
  for (const no of ['', 'cases', 'two words.example', 'not a link', 'localhost']) assert.ok(!looksLikeUrl(no), no);
});

test('the palette lists pages, the three stores and the theme options', () => {
  const ids = buildCommands('').map((c) => c.id);
  assert.ok(ids.includes('go:/investigations') && ids.includes('go:/analyst'));
  assert.equal(ids.filter((i) => i.startsWith('store:')).length, 3);
  assert.deepEqual(ids.filter((i) => i.startsWith('theme:')), ['theme:system', 'theme:light', 'theme:dark']);
});

test('a pasted address adds "Check ..." first, and a search term filters the list', () => {
  const pasted = buildCommands('https://shop.example/item');
  assert.equal(pasted[0].kind, 'check');
  assert.equal(pasted[0].label, 'Check https://shop.example/item');
  const found = buildCommands('stores');
  assert.ok(found.length > 0 && found.every((c) => c.kind !== 'check'));
  assert.ok(found.some((c) => c.id === 'go:/stores'));
  assert.deepEqual(buildCommands('zzzz-nothing'), []);
});

test('the palette component stays small and is a native dialog', () => {
  const code = src('components/CommandPalette.tsx');
  assert.ok(code.split('\n').length < 200);
  assert.ok(code.includes('<dialog') && code.includes('showModal'));
});

// --- Collapsible panels -----------------------------------------------------------------------

function fakeStorage(blocked = false) {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => { if (blocked) throw new Error('blocked'); return data.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (blocked) throw new Error('blocked'); data.set(k, v); },
  };
  return data;
}

test('panels start collapsed below 1280 px and open from 1280 px', () => {
  fakeStorage();
  assert.equal(readPanel('case', PANEL_WIDE - 1), false);
  assert.equal(readPanel('case', PANEL_WIDE), true);
});

test('a remembered panel state wins over the width default', () => {
  fakeStorage();
  savePanel('case', true);
  assert.equal(readPanel('case', 800), true);
  savePanel('case', false);
  assert.equal(readPanel('case', 1920), false);
  assert.equal(panelKey('case'), 'trustora.panel.case');
});

test('blocked storage never throws and falls back to the width default', () => {
  fakeStorage(true);
  assert.doesNotThrow(() => savePanel('case', true));
  assert.equal(readPanel('case', 1920), true);
  assert.equal(readPanel('case', 400), false);
});

// --- Shell and visual rules (read from the source) ----------------------------------------------

test('the shell has a top bar with text navigation and no sidebar', () => {
  const layout = src('components/Layout.tsx');
  assert.ok(!/<aside/.test(layout) && !/232px/.test(layout), 'no sidebar');
  assert.ok(layout.includes('h-[52px]'), '52 px bar');
  for (const label of ['Check', 'Cases', 'Demo stores', 'Analyst']) assert.ok(layout.includes(`label: '${label}'`), label);
  assert.ok(layout.includes('Search or paste a link') && layout.includes('Ctrl+K'));
  assert.ok(layout.includes("e.key === '/'"), 'the / key opens the palette');
});

test('the analyst console is inside the shell', () => {
  const app = src('App.tsx');
  assert.ok(app.indexOf('path="analyst"') < app.indexOf('</Route>'));
});

function files(dir: string): string[] {
  return readdirSync(new URL(`../src/${dir}/`, import.meta.url)).filter((f) => f.endsWith('.tsx')).map((f) => `${dir}/${f}`);
}

test('no uppercase micro-labels, glow, gradients or icon-in-circle treatments on the screens', () => {
  const offenders: string[] = [];
  for (const f of [...files('pages'), ...files('components'), ...files('components/ui')]) {
    const code = src(f);
    for (const bad of [/\buppercase\b/, /tracking-(wide|wider|widest)/, /\bbg-gradient/, /shadow-glow/, /rounded-full[^'"]*place-items-center|place-items-center[^'"]*rounded-full/]) {
      if (bad.test(code.replace(/animate-pulse/g, ''))) offenders.push(`${f}: ${bad}`);
    }
  }
  assert.deepEqual(offenders, [], 'storefront pages are exempt only by being third-party looking');
});
