import assert from 'node:assert/strict';
import test from 'node:test';
import { Channel3ProductCollector, KernelBrowserCollector, gatherAllSignals } from '../src/index.js';
import type { Evidence, ISignalCollector } from '../src/types.js';
import { request } from './helpers.js';

const good: ISignalCollector = {
  name: 'good',
  async collect() {
    return [
      {
        id: 'good:ok',
        type: 'TEST_OK',
        severity: 'INFO',
        confidence: 1,
        summary: 'fine',
        source: 'good',
        hardFail: false,
      },
    ];
  },
};
const rejects: ISignalCollector = {
  name: 'rejecting',
  async collect() {
    throw new Error('network down');
  },
};
const throwsSync: ISignalCollector = {
  name: 'sync-throw',
  collect() {
    throw new Error('sync failure');
  },
};

test('gatherAllSignals keeps other evidence when collectors fail', async () => {
  const evidence = await gatherAllSignals(request, {}, [good, rejects, throwsSync]);
  assert.equal(evidence.length, 3);
  assert.ok(evidence.some((e) => e.type === 'TEST_OK'));
  const errors = evidence.filter((e) => e.type === 'COLLECTOR_ERROR');
  assert.equal(errors.length, 2);
  for (const e of errors) {
    assert.equal(e.severity, 'LOW');
    assert.equal(e.hardFail, false);
  }
});

test('gatherAllSignals never throws, even with no collectors', async () => {
  assert.deepEqual(await gatherAllSignals(request, {}, []), []);
});

const decisionWords = /\b(ALLOW|WARN|BLOCK|PAUSE)\b/;

test('mock mode replays the fictional store fixtures as evidence', async () => {
  const cases: Array<[string, boolean]> = [
    ['https://www.harborline-outfitters.example/checkout', false],
    ['https://www.bargainbarn-outlet.example/cart', true],
    ['https://www.harborlyne-outfitters-sale.example/checkout', true],
  ];
  for (const [merchantUrl, hasHighSeverity] of cases) {
    const evidence: Evidence[] = await gatherAllSignals({ ...request, merchantUrl }, { useMocks: true });
    assert.ok(evidence.length >= 4, merchantUrl);
    assert.equal(evidence.every((e) => e.source === 'mock-fixture'), true);
    assert.equal(evidence.some((e) => e.severity === 'HIGH'), hasHighSeverity, merchantUrl);
    for (const e of evidence) {
      assert.equal(decisionWords.test(JSON.stringify(e)), false, 'evidence must not contain a decision');
      assert.equal('verdict' in e, false);
    }
  }
});

test('mock mode reports an unknown store without failing', async () => {
  const evidence = await gatherAllSignals(
    { ...request, merchantUrl: 'https://unknown-shop.example/' },
    { useMocks: true },
  );
  assert.equal(evidence[0].type, 'MOCK_NO_FIXTURE');
});

test('stub collectors report NOT_IMPLEMENTED', async () => {
  for (const c of [new KernelBrowserCollector(), new Channel3ProductCollector()]) {
    const evidence = await c.collect();
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].type, 'NOT_IMPLEMENTED');
    assert.equal(evidence[0].severity, 'INFO');
  }
});
