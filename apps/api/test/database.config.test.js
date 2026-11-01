import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPoolConfig, createPool, closeDatabase, setPool } from '../src/database/connection.js';

test('database configuration returns null when DATABASE_URL is not set', () => {
  const config = buildPoolConfig({ databaseUrl: '' });
  assert.equal(config, null);
});

test('database configuration parses custom connection parameters correctly', () => {
  const config = buildPoolConfig({
    databaseUrl: 'postgresql://testuser:testpass@localhost:5432/testdb',
    databaseSsl: true,
    databaseTimeoutMs: 5000,
    databaseMaxConnections: 20,
  });

  assert.equal(config.connectionString, 'postgresql://testuser:testpass@localhost:5432/testdb');
  assert.deepEqual(config.ssl, { rejectUnauthorized: false });
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.max, 20);
});

test('createPool returns null when no DATABASE_URL is provided', () => {
  const pool = createPool({ databaseUrl: '' });
  assert.equal(pool, null);
});

test('createPool instantiates a Pool object with error handler when config is valid', async () => {
  const pool = createPool({
    databaseUrl: 'postgresql://postgres:postgres@localhost:5432/mockdb',
    databaseTimeoutMs: 1000,
  });

  assert.ok(pool);
  assert.equal(typeof pool.query, 'function');
  assert.equal(typeof pool.connect, 'function');
  assert.equal(typeof pool.end, 'function');

  // Verify pool error listener was attached
  assert.ok(pool.listenerCount('error') >= 1);

  await pool.end();
});

test('closeDatabase gracefully drains and resets active pool', async () => {
  const fakePool = {
    ended: false,
    async end() {
      this.ended = true;
    },
  };

  setPool(fakePool);
  await closeDatabase();
  assert.equal(fakePool.ended, true);
});

