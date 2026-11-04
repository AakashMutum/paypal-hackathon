import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test, { afterEach, beforeEach } from 'node:test';
import {
  auditEncryptionStatus,
  classifyAuditPayload,
  isSealedAuditPayload,
  openAuditPayload,
  sealAuditPayload,
} from '../src/services/persistence/auditPrivacy.js';
import {
  MemoryRotationStore,
  PgRotationStore,
  rotateAuditEncryption,
  type QueryClientLike,
  type RotationRow,
  type RotationTable,
} from '../src/services/persistence/auditRotation.js';

// Keys made fresh for each run. They protect nothing and are never printed.
const keyA = randomBytes(32).toString('hex');
const keyB = randomBytes(32).toString('base64');
const keyC = randomBytes(32).toString('hex');

const saved = { ...process.env };
function useKeys(current?: string, previous?: string): void {
  if (current) process.env.AUDIT_ENCRYPTION_KEY = current;
  else delete process.env.AUDIT_ENCRYPTION_KEY;
  if (previous) process.env.AUDIT_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.AUDIT_ENCRYPTION_KEY_PREVIOUS;
}
beforeEach(() => useKeys());
afterEach(() => {
  process.env = { ...saved };
});

const secretNote = { note: 'distinctive-audit-text', n: 1 };

function sealedWith(key: string, value: unknown = secretNote): unknown {
  useKeys(key);
  return sealAuditPayload(value);
}

test('the previous key opens old records only after the current key fails', () => {
  const old = sealedWith(keyA);
  useKeys(keyB, keyA);
  assert.deepEqual(openAuditPayload(old), secretNote);
  assert.equal(classifyAuditPayload(old), 'previous');

  useKeys(keyB);
  assert.throws(() => openAuditPayload(old));
  assert.equal(classifyAuditPayload(old), 'unreadable');
});

test('the previous key is never used to encrypt', () => {
  useKeys(keyB, keyA);
  const fresh = sealAuditPayload(secretNote);
  assert.ok(isSealedAuditPayload(fresh));
  assert.equal(classifyAuditPayload(fresh), 'current');
  useKeys(keyA);
  assert.equal(classifyAuditPayload(fresh), 'unreadable', 'the old key must not open a new record');
});

test('plaintext records stay readable with or without keys', () => {
  useKeys(keyB, keyA);
  assert.deepEqual(openAuditPayload(secretNote), secretNote);
  assert.equal(classifyAuditPayload(secretNote), 'plaintext');
});

test('/health status: enabled, disabled and invalid, never a key value', () => {
  assert.equal(auditEncryptionStatus(), 'disabled');
  useKeys(keyB);
  assert.equal(auditEncryptionStatus(), 'enabled');
  useKeys(keyB, keyA);
  assert.equal(auditEncryptionStatus(), 'enabled');
  useKeys('not-a-key');
  assert.equal(auditEncryptionStatus(), 'invalid');
  useKeys(keyB, 'not-a-key');
  assert.equal(auditEncryptionStatus(), 'invalid');
  useKeys(undefined, keyA);
  assert.equal(auditEncryptionStatus(), 'invalid');
  for (const value of ['disabled', 'enabled', 'invalid']) assert.ok(!value.includes(keyA));
});

function seedStore(): MemoryRotationStore {
  const store = new MemoryRotationStore();
  const sealedA = (n: number) => sealedWith(keyA, { ...secretNote, n });
  const sealedB = (n: number) => sealedWith(keyB, { ...secretNote, n });
  store.rows.investigations = [
    { key: 'inv-1', payload: sealedA(1) },
    { key: 'inv-2', payload: sealedB(2) },
    { key: 'inv-3', payload: { ...secretNote, n: 3 } },
    { key: 'inv-4', payload: sealedWith(keyC, { ...secretNote, n: 4 }) },
    { key: 'inv-5', payload: sealedA(5) },
  ];
  store.rows.payment_events = [
    { key: 1, payload: sealedA(11) },
    { key: 2, payload: sealedA(12) },
    { key: 3, payload: sealedB(13) },
  ];
  useKeys(keyB, keyA);
  return store;
}

const snapshot = (store: MemoryRotationStore): string => JSON.stringify(store.rows);

test('a dry run counts and writes nothing', async () => {
  const store = seedStore();
  const before = snapshot(store);
  const report = await rotateAuditEncryption(store, { batchSize: 2 });
  assert.equal(report.applied, false);
  assert.deepEqual(report.tables.investigations, {
    scanned: 5,
    plaintext: 1,
    alreadyCurrent: 1,
    rotated: 2,
    sealedPlaintext: 0,
    unreadable: 1,
  });
  assert.equal(report.tables.payment_events.rotated, 2);
  assert.equal(snapshot(store), before, 'no row may change in a dry run');
});

test('the report holds counts only, no data, ids or keys', async () => {
  const store = seedStore();
  const text = JSON.stringify(await rotateAuditEncryption(store));
  for (const forbidden of ['distinctive-audit-text', 'inv-1', keyA, keyB, keyC]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('--apply re-encrypts old rows under the current key and leaves the rest alone', async () => {
  const store = seedStore();
  const plaintextBefore = JSON.stringify(store.rows.investigations[2]);
  const unreadableBefore = JSON.stringify(store.rows.investigations[3]);
  const report = await rotateAuditEncryption(store, { apply: true, batchSize: 2 });
  assert.equal(report.tables.investigations.rotated, 2);
  assert.equal(report.tables.payment_events.rotated, 2);

  const classes = store.rows.investigations.map((row) => classifyAuditPayload(row.payload));
  assert.deepEqual(classes, ['current', 'current', 'plaintext', 'unreadable', 'current']);
  assert.equal(JSON.stringify(store.rows.investigations[2]), plaintextBefore);
  assert.equal(JSON.stringify(store.rows.investigations[3]), unreadableBefore);
  assert.deepEqual(openAuditPayload(store.rows.investigations[0].payload), { ...secretNote, n: 1 });

  // With the old key gone, everything that was rotated still opens.
  useKeys(keyB);
  assert.deepEqual(openAuditPayload(store.rows.payment_events[0].payload), { ...secretNote, n: 11 });
});

test('re-running changes nothing more', async () => {
  const store = seedStore();
  await rotateAuditEncryption(store, { apply: true });
  const after = snapshot(store);
  const again = await rotateAuditEncryption(store, { apply: true });
  assert.equal(again.tables.investigations.rotated, 0);
  assert.equal(again.tables.payment_events.rotated, 0);
  assert.equal(snapshot(store), after);
});

test('plaintext rows are sealed only when asked', async () => {
  const store = seedStore();
  const report = await rotateAuditEncryption(store, { apply: true, includePlaintext: true });
  assert.equal(report.tables.investigations.sealedPlaintext, 1);
  assert.equal(classifyAuditPayload(store.rows.investigations[2].payload), 'current');
  assert.deepEqual(openAuditPayload(store.rows.investigations[2].payload), { ...secretNote, n: 3 });
});

test('work is split into one short transaction per batch', async () => {
  const store = seedStore();
  await rotateAuditEncryption(store, { apply: true, batchSize: 2 });
  // investigations: 5 rows -> 3 batches; payment_events: 3 rows -> 2 batches.
  assert.equal(store.commits, 5);
});

test('a failure rolls back the open batch and keeps earlier batches', async () => {
  class Failing extends MemoryRotationStore {
    private writes = 0;
    override async write(table: RotationTable, key: string | number, payload: unknown): Promise<void> {
      this.writes += 1;
      if (this.writes === 2) throw new Error('disk full');
      return super.write(table, key, payload);
    }
  }
  const store = new Failing();
  const seeded = seedStore();
  store.rows.investigations = seeded.rows.investigations;
  store.rows.payment_events = seeded.rows.payment_events;
  await assert.rejects(rotateAuditEncryption(store, { apply: true, batchSize: 1 }), /disk full/);
  // Batch 1 (inv-1) committed; the batch holding the failed write did not change.
  assert.equal(classifyAuditPayload(store.rows.investigations[0].payload), 'current');
  assert.equal(classifyAuditPayload(store.rows.investigations[4].payload), 'previous');
});

test('it refuses to write unencrypted data when no current key is set', async () => {
  const store = seedStore();
  useKeys(undefined, keyA);
  await assert.rejects(rotateAuditEncryption(store, { apply: true }), /Refusing to write/);
  assert.equal(classifyAuditPayload(store.rows.investigations[0].payload), 'previous');
});

// --- PostgreSQL adapter against a mock pool -----------------------------------------------------

interface Logged {
  text: string;
  params?: unknown[];
}

function mockPool(rows: Record<RotationTable, RotationRow[]>) {
  const log: Logged[] = [];
  let released = 0;
  const client: QueryClientLike = {
    async query(text, params) {
      log.push({ text, params });
      const select = /FROM (investigations|payment_events)/.exec(text);
      if (select) {
        const table = select[1] as RotationTable;
        const [limit, after] = params as [number, (string | number | undefined)?];
        const page = rows[table].filter((row) => after === undefined || row.key > after).slice(0, limit);
        return { rows: page.map((row) => ({ key: row.key, payload: row.payload })) };
      }
      return { rows: [] };
    },
    release() {
      released += 1;
    },
  };
  return { pool: { connect: async () => client }, log, released: () => released };
}

test('the PostgreSQL adapter uses one transaction per batch, locks only when applying', async () => {
  const rows = seedStore().rows;
  const dry = mockPool(rows);
  await rotateAuditEncryption(new PgRotationStore(dry.pool, { lock: false }), { batchSize: 10 });
  assert.ok(dry.log.some((entry) => entry.text === 'BEGIN READ ONLY'));
  assert.equal(dry.log.some((entry) => entry.text.startsWith('UPDATE')), false, 'a dry run must not update');
  assert.equal(dry.log.some((entry) => entry.text.includes('FOR UPDATE')), false);

  const live = mockPool(rows);
  await rotateAuditEncryption(new PgRotationStore(live.pool, { lock: true }), { apply: true, batchSize: 10 });
  const texts = live.log.map((entry) => entry.text);
  assert.ok(texts.includes('BEGIN'));
  assert.ok(texts.includes('COMMIT'));
  assert.ok(texts.some((text) => text.includes('FOR UPDATE')));
  const updates = live.log.filter((entry) => entry.text.startsWith('UPDATE'));
  assert.equal(updates.length, 4, 'two investigations and two events were sealed with the old key');
  for (const update of updates) {
    const written = JSON.parse(String(update.params?.[0])) as unknown;
    assert.equal(classifyAuditPayload(written), 'current');
  }
  assert.equal(live.released(), texts.filter((text) => text === 'COMMIT').length);
});

test('the PostgreSQL adapter rolls back and releases the client on failure', async () => {
  const rows = seedStore().rows;
  const pooled = mockPool(rows);
  const failingPool = {
    connect: async () => {
      const client = await pooled.pool.connect();
      return {
        ...client,
        async query(text: string, params?: unknown[]) {
          if (text.startsWith('UPDATE')) throw new Error('write failed');
          return client.query(text, params);
        },
        release: client.release,
      };
    },
  };
  await assert.rejects(rotateAuditEncryption(new PgRotationStore(failingPool), { apply: true }), /write failed/);
  assert.ok(pooled.log.some((entry) => entry.text === 'ROLLBACK'));
  assert.ok(pooled.released() >= 1);
});
