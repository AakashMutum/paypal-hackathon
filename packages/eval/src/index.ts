/**
 * @checkout-guardian/eval
 * Benchmark dataset, systems under comparison, metrics and the evaluation runner.
 */

export const EVAL_PACKAGE_NAME = '@checkout-guardian/eval';
export const EVAL_VERSION = '0.2.0';

export * from './dataset/index.js';
export * from './harness/fixtures.js';
export * from './harness/systems.js';
export * from './metrics/index.js';
export * from './metrics/stats.js';
export * from './runner/index.js';
