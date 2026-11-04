// @brand-check-allow functional real-merchant hostname tests, not demo content.
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

test('an official marketplace domain is never a lookalike of its own brand', () => {
  assert.equal(detectLookalike('www.amazon.in', [], 'Amazon.in'), null);
  assert.equal(detectLookalike('amazon.com', [], 'Amazon'), null);
  assert.equal(detectLookalike('www.amazon.co.uk', [], 'Amazon.co.uk'), null);
  assert.equal(detectLookalike('smile.amazon.com', [], 'Amazon'), null);
});

test('a typo-squatted marketplace domain is still a lookalike', () => {
  const match = detectLookalike('amaz0n-example.com', [], 'Amazon');
  assert.ok(match);
  assert.equal(match.matchesKnownBrand, true);
  assert.equal(match.brandName, 'Amazon');
});

test('a non-official brand-name domain is a lookalike when the official domains are known', () => {
  const amazonKnown = ['amazon.com', 'amazon.in'];
  assert.ok(detectLookalike('amazon.co.in', amazonKnown, 'Amazon'));
  assert.equal(detectLookalike('amazon.in', amazonKnown, 'Amazon'), null);
  assert.equal(detectLookalike('www.amazon.com', amazonKnown, 'Amazon'), null);
});
