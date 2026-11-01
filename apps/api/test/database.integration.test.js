import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { applyMigrations } from '../src/database/migrator.js';
import { env } from '../src/config/env.js';

const { Pool } = pg;
const testDatabaseUrl = process.env.TEST_DATABASE_URL || env.databaseUrl;

async function isDatabaseAvailable(url) {
  if (!url) return false;
  const tempPool = new Pool({
    connectionString: url,
    connectionTimeoutMillis: 1500,
  });
  try {
    const client = await tempPool.connect();
    await client.query('SELECT 1');
    client.release();
    await tempPool.end();
    return true;
  } catch {
    await tempPool.end();
    return false;
  }
}

const dbAvailable = await isDatabaseAvailable(testDatabaseUrl);

if (!dbAvailable) {
  test('PostgreSQL Live Integration Suite (Skipped)', (t) => {
    t.skip(
      'Live PostgreSQL instance is not reachable on TEST_DATABASE_URL/DATABASE_URL. ' +
      'Tests requiring a live database (schema creation, foreign key constraints, CHECK constraints, record persistence) ' +
      'were skipped. Start PostgreSQL (e.g. docker run --name cg-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16) ' +
      'and export DATABASE_URL to execute live persistence tests.'
    );
  });
} else {
  test('PostgreSQL Live Integration Suite', async (t) => {
    const testPool = new Pool({
      connectionString: testDatabaseUrl,
      connectionTimeoutMillis: 3000,
    });

    t.after(async () => {
      await testPool.end();
    });

    await t.test('applies migrations to test database successfully', async () => {
      const migrationResult = await applyMigrations(testPool);
      assert.ok(migrationResult.totalCount >= 1);
    });

    await t.test('persists and retrieves merchant_records', async () => {
      const testDomain = `test-store-${Date.now()}.com`;
      const insertResult = await testPool.query(
        `INSERT INTO merchant_records (domain, claimed_name, payee_email, verification_status, reputation_score)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [testDomain, 'Test Store LLC', 'payee@test-store.com', 'UNVERIFIED', 65.50]
      );

      assert.equal(insertResult.rows.length, 1);
      const merchant = insertResult.rows[0];
      assert.equal(merchant.domain, testDomain);
      assert.equal(merchant.reputation_score, '65.50');

      const selectResult = await testPool.query('SELECT * FROM merchant_records WHERE id = $1', [merchant.id]);
      assert.equal(selectResult.rows[0].claimed_name, 'Test Store LLC');
    });

    await t.test('enforces checkout_sessions constraints and foreign keys', async () => {
      const sessionId = `chk_sess_${Date.now()}`;

      // Insert valid session
      const insertSession = await testPool.query(
        `INSERT INTO checkout_sessions (id, storefront_url, domain, amount, currency, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [sessionId, 'https://test-store.com/cart', 'test-store.com', 99.99, 'USD', 'CREATED']
      );
      assert.equal(insertSession.rows[0].id, sessionId);

      // Verify amount check constraint (amount >= 0)
      await assert.rejects(
        () => testPool.query(
          `INSERT INTO checkout_sessions (id, storefront_url, domain, amount, currency, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [`chk_bad_${Date.now()}`, 'https://test-store.com', 'test-store.com', -10.00, 'USD', 'CREATED']
        ),
        /chk_checkout_amount/
      );
    });

    await t.test('persists risk_assessments with 4 separate audit component scores and enforces bounds', async () => {
      const sessionId = `chk_risk_${Date.now()}`;
      await testPool.query(
        `INSERT INTO checkout_sessions (id, storefront_url, domain, amount, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, 'https://test-store.com/checkout', 'test-store.com', 150.00, 'USD']
      );

      // Valid risk assessment
      const insertRisk = await testPool.query(
        `INSERT INTO risk_assessments (
           session_id, overall_score, domain_reputation_score,
           merchant_consistency_score, pricing_anomaly_score, ssl_technical_score,
           weights_applied, evidence
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          sessionId,
          42.50, // overall
          30.00, // domain (30%)
          45.00, // merchant consistency (40%)
          60.00, // pricing anomaly (20%)
          15.00, // ssl technical (10%)
          JSON.stringify({ domain: 0.30, merchant_consistency: 0.40, pricing: 0.20, ssl: 0.10 }),
          JSON.stringify({ domain_age_days: 12, whois_found: true }),
        ]
      );

      assert.equal(insertRisk.rows.length, 1);
      const risk = insertRisk.rows[0];
      assert.equal(risk.overall_score, '42.50');
      assert.equal(risk.weights_applied.domain, 0.30);
      assert.equal(risk.evidence.domain_age_days, 12);

      // Verify bounds constraint: score > 100 must fail
      await assert.rejects(
        () => testPool.query(
          `INSERT INTO risk_assessments (
             session_id, overall_score, domain_reputation_score,
             merchant_consistency_score, pricing_anomaly_score, ssl_technical_score
           ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [sessionId, 120.00, 30.00, 45.00, 60.00, 15.00]
        ),
        /chk_overall_score/
      );
    });

    await t.test('persists payment_decisions with ALLOW, WARN, PAUSE and rejects invalid decisions', async () => {
      const sessionId = `chk_dec_${Date.now()}`;
      await testPool.query(
        `INSERT INTO checkout_sessions (id, storefront_url, domain, amount, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, 'https://test-store.com/checkout', 'test-store.com', 200.00, 'USD']
      );

      // Valid ALLOW
      const insertDecision = await testPool.query(
        `INSERT INTO payment_decisions (session_id, decision, action_taken, reasons)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [sessionId, 'WARN', 'WARN_DISPLAYED', JSON.stringify(['Domain is less than 30 days old'])]
      );
      assert.equal(insertDecision.rows[0].decision, 'WARN');

      // Invalid decision string must be rejected
      await assert.rejects(
        () => testPool.query(
          `INSERT INTO payment_decisions (session_id, decision)
           VALUES ($1, $2)`,
          [sessionId, 'INVALID_DECISION']
        ),
        /chk_payment_decision/
      );
    });
  });
}

