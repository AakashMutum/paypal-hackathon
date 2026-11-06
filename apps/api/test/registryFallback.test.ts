import assert from 'node:assert/strict';
import test from 'node:test';
import { registryLookup, registryResetFallbackLog, registryResetMemory, type MerchantRow } from '../src/services/registry/registry.service.js';

const emptyDb = async () => ({ rows: [] as MerchantRow[] });
const row = (over: Partial<MerchantRow>): MerchantRow => ({ claimed_name: 'Db Merchant', domain: 'db-merchant.example', merchant_id: 'MERCH-DB', verification_status: 'VERIFIED_GENUINE', ...over } as MerchantRow);

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => { lines.push(args.join(' ')); };
  return { lines, restore: () => { console.info = original; } };
}

test('an empty database result is returned as is when DEMO_SEED is not on', async () => {
  registryResetMemory();
  const out = await registryLookup('name', 'Harborline Outfitters', { database: true, run: emptyDb, env: {} });
  assert.deepEqual(out, []);
});

test('an empty database result falls back to the demo catalogue only when DEMO_SEED is true', async () => {
  registryResetMemory(); registryResetFallbackLog();
  const log = captureLog();
  try {
    const out = await registryLookup('name', 'Harborline Outfitters', { database: true, run: emptyDb, env: { DEMO_SEED: 'true' } });
    assert.equal(out.length, 1);
    assert.equal(out[0].merchantId, 'MERCH-HARBORLINE');
    await registryLookup('name', 'Harborline Outfitters', { database: true, run: emptyDb, env: { DEMO_SEED: 'true' } });
    assert.deepEqual(log.lines.filter((l) => l.includes('database empty')), ['registry: database empty, using demo catalogue'], 'logged once');
  } finally { log.restore(); }
  assert.deepEqual(await registryLookup('name', 'Harborline Outfitters', { database: true, run: emptyDb, env: { DEMO_SEED: 'false' } }), []);
});

test('a database result wins over the demo catalogue, even with DEMO_SEED on', async () => {
  const out = await registryLookup('merchantId', 'MERCH-DB', { database: true, run: async () => ({ rows: [row({})] }), env: { DEMO_SEED: 'true' } });
  assert.equal(out.length, 1);
  assert.equal(out[0].merchantId, 'MERCH-DB');
});

test('the legal name matches as well as the brand name', async () => {
  registryResetMemory();
  const out = await registryLookup('name', 'Harborline Outfitters Ltd', { database: false });
  assert.equal(out.length, 1);
  assert.equal(out[0].merchantId, 'MERCH-HARBORLINE');
});

test('an unknown merchant returns no records, with or without the fallback', async () => {
  registryResetMemory();
  assert.deepEqual(await registryLookup('name', 'Nobody Trading Ltd', { database: false }), []);
  assert.deepEqual(await registryLookup('domain', 'nobody.example', { database: true, run: emptyDb, env: { DEMO_SEED: 'true' } }), []);
});

test('the impersonator payee stays unregistered, including through the fallback', async () => {
  registryResetMemory();
  const env = { DEMO_SEED: 'true' };
  assert.deepEqual(await registryLookup('name', 'Quickpay Holdings', { database: true, run: emptyDb, env }), []);
  assert.deepEqual(await registryLookup('merchantId', 'MERCH-QUICKPAY-HOLDINGS', { database: true, run: emptyDb, env }), []);
  assert.deepEqual(await registryLookup('domain', 'www.harborlyne-outfitters-sale.example', { database: false }), []);
});
