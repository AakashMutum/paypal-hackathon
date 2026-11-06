/**
 * Re-encrypts stored audit payloads under AUDIT_ENCRYPTION_KEY. Run from the repository root:
 *
 *   npm run audit:rotate                  dry run: prints counts only
 *   npm run audit:rotate -- --apply       writes
 *   npm run audit:rotate -- --apply --include-plaintext
 *
 * Needs DATABASE_URL, AUDIT_ENCRYPTION_KEY and, for rows sealed with the old key,
 * AUDIT_ENCRYPTION_KEY_PREVIOUS. It prints counts only, never row data or key values, and it is
 * safe to re-run. See docs/key-rotation.md.
 */
import { auditEncryptionStatus } from '../src/services/persistence/auditPrivacy.js';
import { PgRotationStore, rotateAuditEncryption, ROTATION_TABLES } from '../src/services/persistence/auditRotation.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const includePlaintext = args.includes('--include-plaintext');
const batchFlag = args.indexOf('--batch-size');
const batchSize = batchFlag >= 0 ? Number(args[batchFlag + 1]) : 50;

if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  console.error('--batch-size must be a whole number from 1 to 500.');
  process.exit(2);
}

const status = auditEncryptionStatus();
if (status !== 'enabled') {
  console.error(
    `Audit encryption is ${status}. Set a valid AUDIT_ENCRYPTION_KEY (and a valid AUDIT_ENCRYPTION_KEY_PREVIOUS if you set one). Nothing was changed.`,
  );
  process.exit(2);
}

const { getPool, closeDatabase } = await import('../src/database/connection.js');
const pool = getPool();
if (!pool) {
  console.error('DATABASE_URL is not configured. In-memory data is never persisted, so there is nothing to rotate.');
  process.exit(2);
}

if (process.env.AUDIT_ENCRYPTION_KEY_PREVIOUS?.trim() && !process.env.AUDIT_HMAC_KEY?.trim()) {
  console.warn(
    'Warning: AUDIT_HMAC_KEY is not set, so payee-email fingerprints are derived from the encryption key and will change with it. Read docs/key-rotation.md before applying.',
  );
}

try {
  const report = await rotateAuditEncryption(new PgRotationStore(pool, { lock: apply }), {
    apply,
    includePlaintext,
    batchSize,
  });
  console.info(apply ? 'Rotation applied. Counts only:' : 'Dry run (nothing written). Counts only:');
  console.table(
    ROTATION_TABLES.map((table) => ({
      table,
      scanned: report.tables[table].scanned,
      [apply ? 'rotated' : 'would rotate']: report.tables[table].rotated,
      'already current': report.tables[table].alreadyCurrent,
      plaintext: report.tables[table].plaintext,
      [apply ? 'plaintext sealed' : 'plaintext would seal']: report.tables[table].sealedPlaintext,
      unreadable: report.tables[table].unreadable,
    })),
  );
  const unreadable = ROTATION_TABLES.reduce((sum, table) => sum + report.tables[table].unreadable, 0);
  if (unreadable > 0) {
    console.error(`${unreadable} row(s) cannot be opened with either key. They were not modified. Keep the old keys.`);
    process.exitCode = 1;
  }
  if (!apply) console.info('Run again with --apply to write.');
} catch (error) {
  // Only the error class and message; database errors do not contain row data.
  console.error(`Rotation failed and the current batch was rolled back: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
