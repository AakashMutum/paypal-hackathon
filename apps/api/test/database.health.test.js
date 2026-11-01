import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { checkDatabase } from '../src/database/health.js';
import { setPool } from '../src/database/connection.js';
import { createApp } from '../src/app.js';

test('checkDatabase returns not_configured when no pool is available', async () => {
  const result = await checkDatabase(null);
  assert.deepEqual(result, { status: 'not_configured' });
});

test('checkDatabase returns healthy when connection query succeeds', async () => {
  const mockPool = {
    async connect() {
      return {
        async query(sql) {
          assert.equal(sql, 'SELECT 1 AS health_check');
          return { rows: [{ health_check: 1 }] };
        },
        release() {},
      };
    },
  };

  const result = await checkDatabase(mockPool);
  assert.deepEqual(result, { status: 'healthy' });
});

test('checkDatabase returns unhealthy and masks sensitive details on error', async () => {
  const mockPool = {
    async connect() {
      throw new Error('password authentication failed for user "postgres_secret_password" at 10.0.0.1:5432');
    },
  };

  const result = await checkDatabase(mockPool);
  assert.equal(result.status, 'unhealthy');
  assert.equal(result.error, 'Database connection unavailable');
  // Security test: Verify sensitive details are not leaked
  assert.equal(JSON.stringify(result).includes('postgres_secret_password'), false);
  assert.equal(JSON.stringify(result).includes('10.0.0.1'), false);
});

test('Express GET /health returns 503 degraded status when database is unhealthy', async () => {
  const mockUnhealthyPool = {
    async connect() {
      throw new Error('TCP connection refused on port 5432');
    },
  };

  setPool(mockUnhealthyPool);
  const app = createApp();

  try {
    const response = await request(app).get('/health');
    assert.equal(response.status, 503);
    assert.equal(response.body.data.status, 'degraded');
    assert.equal(response.body.data.database.status, 'unhealthy');
    assert.equal(response.body.data.database.error, 'Database connection unavailable');
  } finally {
    setPool(null);
  }
});
