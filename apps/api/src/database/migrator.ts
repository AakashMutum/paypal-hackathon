import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveMigrationsDir(): string {
  const localDir = path.join(__dirname, 'migrations');
  if (fs.existsSync(localDir)) {
    return localDir;
  }
  const sourceDir = path.join(__dirname, '../../src/database/migrations');
  if (fs.existsSync(sourceDir)) {
    return sourceDir;
  }
  return localDir;
}

const MIGRATIONS_DIR = resolveMigrationsDir();

export interface MigrationRecord {
  name: string;
  applied_at: Date;
}

export interface MigrationStatusItem {
  name: string;
  applied: boolean;
  appliedAt: Date | null;
}

export interface MigrationApplyResult {
  applied: string[];
  pendingCount: number;
  totalCount: number;
}

export interface QueryableClient {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    queryTextOrConfig: string | pg.QueryConfig<unknown[]>,
    values?: unknown[]
  ): Promise<pg.QueryResult<R>>;
  release(): void;
}

export interface ConnectablePool {
  connect(): Promise<QueryableClient>;
}

export async function ensureMigrationsTable(client: Pick<QueryableClient, 'query'>): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function getMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export async function getMigrationStatus(pool: ConnectablePool): Promise<MigrationStatusItem[]> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query<MigrationRecord>(
      'SELECT name, applied_at FROM schema_migrations ORDER BY id ASC'
    );
    const appliedMap = new Map<string, Date>(rows.map((r) => [r.name, r.applied_at]));

    const files = getMigrationFiles();
    return files.map((file) => ({
      name: file,
      applied: appliedMap.has(file),
      appliedAt: appliedMap.get(file) || null,
    }));
  } finally {
    client.release();
  }
}

export async function applyMigrations(
  pool: ConnectablePool,
  dir: string = MIGRATIONS_DIR
): Promise<MigrationApplyResult> {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    const { rows } = await client.query<Pick<MigrationRecord, 'name'>>(
      'SELECT name FROM schema_migrations'
    );
    const appliedSet = new Set<string>(rows.map((r) => r.name));

    const files = getMigrationFiles(dir);
    const pendingFiles = files.filter((f) => !appliedSet.has(f));

    const applied: string[] = [];

    for (const file of pendingFiles) {
      const filePath = path.join(dir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.info(`Applying migration: ${file}...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        console.info(`Successfully applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Migration failed on ${file}:`, message);
        throw new Error(`Migration ${file} failed: ${message}`);
      }
    }

    return {
      applied,
      pendingCount: 0,
      totalCount: files.length,
    };
  } finally {
    client.release();
  }
}
