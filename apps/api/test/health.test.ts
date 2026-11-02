import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setDatabaseUrl } from '../src/config/env.js';
import { setPool, closeDatabase } from '../src/database/connection.js';
import type { HealthData, ApiErrorDetail } from '@checkout-guardian/contracts';

after(async () => {
  await closeDatabase();
});

/**
 * The health endpoint test asserts the `not_configured` database state.
 * However, `dotenv.config()` in env.ts loads DATABASE_URL from the
 * developer's root `.env` file, which would cause the health check to
 * report `healthy`. To isolate this test from the local environment we
 * clear the URL and reset the cached pool inside the test, then restore
 * the original value afterwards so subsequent tests and a real server
 * start see the developer's configured value.
 */
test('GET /health reports the API is operational without falsely claiming database health', async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL || '';
  try {
    setDatabaseUrl('');
    setPool(null);
    const app = createApp();

    const response = await request(app).get('/health');
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    const data = response.body.data as HealthData;
    assert.equal(data.status, 'ok');
    assert.equal(data.database.status, 'not_configured');
  } finally {
    setDatabaseUrl(originalDatabaseUrl);
    setPool(null);
  }
});

test('GET /api/v1/health exposes the same versioned health contract', async () => {
  const app = createApp();
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  const data = response.body.data as HealthData;
  assert.equal(data.service, 'checkout-guardian-api');
});

test('unknown routes return a safe structured error', async () => {
  const app = createApp();
  const response = await request(app).get('/not-a-route');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  const error = response.body.error as ApiErrorDetail;
  assert.equal(error.code, 'NOT_FOUND');
});