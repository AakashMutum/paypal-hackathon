import test from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineA,
  baselineB,
  buildRegistry,
  buildRequest,
  buildSignals,
  isLookalike,
  loadEvaluationDataset,
  runFull,
  type EvaluationCase,
} from '../src/index.js';

const dataset = loadEvaluationDataset();
const flip = (c: EvaluationCase): EvaluationCase => ({
  ...c,
  label: c.label === 'fraud' ? 'legit' : 'fraud',
  category: c.category === 'easy_legit' ? 'easy_fraud' : 'easy_legit',
});

test('systems never read the label or category', async () => {
  for (const c of dataset.slice(0, 20)) {
    const f = flip(c);
    assert.equal(baselineA(c).decision, baselineA(f).decision);
    assert.equal((await baselineB(c)).decision, (await baselineB(f)).decision);
    assert.equal((await runFull(c)).decision, (await runFull(f)).decision);
  }
});

test('the request carries observables only', () => {
  const c = dataset[0];
  const request = buildRequest(c);
  assert.equal(request.payee?.merchantId, c.payeeMerchantId);
  assert.equal(JSON.stringify(request).includes(c.label), false);
});

test('webmail placeholder is swapped for a provider the agent recognises', () => {
  const c = dataset.find((x) => x.payeeEmail.endsWith('@freemail.example'));
  assert.ok(c);
  assert.match(buildRequest(c).payee?.email ?? '', /@gmail\.com$/);
});

test('binding evidence follows the published merchant id', async () => {
  const withMismatch = dataset.find((c) => c.bindingMerchantId !== null && c.bindingMerchantId !== c.payeeMerchantId);
  const missing = dataset.find((c) => c.bindingMerchantId === null);
  assert.ok(withMismatch && missing);
  const opts = { timeoutMs: 100 };
  const [mismatch] = await buildSignals(withMismatch).checkPayeeBinding({ domain: 'x.example', payee: { merchantId: 'x' } }, opts);
  assert.equal((mismatch.data as { status: string }).status, 'MISMATCH');
  assert.equal(mismatch.hardFail, true);
  const [none] = await buildSignals(missing).checkPayeeBinding({ domain: 'x.example', payee: { merchantId: 'x' } }, opts);
  assert.equal((none.data as { status: string }).status, 'NO_BINDING');
});

test('registry returns only what the case observed', async () => {
  const c = dataset.find((x) => x.registryRecord === null && x.brandOwner === null);
  assert.ok(c);
  const registry = buildRegistry(c);
  assert.deepEqual(await registry.lookup({ by: 'merchantId', query: c.payeeMerchantId }, { timeoutMs: 100 }), []);
  assert.deepEqual(await registry.lookup({ by: 'name', query: c.claimedBrand }, { timeoutMs: 100 }), []);
  assert.deepEqual(await buildRegistry(c, false).lookup({ by: 'name', query: 'x' }, { timeoutMs: 100 }), []);
});

test('lookalike detection compares strings only', () => {
  assert.equal(isLookalike('veloura-outlet.example', 'veloura.example'), true);
  assert.equal(isLookalike('veloura.example', 'veloura.example'), false);
  assert.equal(isLookalike('harborline.example', 'veloura.example'), false);
});
