import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

test('GET /health reports the API is operational without falsely claiming database health', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.status, 'ok');
  assert.equal(response.body.data.database.status, 'not_configured');
});

test('GET /api/v1/health exposes the same versioned health contract', async () => {
  const response = await request(app).get('/api/v1/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.data.service, 'checkout-guardian-api');
});

test('unknown routes return a safe structured error', async () => {
  const response = await request(app).get('/not-a-route');
  assert.equal(response.status, 404);
  assert.equal(response.body.success, false);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});
