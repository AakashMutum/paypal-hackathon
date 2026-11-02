import { getPool, closeDatabase } from './connection.js';
import { applyMigrations, getMigrationStatus } from './migrator.js';

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const isStatus = args.includes('--status');

  const pool = getPool();
  if (!pool) {
    console.error('Error: DATABASE_URL is not configured in environment.');
    process.exit(1);
  }

  try {
    if (isStatus) {
      console.info('Checking database migration status...');
      const status = await getMigrationStatus(pool);
      console.table(status.map((m) => ({
        Migration: m.name,
        Status: m.applied ? 'APPLIED' : 'PENDING',
        AppliedAt: m.appliedAt ? new Date(m.appliedAt).toISOString() : '-',
      })));
    } else {
      console.info('Executing database migrations...');
      const result = await applyMigrations(pool);
      if (result.applied.length === 0) {
        console.info('Database schema is already up to date. No pending migrations.');
      } else {
        console.info(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Migration execution failed:', message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  run();
}
