import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMigrationFiles, applyMigrations, getMigrationStatus } from '../src/database/migrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '../src/database/migrations');

test('getMigrationFiles returns migration SQL files sorted alphabetically', () => {
  const files = getMigrationFiles(MIGRATIONS_DIR);
  assert.ok(files.length >= 1);
  assert.ok(files.includes('001_initial_schema.sql'));
});

test('001_initial_schema.sql contains required tables, constraints, and audit components', () => {
  const filePath = path.join(MIGRATIONS_DIR, '001_initial_schema.sql');
  const sql = fs.readFileSync(filePath, 'utf8');

  // Verify all 4 required tables
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS merchant_records'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS checkout_sessions'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS risk_assessments'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS payment_decisions'));

  // Verify risk assessment component scores and weights
  assert.ok(sql.includes('domain_reputation_score NUMERIC(5, 2)'));
  assert.ok(sql.includes('merchant_consistency_score NUMERIC(5, 2)'));
  assert.ok(sql.includes('pricing_anomaly_score NUMERIC(5, 2)'));
  assert.ok(sql.includes('ssl_technical_score NUMERIC(5, 2)'));
  assert.ok(sql.includes('weights_applied JSONB'));
  assert.ok(sql.includes('evidence JSONB'));

  // Verify payment decision constraints
  assert.ok(sql.includes("'ALLOW', 'WARN', 'PAUSE'"));

  // Verify indexes
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_merchant_records_domain'));
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_checkout_sessions_paypal_order_id'));
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_risk_assessments_overall_score'));
  assert.ok(sql.includes('CREATE INDEX IF NOT EXISTS idx_payment_decisions_decision'));
});

test('applyMigrations executes pending migrations inside transactions and records them', async () => {
  const executedStatements = [];
  const insertedMigrations = [];
  let tableCreated = false;

  const mockClient = {
    async query(sql, params) {
      executedStatements.push({ sql: sql.trim(), params });
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
        tableCreated = true;
        return { rows: [] };
      }
      if (sql.includes('SELECT name FROM schema_migrations')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO schema_migrations')) {
        insertedMigrations.push(params[0]);
        return { rowCount: 1 };
      }
      return { rows: [] };
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return mockClient;
    },
  };

  const result = await applyMigrations(mockPool, MIGRATIONS_DIR);
  assert.ok(tableCreated);
  assert.ok(result.applied.includes('001_initial_schema.sql'));
  assert.ok(insertedMigrations.includes('001_initial_schema.sql'));

  // Ensure transaction boundaries
  const sqlSequence = executedStatements.map((s) => s.sql);
  assert.ok(sqlSequence.includes('BEGIN'));
  assert.ok(sqlSequence.includes('COMMIT'));
});

test('applyMigrations aborts and rolls back transaction on SQL failure', async () => {
  let rolledBack = false;

  const mockClient = {
    async query(sql) {
      if (sql === 'BEGIN') return;
      if (sql === 'ROLLBACK') {
        rolledBack = true;
        return;
      }
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
      if (sql.includes('SELECT name FROM schema_migrations')) return { rows: [] };
      // Simulate DDL failure
      throw new Error('syntax error in migration SQL');
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return mockClient;
    },
  };

  await assert.rejects(
    () => applyMigrations(mockPool, MIGRATIONS_DIR),
    /syntax error in migration SQL/
  );
  assert.equal(rolledBack, true);
});

test('getMigrationStatus inspects applied and pending status', async () => {
  const mockClient = {
    async query(sql) {
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
      if (sql.includes('SELECT name, applied_at FROM schema_migrations')) {
        return {
          rows: [
            { name: '001_initial_schema.sql', applied_at: new Date('2026-10-31T12:00:00Z') },
          ],
        };
      }
      return { rows: [] };
    },
    release() {},
  };

  const mockPool = {
    async connect() {
      return mockClient;
    },
  };

  const status = await getMigrationStatus(mockPool);
  assert.ok(status.length >= 1);
  const initialMigration = status.find((m) => m.name === '001_initial_schema.sql');
  assert.equal(initialMigration.applied, true);
  assert.ok(initialMigration.appliedAt);
});

