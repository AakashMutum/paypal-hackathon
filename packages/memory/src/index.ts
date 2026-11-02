/**
 * @checkout-guardian/memory
 * Memory package for storing and retrieving entity indicators, risk history, and contextual signals.
 * Strict rules: No PII storage, indicators are non-permanent decayable flags.
 */

export const MEMORY_PACKAGE_NAME = '@checkout-guardian/memory';
export const MEMORY_VERSION = '0.1.0';

export * from './types/contracts-fallback.js';
export * from './types/historicalRecord.js';
export * from './sanitizer.js';
export * from './store/memoryStore.interface.js';
export * from './store/summaryUtils.js';
export * from './store/inMemoryMemoryStore.js';
export * from './store/elasticMemoryStore.js';
export * from './store/factory.js';
export * from './api/signalsApi.js';
