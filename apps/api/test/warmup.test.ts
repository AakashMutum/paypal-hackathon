import assert from 'node:assert/strict';
import test from 'node:test';
import { warmUp, warmUpEnabled } from '../src/services/warmup.service.js';

test('the warm-up is off in tests and when WARMUP says so', () => {
  assert.equal(warmUpEnabled({ NODE_ENV: 'test' }), false);
  assert.equal(warmUpEnabled({ WARMUP: 'off' }), false);
  assert.equal(warmUpEnabled({ WARMUP: 'false' }), false);
  assert.equal(warmUpEnabled({ WARMUP: '0' }), false);
  assert.equal(warmUpEnabled({}), true);
  assert.equal(warmUpEnabled({ WARMUP: 'on' }), true);
});

test('the warm-up never throws and reports its steps by name only', async () => {
  const report = await warmUp();
  assert.ok(report.steps.length >= 2);
  for (const step of report.steps) {
    assert.match(step.name, /^(database|memory|agent)$/);
    assert.equal(typeof step.ok, 'boolean');
  }
  assert.ok(report.ms >= 0);
});
