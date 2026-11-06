import assert from 'node:assert/strict';
import test from 'node:test';
import { seedDemoMerchants } from '../src/services/registry/registry.service.js';

interface Call {
  text: string;
  params?: unknown[];
}

function fakeDb(existingRows: number) {
  const calls: Call[] = [];
  const run = async (text: string, params?: unknown[]) => {
    calls.push({ text, params });
    return { rows: text.startsWith('SELECT COUNT') ? [{ n: existingRows }] : [] };
  };
  return { calls, run };
}

test('nothing is seeded unless DEMO_SEED is on', async () => {
  const db = fakeDb(0);
  const result = await seedDemoMerchants({ run: db.run, enabled: false });
  assert.deepEqual(result, { seeded: 0, reason: 'disabled' });
  assert.equal(db.calls.length, 0, 'a disabled seed must not touch the database');
});

test('an empty table gets the registered demo merchants, not the impersonator', async () => {
  const db = fakeDb(0);
  const result = await seedDemoMerchants({ run: db.run, enabled: true });
  assert.equal(result.reason, 'seeded');
  assert.equal(result.seeded, 2);
  const inserts = db.calls.filter((c) => c.text.includes('INSERT INTO merchant_records'));
  assert.equal(inserts.length, 2);
  const names = inserts.map((c) => String(c.params?.[2]));
  assert.ok(names.includes('Harborline Outfitters Ltd'));
  assert.ok(inserts.every((c) => c.text.includes('ON CONFLICT (merchant_id) DO NOTHING')));
  assert.ok(inserts.every((c) => String(c.params?.[1]).endsWith('.example') && !String(c.params?.[1]).startsWith('www.')));
});

test('a table that already has rows is left alone', async () => {
  const db = fakeDb(3);
  const result = await seedDemoMerchants({ run: db.run, enabled: true });
  assert.deepEqual(result, { seeded: 0, reason: 'not_empty' });
  assert.equal(db.calls.filter((c) => c.text.includes('INSERT')).length, 0);
});
