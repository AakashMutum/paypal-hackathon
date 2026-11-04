import assert from 'node:assert/strict';
import test from 'node:test';
import { median, percentile, summarize } from './latency-stats.mjs';

test('median of an odd and an even count, unsorted input', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
  assert.equal(median([]), null);
});

test('percentile uses the nearest rank', () => {
  const values = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(percentile(values, 95), 19);
  assert.equal(percentile(values, 100), 20);
  assert.equal(percentile(values, 50), 10);
  assert.equal(percentile([5], 95), 5);
  assert.equal(percentile([], 95), null);
});

test('summarize reports min, median, p95, max and the count under the threshold', () => {
  const samples = [1733, 1848, 1887, 2055, 3740];
  const result = summarize(samples, 2000);
  assert.deepEqual(result, { n: 5, min: 1733, median: 1887, p95: 3740, max: 3740, under: 3, thresholdMs: 2000 });
});

test('a sample exactly at the threshold is not under it', () => {
  assert.equal(summarize([1999, 2000, 2001], 2000).under, 1);
});

test('summarize does not change its input and handles no samples', () => {
  const samples = [3, 1, 2];
  summarize(samples);
  assert.deepEqual(samples, [3, 1, 2]);
  assert.deepEqual(summarize([]), { n: 0, min: null, median: null, p95: null, max: null, under: 0, thresholdMs: 2000 });
});

test('summarize rejects values that are not real durations', () => {
  for (const bad of [NaN, Infinity, -1, '12', null, undefined]) {
    assert.throws(() => summarize([10, bad]), /Invalid latency sample/);
  }
});
