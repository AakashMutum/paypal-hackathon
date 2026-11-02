import test from 'node:test';
import assert from 'node:assert/strict';
import { EVAL_PACKAGE_NAME } from '../src/index.js';

test('eval package exports its name', () => {
  assert.equal(EVAL_PACKAGE_NAME, '@checkout-guardian/eval');
});
