import test from 'node:test';
import assert from 'node:assert/strict';

import { coreName, normalizeLegal } from '../src/identity/normalize.js';
import {
  effectiveSimilarity,
  jaro,
  jaroWinkler,
  similarity,
  tokenOverlap,
} from '../src/identity/similarity.js';

// ------------------------------------------------------------- normalisation

test('legal suffixes are removed before comparison', () => {
  assert.equal(normalizeLegal('Veloura Outdoor Pvt Ltd'), 'veloura outdoor');
  assert.equal(normalizeLegal('Veloura Outdoor Private Limited'), 'veloura outdoor');
  assert.equal(normalizeLegal('Acme Inc'), 'acme');
});

test('ampersands become "and" and are then dropped', () => {
  assert.equal(normalizeLegal('Smith & Sons Ltd'), 'smith sons');
});

test('accents and punctuation are removed', () => {
  assert.equal(normalizeLegal('Velóura-Outdoor, SA'), 'veloura outdoor');
});

test('case does not matter', () => {
  assert.equal(normalizeLegal('ACME OUTLETS'), normalizeLegal('acme outlets'));
});

test('generic trading words are removed only for brand comparison', () => {
  assert.equal(coreName('Veloura Official Outlet'), 'veloura');
  assert.equal(coreName('Veloura Outdoor'), 'veloura outdoor');
  assert.equal(normalizeLegal('Veloura Official Outlet'), 'veloura official outlet');
});

test('non-string input normalises to an empty string instead of throwing', () => {
  assert.equal(normalizeLegal(undefined), '');
  assert.equal(normalizeLegal(null), '');
  assert.equal(normalizeLegal(42), '');
  assert.equal(coreName(undefined), '');
});

// ------------------------------------------------------------- jaro

test('identical strings score 1 and empty strings score 0', () => {
  assert.equal(jaro('same', 'same'), 1);
  assert.equal(jaro('', 'abc'), 0);
  assert.equal(jaro('abc', ''), 0);
});

test('jaro matches the reference values from the literature', () => {
  assert.ok(Math.abs(jaro('martha', 'marhta') - 0.9444) < 0.001);
  assert.ok(Math.abs(jaro('dwayne', 'duane') - 0.8222) < 0.001);
  assert.ok(Math.abs(jaro('dixon', 'dicksonx') - 0.7667) < 0.01);
});

test('jaro is symmetric for these examples', () => {
  for (const [a, b] of [
    ['martha', 'marhta'],
    ['veloura', 'velora'],
    ['acme outlets', 'acme outlet'],
  ]) {
    assert.ok(Math.abs(jaro(a, b) - jaro(b, a)) < 0.02, `${a}/${b}`);
  }
});

test('jaroWinkler rewards a shared prefix', () => {
  const plain = jaro('veloura', 'velourx');
  const boosted = jaroWinkler('veloura', 'velourx');
  assert.ok(boosted > plain);
  assert.equal(jaroWinkler('same', 'same'), 1);
});

test('token overlap is conservative and divides by the larger set', () => {
  assert.equal(tokenOverlap('acme outlets', 'acme outlets'), 1);
  assert.equal(tokenOverlap('acme', 'acme outlets'), 0.5);
  assert.equal(tokenOverlap('acme', 'zenith'), 0);
  assert.equal(tokenOverlap('', 'acme'), 0);
});

test('similarity takes the better of the two measures', () => {
  const reordered = similarity('outlets acme', 'acme outlets');
  assert.equal(reordered, 1);
  assert.equal(similarity('acme', 'acme'), 1);
});

// ------------------------------------------------------------- effective similarity

test('effective similarity lowers a short non-word to below the first guard band', () => {
  const value = effectiveSimilarity('hindustan unilever', 'hul');
  assert.ok(value < 0.4, String(value));
  // The raw math alone would have said 0.59, which is why the correction exists.
  assert.ok(similarity('hindustan unilever', 'hul') > 0.4);
});

test('a short name that is a real word of the longer name is not penalised', () => {
  assert.equal(effectiveSimilarity('acme', 'acme outlets'), similarity('acme', 'acme outlets'));
  assert.equal(effectiveSimilarity('veloura', 'veloura outdoor'), similarity('veloura', 'veloura outdoor'));
});

test('effective similarity never exceeds the raw similarity', () => {
  for (const [a, b] of [
    ['acme outlet', 'acme outlets'],
    ['hindustan unilever', 'hul'],
    ['zenith trading', 'veloura outdoor'],
  ]) {
    assert.ok(effectiveSimilarity(a, b) <= similarity(a, b));
  }
});
