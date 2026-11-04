// Statistics for scripts/measure-latency.mjs. No dependencies, so it can be tested on its own.

/** Median of a list of numbers. The mean of the two middle values for an even count. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile: the smallest value with at least p percent of the values at or below it. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1];
}

/**
 * min, median, p95 and max in milliseconds, and how many samples were under the threshold.
 * Throws on a value that is not a finite, non-negative number, so a broken measurement is never
 * summarised as if it were real.
 */
export function summarize(samples, thresholdMs = 2000) {
  for (const value of samples) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid latency sample: ${String(value)}`);
    }
  }
  const n = samples.length;
  if (n === 0) return { n: 0, min: null, median: null, p95: null, max: null, under: 0, thresholdMs };
  return {
    n,
    min: Math.min(...samples),
    median: median(samples),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
    under: samples.filter((value) => value < thresholdMs).length,
    thresholdMs,
  };
}
