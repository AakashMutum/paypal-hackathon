import test from 'node:test';
import assert from 'node:assert/strict';
import { MEMORY_PACKAGE_NAME, MEMORY_VERSION } from '../src/index.js';

test('memory package exports module constants', () => {
  assert.equal(MEMORY_PACKAGE_NAME, '@checkout-guardian/memory');
  assert.equal(MEMORY_VERSION, '0.1.0');
});
