import test from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_PACKAGE_NAME, EVAL_VERSION } from '../src/index.js';

test('eval package exports module constants', () => {
  assert.equal(EVAL_PACKAGE_NAME, '@checkout-guardian/eval');
  assert.equal(EVAL_VERSION, '0.1.0');
});

