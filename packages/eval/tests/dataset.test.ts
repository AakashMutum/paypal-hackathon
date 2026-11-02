import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CATEGORIES,
  EvaluationCaseSchema,
  FORBIDDEN_JUDGMENT_FIELDS,
  getDefaultDatasetPath,
  loadEvaluationDataset,
  loadEvaluationDatasetAsync,
} from '../src/index.js';
import { generated } from '../scripts/generateDataset.js';

const rawCases = (): Array<Record<string, unknown>> =>
  JSON.parse(readFileSync(getDefaultDatasetPath(), 'utf8')) as Array<Record<string, unknown>>;

test('the dataset has at least 60 valid cases with unique ids', async () => {
  const dataset = loadEvaluationDataset();
  assert.ok(dataset.length >= 60);
  assert.equal(new Set(dataset.map((c) => c.id)).size, dataset.length);
  assert.equal((await loadEvaluationDatasetAsync()).length, dataset.length);
  for (const c of dataset) EvaluationCaseSchema.parse(c);
});

test('every category is present with enough cases and both labels occur', () => {
  const dataset = loadEvaluationDataset();
  for (const category of CATEGORIES) {
    assert.ok(dataset.filter((c) => c.category === category).length >= 5, `category ${category}`);
  }
  assert.ok(dataset.some((c) => c.label === 'fraud'));
  assert.ok(dataset.some((c) => c.label === 'legit'));
  assert.ok(dataset.some((c) => c.hiddenText), 'some cases carry hidden injection text');
  assert.ok(dataset.some((c) => c.bindingMerchantId === null), 'some cases have no binding file');
  assert.ok(dataset.some((c) => c.registryRecord === null), 'some cases have no registry record');
});

test('guard: no case contains a judgment field', () => {
  for (const c of rawCases()) {
    for (const field of FORBIDDEN_JUDGMENT_FIELDS) {
      assert.equal(field in c, false, `${String(c.id)} has judgment field ${field}`);
    }
    for (const key of Object.keys(c)) {
      assert.doesNotMatch(key, /consistent|matches|isFraud|expected/i, `${String(c.id)} field ${key} looks like a judgment`);
    }
  }
});

test('guard: every dataset domain and email address ends in .example', () => {
  const hostOk = (host: string) => host.endsWith('.example');
  for (const c of loadEvaluationDataset()) {
    assert.ok(hostOk(new URL(c.merchantUrl).hostname), `${c.id} merchantUrl`);
    assert.ok(hostOk(c.payeeEmail.split('@')[1]), `${c.id} payeeEmail`);
    if (c.brandOwner) assert.ok(hostOk(c.brandOwner.domain), `${c.id} brandOwner.domain`);
  }
  const text = readFileSync(getDefaultDatasetPath(), 'utf8');
  assert.doesNotMatch(text, /\.(com|net|org|shop|top|online|site|cc|icu|io|co|store|xyz)["/:?\s]/i);
});

test('guard: the committed dataset equals what the generator produces', () => {
  assert.deepEqual(rawCases(), JSON.parse(JSON.stringify(generated)));
});

test('guard: no real brand is used', () => {
  const text = readFileSync(getDefaultDatasetPath(), 'utf8');
  assert.doesNotMatch(text, /PulseAudio/i);
});
