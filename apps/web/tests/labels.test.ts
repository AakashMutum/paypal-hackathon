import assert from 'node:assert/strict';
import test from 'node:test';
import { closeCases, displayBrand, evidenceLabel, formatDateTime, memoryLabel, retrievalLabel, scoreText, VERDICT_WORDS, verdictText } from '../src/lib/labels.js';
import { radarMessage } from '../src/lib/explain.js';

test('one decision vocabulary with a plain subtitle', () => {
  assert.equal(verdictText('ALLOW'), 'ALLOW · Cleared');
  assert.equal(verdictText('WARN'), 'WARN · Needs review');
  assert.equal(verdictText('PAUSE'), 'PAUSE · Held');
  assert.ok(Object.values(VERDICT_WORDS).every((w) => !/risk/i.test(w.subtitle)));
});

test('a WARN with score 0 is "could not verify", never "0% anomaly"', () => {
  assert.equal(scoreText('WARN', 0), 'Could not verify');
  assert.equal(scoreText('WARN', 50), 'Score 50');
  assert.equal(scoreText('ALLOW', 0), 'Score 0');
});

test('evidence types and the API title-cased labels map to human labels', () => {
  assert.equal(evidenceLabel('TLS_INVALID'), 'Security certificate problem');
  assert.equal(evidenceLabel('Tls Invalid'), 'Security certificate problem');
  assert.equal(evidenceLabel('Contact Legal Missing'), 'No contact or legal details');
  assert.equal(evidenceLabel('Domain Age'), 'Domain age');
  assert.equal(evidenceLabel('Something New'), 'Something New');
});

test('past cases below 0.5 similarity are not shown', () => {
  const cases = [{ score: 0.49 }, { score: 0.5 }, { score: 0.9 }];
  assert.deepEqual(closeCases(cases).map((c) => c.score), [0.5, 0.9]);
  assert.deepEqual(closeCases(undefined), []);
});

test('retrieval labels say what was really used and do not claim Gemini for local hashing', () => {
  assert.match(retrievalLabel('embedding (local-hash:v1)'), /local hashing/);
  assert.doesNotMatch(retrievalLabel('embedding (local-hash:v1)'), /gemini/i);
  assert.match(retrievalLabel('embedding (gemini:gemini-embedding-001)'), /Gemini/);
  assert.match(retrievalLabel('exact'), /Exact/);
  assert.match(retrievalLabel('lexical'), /Word overlap/);
});

test('file memory is labelled as possibly resetting; Elasticsearch is not', () => {
  assert.equal(memoryLabel('file'), 'file (may reset on redeploy)');
  assert.equal(memoryLabel('elastic'), 'Elasticsearch');
  assert.match(memoryLabel('memory'), /resets on restart/);
});

test('a long or description-like claimed brand falls back to the host name', () => {
  assert.equal(displayBrand('Harborline Outfitters', 'www.harborline-outfitters.example'), 'Harborline Outfitters');
  const long = 'Buy canvas bags online. Free shipping on every order over seventy-five dollars today';
  assert.equal(displayBrand(long, 'www.shop.example'), 'shop.example');
  assert.equal(displayBrand('Great Shop | Official Store', 'www.shop.example'), 'shop.example');
  assert.equal(displayBrand('', 'www.shop.example'), 'shop.example');
});

test('dates show the day and the time', () => {
  assert.match(formatDateTime('2026-11-04T15:42:00'), /^4 Nov 2026, 15:42$/);
  assert.equal(formatDateTime('not a date'), '—');
});

test('the radar names a payee mismatch only when the flag is set', () => {
  const none = {
    payeeMismatch: false,
    payeeName: null,
    reasons: [],
    verdict: 'WARN' as const,
    signalAvailability: { page: 'blocked' as const, domainAge: 'known' as const, registry: 'not_checked' as const, price: 'not_checked' as const, tls: 'valid' as const, payee: 'not_provided' as const, registrarReputation: 'not_assessed' as const },
  };
  const unverified = radarMessage(none);
  assert.doesNotMatch(unverified, /do not line up|not the merchant/i);
  assert.match(unverified, /blocked the checker/);
  assert.match(unverified, /no receiving account was supplied/);
  assert.match(radarMessage({ ...none, payeeMismatch: true }), /not the merchant the storefront claims/);
});
