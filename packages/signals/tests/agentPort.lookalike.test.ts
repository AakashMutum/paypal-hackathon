import assert from 'node:assert/strict';
import test from 'node:test';
import { detectLookalike, editDistance, normalizedDistance } from '../src/agentPort/lookalike.js';

const known = ['veloura-outdoor.example'];

test('edit distance basics', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('same', 'same'), 0);
  assert.equal(normalizedDistance('abcd', 'abcd'), 0);
  assert.equal(normalizedDistance('abcd', 'wxyz'), 1);
});

test('a known brand domain is never a lookalike of itself', () => {
  assert.equal(detectLookalike('www.veloura-outdoor.example', known, 'Veloura'), null);
});

test('brand name inside a different domain is a lookalike of a known domain', () => {
  const match = detectLookalike('veloura-outlet-shop.example', known);
  assert.ok(match);
  assert.equal(match.matchesKnownBrand, true);
  assert.equal(match.reason, 'contains_brand');
});

test('a one-character typo is a near miss', () => {
  const match = detectLookalike('velouro-outdoor.example', known);
  assert.ok(match);
  assert.equal(match.reason, 'near_miss');
  assert.equal(match.distance, 1);
});

test('with only a claimed brand, a typo counts but the brand name alone does not', () => {
  assert.ok(detectLookalike('velour4.example', [], 'Veloura'));
  assert.equal(detectLookalike('veloura.example', [], 'Veloura'), null);
  assert.equal(detectLookalike('veloura-outdoor.example', [], 'Veloura'), null);
});

test('unrelated domains do not match', () => {
  assert.equal(detectLookalike('harborline-outfitters.example', known, 'Harborline Outfitters'), null);
  assert.equal(detectLookalike('trailpeak-deals.example', known), null);
});
