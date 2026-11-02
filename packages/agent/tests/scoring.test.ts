import test from 'node:test';
import assert from 'node:assert/strict';

import type { Evidence } from '../src/types.js';
import {
  bucketMaxima,
  isDeterministicEvidence,
  pointsFor,
  readNumber,
  scoreEvidence,
} from '../src/scoring/pointsFor.js';
import { evaluateHardRules, floorForRule, hasBlockingHardRule } from '../src/scoring/rules.js';
import { computeConfidence } from '../src/scoring/confidence.js';
import {
  actionForDecision,
  decisionForScore,
  markHardFail,
  scoreAndDecide,
} from '../src/scoring/decide.js';
import { buildFlaggedEvidenceIds, buildSummary } from '../src/scoring/summary.js';

let counter = 0;

function ev(type: string, data: Record<string, unknown> = {}, overrides: Partial<Evidence> = {}): Evidence {
  counter += 1;
  return {
    id: `EVD-T-${String(counter).padStart(3, '0')}`,
    type,
    severity: 'medium',
    confidence: 0.9,
    summary: `${type} evidence`,
    source: 'rule',
    deterministic: true,
    data,
    ...overrides,
  };
}

const binding = (status: string, extra: Record<string, unknown> = {}, overrides: Partial<Evidence> = {}) =>
  ev('PAYEE_BINDING', { status, ...extra }, overrides);

const age = (ageDays: unknown, overrides: Partial<Evidence> = {}) =>
  ev('DOMAIN_AGE', { ageDays }, overrides);

const lookalike = (brandId: string | undefined = 'BRAND-VELOURA', overrides: Partial<Evidence> = {}) =>
  ev('LOOKALIKE_DOMAIN', { matchesKnownBrand: true, brandId }, overrides);

const price = (discountPct: unknown, overrides: Partial<Evidence> = {}) =>
  ev('PRICE_DEVIATION', { discountPct }, overrides);

// ---------------------------------------------------------------- pointsFor

test('DOMAIN_AGE under 7 days scores the full domain bucket', () => {
  assert.deepEqual(pointsFor(age(6)), { bucket: 'D', points: 30 });
});

test('DOMAIN_AGE boundary at 7 days drops to 21 points', () => {
  assert.deepEqual(pointsFor(age(7)), { bucket: 'D', points: 21 });
  assert.deepEqual(pointsFor(age(29)), { bucket: 'D', points: 21 });
});

test('DOMAIN_AGE at 30 days drops to 9 points', () => {
  assert.deepEqual(pointsFor(age(30)), { bucket: 'D', points: 9 });
  assert.deepEqual(pointsFor(age(89)), { bucket: 'D', points: 9 });
});

test('DOMAIN_AGE at 90 days is no longer a risk signal', () => {
  assert.deepEqual(pointsFor(age(90)), { bucket: 'D', points: 0 });
  assert.deepEqual(pointsFor(age(1460)), { bucket: 'D', points: 0 });
});

test('DOMAIN_AGE without a usable age yields no points instead of guessing', () => {
  assert.equal(pointsFor(ev('DOMAIN_AGE', {})), null);
  assert.equal(pointsFor(ev('DOMAIN_AGE', { ageDays: 'not-a-number' })), null);
  assert.equal(pointsFor(ev('DOMAIN_AGE', { ageDays: null })), null);
});

test('DOMAIN_AGE with a negative age is treated as malformed', () => {
  assert.equal(pointsFor(age(-3)), null);
});

test('DOMAIN_AGE accepts a numeric string from JSON adapters', () => {
  assert.deepEqual(pointsFor(age('12')), { bucket: 'D', points: 21 });
});

test('LOOKALIKE_DOMAIN scores 30 only when the brand match is a real boolean', () => {
  assert.deepEqual(pointsFor(lookalike()), { bucket: 'D', points: 30 });
  assert.equal(pointsFor(ev('LOOKALIKE_DOMAIN', { matchesKnownBrand: false })), null);
  assert.equal(pointsFor(ev('LOOKALIKE_DOMAIN', { matchesKnownBrand: 'true' })), null);
  assert.equal(pointsFor(ev('LOOKALIKE_DOMAIN', {})), null);
});

test('SCAM_MEMORY_MATCH scores exact repeats higher than semantic ones', () => {
  assert.deepEqual(pointsFor(ev('SCAM_MEMORY_MATCH', { matchType: 'exact_payee' })), { bucket: 'D', points: 30 });
  assert.deepEqual(pointsFor(ev('SCAM_MEMORY_MATCH', { matchType: 'exact_domain' })), { bucket: 'D', points: 30 });
  assert.deepEqual(pointsFor(ev('SCAM_MEMORY_MATCH', { matchType: 'semantic' })), { bucket: 'D', points: 21 });
});

test('SCAM_MEMORY_MATCH with an unknown match type scores nothing', () => {
  assert.equal(pointsFor(ev('SCAM_MEMORY_MATCH', {})), null);
  assert.equal(pointsFor(ev('SCAM_MEMORY_MATCH', { matchType: 'vibes' })), null);
});

test('PAYEE_BINDING points follow the registry outcome', () => {
  assert.deepEqual(pointsFor(binding('MISMATCH')), { bucket: 'M', points: 40 });
  assert.deepEqual(pointsFor(binding('NO_BINDING')), { bucket: 'M', points: 28 });
  assert.deepEqual(pointsFor(binding('UNKNOWN_MERCHANT')), { bucket: 'M', points: 20 });
  assert.deepEqual(pointsFor(binding('MATCH')), { bucket: 'M', points: 0 });
});

test('PAYEE_BINDING with an unknown or missing status scores zero, not a crash', () => {
  assert.deepEqual(pointsFor(binding('SOMETHING_NEW')), { bucket: 'M', points: 0 });
  assert.deepEqual(pointsFor(ev('PAYEE_BINDING', {})), { bucket: 'M', points: 0 });
});

test('the flat merchant signals carry their documented weights', () => {
  assert.deepEqual(pointsFor(ev('CLAIMED_BRAND_MISMATCH')), { bucket: 'M', points: 40 });
  assert.deepEqual(pointsFor(ev('IMAGE_REUSE')), { bucket: 'M', points: 32 });
  assert.deepEqual(pointsFor(ev('PAYEE_FREE_EMAIL')), { bucket: 'M', points: 12 });
});

test('IDENTITY_MATCH scales suspicion with the overall similarity', () => {
  assert.deepEqual(pointsFor(ev('IDENTITY_MATCH', { overall: 0.2 })), { bucket: 'M', points: 30 });
  assert.deepEqual(pointsFor(ev('IDENTITY_MATCH', { overall: 0.3 })), { bucket: 'M', points: 20 });
  assert.deepEqual(pointsFor(ev('IDENTITY_MATCH', { overall: 0.59 })), { bucket: 'M', points: 20 });
  assert.deepEqual(pointsFor(ev('IDENTITY_MATCH', { overall: 0.6 })), { bucket: 'M', points: 8 });
  assert.deepEqual(pointsFor(ev('IDENTITY_MATCH', { overall: 0.85 })), { bucket: 'M', points: 0 });
});

test('IDENTITY_MATCH outside the 0..1 range is rejected as malformed', () => {
  assert.equal(pointsFor(ev('IDENTITY_MATCH', { overall: 1.5 })), null);
  assert.equal(pointsFor(ev('IDENTITY_MATCH', { overall: -0.1 })), null);
  assert.equal(pointsFor(ev('IDENTITY_MATCH', {})), null);
});

test('PRICE_DEVIATION steps at 50, 70 and 80 percent', () => {
  assert.deepEqual(pointsFor(price(85)), { bucket: 'P', points: 20 });
  assert.deepEqual(pointsFor(price(80)), { bucket: 'P', points: 20 });
  assert.deepEqual(pointsFor(price(79)), { bucket: 'P', points: 14 });
  assert.deepEqual(pointsFor(price(70)), { bucket: 'P', points: 14 });
  assert.deepEqual(pointsFor(price(69)), { bucket: 'P', points: 8 });
  assert.deepEqual(pointsFor(price(50)), { bucket: 'P', points: 8 });
  assert.deepEqual(pointsFor(price(49)), { bucket: 'P', points: 0 });
});

test('a negative discount (priced above market) scores nothing', () => {
  assert.deepEqual(pointsFor(price(-10)), { bucket: 'P', points: 0 });
});

test('PRICE_DEVIATION without a discount yields no points', () => {
  assert.equal(pointsFor(ev('PRICE_DEVIATION', {})), null);
});

test('technical signals carry 10, 10, 5 and 5 points', () => {
  assert.deepEqual(pointsFor(ev('TLS_INVALID')), { bucket: 'T', points: 10 });
  assert.deepEqual(pointsFor(ev('INJECTION_ATTEMPT')), { bucket: 'T', points: 10 });
  assert.deepEqual(pointsFor(ev('CONTACT_LEGAL_MISSING')), { bucket: 'T', points: 5 });
  assert.deepEqual(pointsFor(ev('FAVICON_MISMATCH')), { bucket: 'T', points: 5 });
});

test('informational and unknown evidence types never add points', () => {
  assert.equal(pointsFor(ev('REGISTRY_RECORD', { records: [] })), null);
  assert.equal(pointsFor(ev('PAGE_SECTION_CLAIMS', {})), null);
  assert.equal(pointsFor(ev('TOOL_UNAVAILABLE', {})), null);
  assert.equal(pointsFor(ev('SOMETHING_NEW')), null);
});

test('scoring never mutates the evidence it was given', () => {
  const original = binding('MISMATCH', { expectedMerchantId: 'MERCH-A' });
  const snapshot = JSON.stringify(original);
  pointsFor(original);
  scoreAndDecide([original]);
  assert.equal(JSON.stringify(original), snapshot);
});

test('the bucket keeps the worst signal instead of summing signals', () => {
  const evidence = [binding('MISMATCH'), ev('IMAGE_REUSE'), ev('PAYEE_FREE_EMAIL')];
  const buckets = bucketMaxima(scoreEvidence(evidence));
  assert.equal(buckets.M, 40);
});

test('malformed entries are skipped without breaking the sweep', () => {
  const entries = [null as unknown as Evidence, { id: 'x' } as unknown as Evidence, binding('MATCH')];
  const scored = scoreEvidence(entries);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].points, 0);
});

// ---------------------------------------------------------------- determinism

test('a model-sourced signal is never treated as deterministic', () => {
  const modelEvidence = binding('MISMATCH', {}, { source: 'llm', deterministic: true });
  assert.equal(isDeterministicEvidence(modelEvidence), false);
});

test('a semantic memory match cannot claim determinism', () => {
  const semantic = ev('SCAM_MEMORY_MATCH', { matchType: 'semantic' }, { source: 'elastic', deterministic: true });
  assert.equal(isDeterministicEvidence(semantic), false);
});

// ---------------------------------------------------------------- hard rules

test('HF1 fires only for a deterministic payee mismatch', () => {
  const rules = evaluateHardRules([binding('MISMATCH')]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF1']);
  assert.equal(rules[0].evidenceIds.length, 1);
});

test('HF1 ignores a mismatch that is not deterministic', () => {
  assert.deepEqual(evaluateHardRules([binding('MISMATCH', {}, { deterministic: false })]), []);
});

test('HF1 ignores a mismatch produced by a model even if flagged deterministic', () => {
  assert.deepEqual(evaluateHardRules([binding('MISMATCH', {}, { source: 'llm', deterministic: true })]), []);
});

test('NO_BINDING and UNKNOWN_MERCHANT do not trigger HF1', () => {
  assert.deepEqual(evaluateHardRules([binding('NO_BINDING')]), []);
  assert.deepEqual(evaluateHardRules([binding('UNKNOWN_MERCHANT')]), []);
});

test('HF2 fires for a lookalike next to a mismatched payee', () => {
  const rules = evaluateHardRules([lookalike(), binding('MISMATCH')]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF1', 'HF2']);
});

test('HF2 fires when the payee matches its own domain but is not linked to the brand', () => {
  const rules = evaluateHardRules([lookalike('BRAND-VELOURA'), binding('MATCH', { linkedBrandIds: [] })]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF2']);
});

test('HF2 is suppressed when the payee is a linked seller of that brand', () => {
  const rules = evaluateHardRules([
    lookalike('BRAND-VELOURA'),
    binding('MATCH', { linkedBrandIds: ['BRAND-VELOURA'] }),
  ]);
  assert.deepEqual(rules, []);
});

test('HF2 fires on an unknown payee even when the lookalike brand is linked', () => {
  const rules = evaluateHardRules([
    lookalike('BRAND-VELOURA'),
    binding('UNKNOWN_MERCHANT', { linkedBrandIds: ['BRAND-VELOURA'] }),
  ]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF2']);
});

test('HF2 cannot fire without any payee binding result (preview mode)', () => {
  assert.deepEqual(evaluateHardRules([lookalike()]), []);
});

test('HF2 ignores a lookalike that is not a known-brand match', () => {
  const notAMatch = ev('LOOKALIKE_DOMAIN', { matchesKnownBrand: false, brandId: 'BRAND-VELOURA' });
  assert.deepEqual(evaluateHardRules([notAMatch, binding('MISMATCH')]).map((rule) => rule.rule), ['HF1']);
});

test('HF3 fires on injected page text and merges multiple findings', () => {
  const rules = evaluateHardRules([ev('INJECTION_ATTEMPT'), ev('INJECTION_ATTEMPT')]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF3']);
  assert.equal(rules[0].evidenceIds.length, 2);
});

test('HF3 ignores a non-deterministic injection finding', () => {
  assert.deepEqual(evaluateHardRules([ev('INJECTION_ATTEMPT', {}, { deterministic: false })]), []);
});

test('hard-rule floors are 75 for HF1/HF2 and 40 for HF3', () => {
  assert.equal(floorForRule('HF1'), 75);
  assert.equal(floorForRule('HF2'), 75);
  assert.equal(floorForRule('HF3'), 40);
  assert.equal(hasBlockingHardRule([{ rule: 'HF3', evidenceIds: [], description: 'x' }]), false);
  assert.equal(hasBlockingHardRule([{ rule: 'HF2', evidenceIds: [], description: 'x' }]), true);
});

// ---------------------------------------------------------------- decisions

test('decision thresholds are 0-39 ALLOW, 40-74 WARN, 75-100 PAUSE', () => {
  assert.equal(decisionForScore(0), 'ALLOW');
  assert.equal(decisionForScore(39), 'ALLOW');
  assert.equal(decisionForScore(40), 'WARN');
  assert.equal(decisionForScore(74), 'WARN');
  assert.equal(decisionForScore(75), 'PAUSE');
  assert.equal(decisionForScore(100), 'PAUSE');
});

test('each decision maps to one recommended action', () => {
  assert.equal(actionForDecision('ALLOW'), 'PROCEED');
  assert.equal(actionForDecision('WARN'), 'WARN_DISPLAYED');
  assert.equal(actionForDecision('PAUSE'), 'CAPTURE_PAUSED');
});

test('scenario A (genuine seller) scores zero and allows', () => {
  const result = scoreAndDecide([age(1460), binding('MATCH'), price(1)]);
  assert.equal(result.score, 0);
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.recommendedAction, 'PROCEED');
  assert.deepEqual(result.hardRulesTriggered, []);
  assert.deepEqual(result.buckets, { domain: 0, merchant: 0, pricing: 0, technical: 0 });
});

test('scenario B (suspicious seller) lands on 61 WARN', () => {
  const result = scoreAndDecide([age(12), binding('UNKNOWN_MERCHANT'), price(85)]);
  assert.equal(result.score, 61);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.recommendedAction, 'WARN_DISPLAYED');
  assert.equal(result.confidence, 0.95);
  assert.deepEqual(result.hardRulesTriggered, []);
});

test('scenario C (impersonator) lands on 94 PAUSE with all three hard rules', () => {
  const result = scoreAndDecide([
    age(4),
    lookalike(),
    binding('MISMATCH', { linkedBrandIds: [] }, { id: 'EVD-PAYEE-01' }),
    price(74),
    ev('INJECTION_ATTEMPT'),
  ]);
  assert.equal(result.score, 94);
  assert.equal(result.decision, 'PAUSE');
  assert.deepEqual(result.hardRulesTriggered.map((rule) => rule.rule), ['HF1', 'HF2', 'HF3']);
  assert.ok(result.confidence >= 0.95);
});

test('scenario D2 (name-matched scammer) is floored to 75 by HF2', () => {
  const result = scoreAndDecide([
    age(3),
    lookalike(),
    binding('MATCH', { linkedBrandIds: [] }),
    price(45),
    ev('CLAIMED_BRAND_MISMATCH'),
  ]);
  assert.equal(result.score, 75);
  assert.equal(result.decision, 'PAUSE');
  assert.deepEqual(result.hardRulesTriggered.map((rule) => rule.rule), ['HF2']);
});

test('HF1 floors a low score all the way to PAUSE', () => {
  const result = scoreAndDecide([binding('MISMATCH'), ev('TOOL_UNAVAILABLE')]);
  assert.equal(result.score, 75);
  assert.equal(result.decision, 'PAUSE');
});

test('HF3 alone can only force WARN, never PAUSE', () => {
  const result = scoreAndDecide([ev('INJECTION_ATTEMPT')]);
  assert.equal(result.score, 40);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.recommendedAction, 'WARN_DISPLAYED');
});

test('R4 caps purely model-generated evidence at 74', () => {
  const result = scoreAndDecide([
    lookalike('BRAND-X', { source: 'llm', deterministic: false }),
    ev('IDENTITY_MATCH', { overall: 0.1 }, { source: 'llm', deterministic: false }),
    price(90, { source: 'llm', deterministic: false }),
  ]);
  assert.equal(result.score, 74);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.r4Capped, true);
  assert.equal(result.deterministicPoints, 0);
});

test('model evidence cannot lift a deterministic 41 over the PAUSE line', () => {
  const result = scoreAndDecide([
    age(12),
    price(85),
    ev('IDENTITY_MATCH', { overall: 0.1 }, { source: 'llm', deterministic: false }),
    ev('TLS_INVALID', {}, { source: 'llm', deterministic: false }),
  ]);
  assert.equal(result.deterministicPoints, 41);
  assert.equal(result.score, 74);
  assert.equal(result.decision, 'WARN');
});

test('deterministic evidence alone is allowed past 74', () => {
  const result = scoreAndDecide([age(3), ev('CLAIMED_BRAND_MISMATCH'), price(50)]);
  assert.equal(result.score, 78);
  assert.equal(result.decision, 'PAUSE');
});

test('a malformed single signal cannot push the score past 74 either', () => {
  const modelOnly = ev('SCAM_MEMORY_MATCH', { matchType: 'semantic' }, { source: 'llm', deterministic: true });
  const result = scoreAndDecide([modelOnly, ev('IMAGE_REUSE', {}, { deterministic: false })]);
  assert.ok(result.score <= 74);
});

test('the score never exceeds 100 even when every bucket is maximal', () => {
  const result = scoreAndDecide([
    age(1),
    binding('MISMATCH'),
    ev('CLAIMED_BRAND_MISMATCH'),
    price(95),
    ev('TLS_INVALID'),
    ev('INJECTION_ATTEMPT'),
    ev('FAVICON_MISMATCH'),
  ]);
  assert.equal(result.score, 100);
  assert.equal(result.riskScore, 1);
});

test('no evidence produces a zero-score ALLOW with a usable explanation', () => {
  const result = scoreAndDecide([]);
  assert.equal(result.score, 0);
  assert.equal(result.decision, 'ALLOW');
  assert.deepEqual(result.flaggedEvidenceIds, []);
  assert.ok(result.summary.length > 0);
});

// ---------------------------------------------------------------- R5 / confidence

test('a PAUSE without a hard rule is downgraded to WARN when confidence is too low', () => {
  const result = scoreAndDecide(
    [age(3), ev('CLAIMED_BRAND_MISMATCH'), price(50)],
    { baselineFailures: 3, baselineSucceeded: 5 }
  );
  assert.equal(result.score, 78);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.r5Downgraded, true);
  assert.ok(result.confidence < 0.7);
});

test('R5 never downgrades a PAUSE backed by HF1', () => {
  const result = scoreAndDecide([binding('MISMATCH')], { baselineSucceeded: 1 });
  assert.equal(result.decision, 'PAUSE');
  assert.equal(result.r5Downgraded, false);
  assert.equal(result.confidence, 0.3);
});

test('R5 never upgrades a WARN', () => {
  const result = scoreAndDecide([age(12), binding('UNKNOWN_MERCHANT')], {
    baselineFailures: 4,
    baselineSucceeded: 1,
  });
  assert.equal(result.score, 41);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.confidence, 0.3);
  assert.equal(result.r5Downgraded, false);
});

test('an ALLOW with all five supporting facts reaches the confidence ceiling', () => {
  const confidence = computeConfidence({
    evidence: [age(1460), binding('MATCH'), price(1)],
    decision: 'ALLOW',
    baselineSucceeded: 4,
  });
  assert.equal(confidence, 0.99);
});

test('a WARN gains 0.15 for each deterministic signal of 14 points or more', () => {
  const confidence = computeConfidence({
    evidence: [age(12), binding('UNKNOWN_MERCHANT')],
    decision: 'WARN',
    baselineSucceeded: 4,
  });
  assert.equal(confidence, 0.8);
});

test('model-written evidence does not raise confidence', () => {
  const confidence = computeConfidence({
    evidence: [ev('IDENTITY_MATCH', { overall: 0.1 }, { source: 'llm', deterministic: false })],
    decision: 'WARN',
    baselineSucceeded: 4,
  });
  assert.equal(confidence, 0.5);
});

test('every failed baseline tool removes 0.15 confidence', () => {
  const confidence = computeConfidence({
    evidence: [age(12), binding('UNKNOWN_MERCHANT')],
    decision: 'WARN',
    baselineFailures: 2,
    baselineSucceeded: 4,
  });
  assert.equal(confidence, 0.5);
});

test('confidence is forced to 0.30 when fewer than two baseline tools succeeded', () => {
  const confidence = computeConfidence({
    evidence: [binding('MISMATCH')],
    decision: 'PAUSE',
    baselineSucceeded: 1,
  });
  assert.equal(confidence, 0.3);
});

test('a hard rule guarantees at least 0.95 confidence', () => {
  const confidence = computeConfidence({
    evidence: [binding('MISMATCH')],
    decision: 'PAUSE',
    baselineFailures: 4,
    baselineSucceeded: 4,
  });
  assert.equal(confidence, 0.95);
});

test('confidence never falls below 0.20', () => {
  const confidence = computeConfidence({
    evidence: [],
    decision: 'WARN',
    baselineFailures: 10,
    baselineSucceeded: 4,
  });
  assert.equal(confidence, 0.2);
});

// ---------------------------------------------------------------- summary / flagged

test('flagged evidence is sorted by points and limited to six', () => {
  const result = scoreAndDecide([
    ev('INJECTION_ATTEMPT', {}, { id: 'EVD-I' }),
    age(3, { id: 'EVD-D' }),
    binding('MISMATCH', {}, { id: 'EVD-M' }),
    price(95, { id: 'EVD-P' }),
    ev('FAVICON_MISMATCH', {}, { id: 'EVD-F' }),
    ev('CONTACT_LEGAL_MISSING', {}, { id: 'EVD-C' }),
    ev('TLS_INVALID', {}, { id: 'EVD-T' }),
  ]);
  assert.equal(result.flaggedEvidenceIds.length, 6);
  assert.deepEqual(result.flaggedEvidenceIds.slice(0, 3), ['EVD-M', 'EVD-D', 'EVD-P']);
  assert.equal(result.flaggedEvidenceIds.includes('EVD-F'), false);
});

test('hard-rule evidence is included even when other evidence scores higher', () => {
  const result = scoreAndDecide([binding('MISMATCH'), ev('INJECTION_ATTEMPT')]);
  assert.ok(result.flaggedEvidenceIds.includes(result.hardRulesTriggered[0].evidenceIds[0]));
});

test('duplicate evidence IDs are reported once', () => {
  const shared = binding('MISMATCH', {}, { id: 'EVD-DUP' });
  const result = scoreAndDecide([shared, { ...shared }]);
  assert.deepEqual(result.flaggedEvidenceIds, ['EVD-DUP']);
});

test('the summary uses template wording and never exceeds 140 characters', () => {
  const result = scoreAndDecide([binding('MISMATCH'), age(3)]);
  assert.match(result.summary, /not the one this merchant has registered/);
  assert.ok(result.summary.length <= 140);
});

test('a very long evidence summary is truncated for the verdict summary', () => {
  const long = { ...ev('SOMETHING_NEW'), summary: 'x'.repeat(400) };
  const summary = buildSummary('WARN', [long], [long.id]);
  assert.ok(summary.length <= 140);
  assert.ok(summary.endsWith('...'));
});

test('the summary falls back to a decision phrase when nothing is flagged', () => {
  assert.match(buildSummary('PAUSE', [], []), /stopped/);
  assert.match(buildSummary('ALLOW', [], []), /consistent/);
  assert.match(buildSummary('WARN', [], []), /concerns/);
});

test('markHardFail copies evidence and only flags cited IDs', () => {
  const bad = binding('MISMATCH', {}, { id: 'EVD-BAD' });
  const good = age(3, { id: 'EVD-GOOD' });
  const marked = markHardFail([bad, good], evaluateHardRules([bad, good]));
  assert.equal(marked[0].hardFail, true);
  assert.equal(marked[1].hardFail, undefined);
  assert.equal(bad.hardFail, undefined);
});

test('buildFlaggedEvidenceIds tolerates unknown IDs in the flagged list', () => {
  const ids = buildFlaggedEvidenceIds([age(3, { id: 'EVD-1' })], scoreEvidence([age(3, { id: 'EVD-1' })]), [], 6);
  assert.deepEqual(ids, ['EVD-1']);
  assert.deepEqual(buildSummary('WARN', [age(3, { id: 'EVD-1' })], ['EVD-MISSING']), buildSummary('WARN', [], []));
});

// ---------------------------------------------------------------- properties

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const RANDOM_TYPES = [
  'DOMAIN_AGE',
  'LOOKALIKE_DOMAIN',
  'PAYEE_BINDING',
  'CLAIMED_BRAND_MISMATCH',
  'IMAGE_REUSE',
  'IDENTITY_MATCH',
  'PRICE_DEVIATION',
  'TLS_INVALID',
  'INJECTION_ATTEMPT',
] as const;

function randomEvidence(random: () => number): Evidence {
  const type = RANDOM_TYPES[Math.floor(random() * RANDOM_TYPES.length)];
  const data: Record<string, unknown> = {};
  if (type === 'DOMAIN_AGE') data.ageDays = Math.floor(random() * 200);
  if (type === 'LOOKALIKE_DOMAIN') data.matchesKnownBrand = random() > 0.3;
  if (type === 'PAYEE_BINDING') {
    data.status = ['MATCH', 'MISMATCH', 'NO_BINDING', 'UNKNOWN_MERCHANT'][Math.floor(random() * 4)];
  }
  if (type === 'IDENTITY_MATCH') data.overall = Number(random().toFixed(2));
  if (type === 'PRICE_DEVIATION') data.discountPct = Math.floor(random() * 100);
  return ev(type, data, {
    deterministic: random() > 0.4,
    source: random() > 0.7 ? 'llm' : 'rule',
  });
}

test('adding model-generated evidence never lowers the score', () => {
  const random = lcg(12345);
  for (let round = 0; round < 50; round += 1) {
    const base = Array.from({ length: 3 }, () => randomEvidence(random));
    const extra = ev('IDENTITY_MATCH', { overall: Number(random().toFixed(2)) }, { source: 'llm', deterministic: false });
    const before = scoreAndDecide(base).score;
    const after = scoreAndDecide([...base, extra]).score;
    assert.ok(after >= before, `round ${round}: ${after} < ${before}`);
  }
});

test('adding any evidence can never turn a PAUSE into an ALLOW', () => {
  const random = lcg(999);
  for (let round = 0; round < 50; round += 1) {
    const base = Array.from({ length: 4 }, () => randomEvidence(random));
    const before = scoreAndDecide(base).decision;
    const after = scoreAndDecide([...base, randomEvidence(random)]).decision;
    if (before === 'PAUSE') assert.notEqual(after, 'ALLOW', `round ${round}`);
  }
});

test('scoring is deterministic for identical input', () => {
  const evidence = [age(4), lookalike(), binding('MISMATCH'), price(74), ev('INJECTION_ATTEMPT')];
  const first = scoreAndDecide(evidence);
  const second = scoreAndDecide(evidence);
  assert.deepEqual(first, second);
});

test('readNumber rejects non numeric strings and infinities', () => {
  assert.equal(readNumber('12'), 12);
  assert.equal(readNumber('abc'), undefined);
  assert.equal(readNumber(Infinity), undefined);
  assert.equal(readNumber(Number.NaN), undefined);
  assert.equal(readNumber(undefined), undefined);
});

// ------------------------------------------------- real-world failure modes

test('two failed baseline tools turn a clean zero score into WARN', () => {
  const result = scoreAndDecide([], { baselineFailures: 2, baselineSucceeded: 0 });
  assert.equal(result.score, 0);
  assert.equal(result.decision, 'WARN');
  assert.equal(result.confidence, 0.3);
  assert.equal(result.insufficientEvidence, true);
});

test('insufficient evidence never weakens a hard-rule PAUSE', () => {
  const result = scoreAndDecide([binding('MISMATCH')], { baselineSucceeded: 1 });
  assert.equal(result.decision, 'PAUSE');
  assert.equal(result.insufficientEvidence, true);
});

test('a fully checked clean case still allows', () => {
  const result = scoreAndDecide([age(1460), binding('MATCH')], { baselineSucceeded: 2 });
  assert.equal(result.decision, 'ALLOW');
  assert.equal(result.insufficientEvidence, false);
});

test('HF2 cites only the lookalikes the payee is not linked to', () => {
  const rules = evaluateHardRules([
    lookalike('BRAND-A', { id: 'EVD-LINKED' }),
    lookalike('BRAND-B', { id: 'EVD-UNLINKED' }),
    binding('MATCH', { linkedBrandIds: ['BRAND-A'] }),
  ]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF2']);
  assert.deepEqual(rules[0].evidenceIds, ['EVD-UNLINKED']);
});

test('HF2 treats a lookalike without a brandId as unverifiable and fires', () => {
  const rules = evaluateHardRules([
    lookalike(undefined, { id: 'EVD-NO-BRAND' }),
    binding('MATCH', { linkedBrandIds: ['BRAND-A'] }),
  ]);
  assert.deepEqual(rules.map((rule) => rule.rule), ['HF2']);
  assert.deepEqual(rules[0].evidenceIds, ['EVD-NO-BRAND']);
});

test('the R5 confidence threshold is configurable', () => {
  const evidence = [age(3), ev('CLAIMED_BRAND_MISMATCH'), price(50)];
  const strict = scoreAndDecide(evidence, { baselineFailures: 3, baselineSucceeded: 5 });
  const relaxed = scoreAndDecide(evidence, {
    baselineFailures: 3,
    baselineSucceeded: 5,
    confidenceThreshold: 0.3,
  });
  assert.equal(strict.decision, 'WARN');
  assert.equal(strict.r5Downgraded, true);
  assert.equal(relaxed.decision, 'PAUSE');
  assert.equal(relaxed.r5Downgraded, false);
});

test('scoring tolerates null, undefined and garbage evidence', () => {
  assert.equal(scoreAndDecide(null as unknown as Evidence[]).score, 0);
  const result = scoreAndDecide([
    undefined as unknown as Evidence,
    { id: 'x' } as unknown as Evidence,
  ]);
  assert.equal(result.score, 0);
  assert.equal(result.decision, 'ALLOW');
});

test('hard-rule evaluation tolerates a missing evidence array', () => {
  assert.deepEqual(evaluateHardRules(undefined as unknown as Evidence[]), []);
  assert.deepEqual(evaluateHardRules(null as unknown as Evidence[]), []);
});
