import test from 'node:test';
import assert from 'node:assert/strict';

import type { Evidence } from '../src/types.js';
import {
  ALLOW_SENTENCE,
  HEADLINES,
  identitySentence,
  templateExplanation,
  templatePhraseFor,
  truncateText,
} from '../src/explain/template.js';

let counter = 0;

function ev(type: string, data: Record<string, unknown> = {}, overrides: Partial<Evidence> = {}): Evidence {
  counter += 1;
  return {
    id: `EVD-TPL-${String(counter).padStart(3, '0')}`,
    type,
    severity: 'medium',
    confidence: 0.9,
    summary: `${type} evidence summary`,
    source: 'rule',
    deterministic: true,
    data,
    ...overrides,
  };
}

test('payee binding phrases describe each binding outcome in neutral language', () => {
  assert.match(templatePhraseFor(ev('PAYEE_BINDING', { status: 'MISMATCH' })), /not the one this merchant has registered/);
  assert.match(templatePhraseFor(ev('PAYEE_BINDING', { status: 'NO_BINDING' })), /not linked to the account/);
  assert.match(templatePhraseFor(ev('PAYEE_BINDING', { status: 'UNKNOWN_MERCHANT' })), /could not be found/);
  assert.match(templatePhraseFor(ev('PAYEE_BINDING', { status: 'MATCH' })), /matches the registered merchant/);
});

test('an unrecognised binding status falls back to the evidence summary', () => {
  const entry = ev('PAYEE_BINDING', { status: 'SOMETHING_NEW' }, { summary: 'Custom binding note.' });
  assert.equal(templatePhraseFor(entry), 'Custom binding note.');
});

test('domain age and price phrases include the actual numbers', () => {
  assert.match(templatePhraseFor(ev('DOMAIN_AGE', { ageDays: 4 })), /4 days ago/);
  assert.match(templatePhraseFor(ev('PRICE_DEVIATION', { discountPct: 74.6 })), /75% below/);
});

test('identity sentences follow the four similarity bands', () => {
  assert.match(identitySentence(0.95), /matches the registered business/);
  assert.match(identitySentence(0.7), /close to, but not the same/);
  assert.match(identitySentence(0.45), /loosely related/);
  assert.match(identitySentence(0.1), /does not match/);
});

test('technical and memory phrases are stable strings', () => {
  assert.match(templatePhraseFor(ev('INJECTION_ATTEMPT')), /instructions to automated assistants/);
  assert.match(templatePhraseFor(ev('SCAM_MEMORY_MATCH', { matchType: 'semantic' })), /flagged before/);
  assert.match(templatePhraseFor(ev('TOOL_UNAVAILABLE')), /could not be completed/);
  assert.match(templatePhraseFor(ev('TLS_INVALID')), /certificate has a problem/);
});

test('an unknown evidence type falls back to its own summary', () => {
  assert.equal(templatePhraseFor(ev('SOMETHING_NEW', {}, { summary: 'Plain sentence.' })), 'Plain sentence.');
});

test('template explanations require at least one evidence item', () => {
  assert.equal(templateExplanation([], 'WARN'), null);
  assert.equal(templateExplanation(undefined, 'PAUSE'), null);
});

test('template explanations cite the evidence ID they came from', () => {
  const evidence = [ev('PAYEE_BINDING', { status: 'MISMATCH' }), ev('DOMAIN_AGE', { ageDays: 3 })];
  const explanation = templateExplanation(evidence, 'PAUSE');
  assert.ok(explanation);
  assert.equal(explanation.bullets.length, 2);
  assert.deepEqual(explanation.bullets[0].evidenceIds, [evidence[0].id]);
  assert.deepEqual(explanation.bullets[1].evidenceIds, [evidence[1].id]);
  assert.equal(explanation.headline, HEADLINES.PAUSE);
});

test('template explanations cap at five bullets and drop duplicates', () => {
  const evidence = [
    ev('TOOL_UNAVAILABLE'),
    ev('TOOL_UNAVAILABLE'),
    ev('TLS_INVALID'),
    ev('FAVICON_MISMATCH'),
    ev('CONTACT_LEGAL_MISSING'),
    ev('PAYMENT_SECTION', {}, { summary: 'Another note.' }),
  ];
  const explanation = templateExplanation(evidence, 'WARN');
  assert.ok(explanation);
  assert.ok(explanation.bullets.length <= 5);
  const texts = explanation.bullets.map((bullet) => bullet.text);
  assert.equal(new Set(texts).size, texts.length);
});

test('an ALLOW explanation uses the positive sentence', () => {
  const explanation = templateExplanation([ev('PAYEE_BINDING', { status: 'MATCH' })], 'ALLOW');
  assert.ok(explanation);
  assert.equal(explanation.bullets[0].text, ALLOW_SENTENCE);
  assert.equal(explanation.headline, HEADLINES.ALLOW);
});

test('every decision has a distinct safe headline', () => {
  assert.equal(new Set([HEADLINES.ALLOW, HEADLINES.WARN, HEADLINES.PAUSE]).size, 3);
  assert.match(HEADLINES.PAUSE, /stopped/);
});

test('truncation keeps text within the limit and marks the cut', () => {
  assert.equal(truncateText('short', 40), 'short');
  const cut = truncateText('a'.repeat(80), 20);
  assert.equal(cut.length, 20);
  assert.ok(cut.endsWith('...'));
});

test('phrases never exceed the 160 character bullet limit after truncation', () => {
  const long = ev('SOMETHING_NEW', {}, { summary: 'y'.repeat(300) });
  const explanation = templateExplanation([long], 'WARN');
  assert.ok(explanation);
  assert.ok(explanation.bullets[0].text.length <= 160);
});
