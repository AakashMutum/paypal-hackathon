import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

export async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function getMigrationFiles(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export async function getMigrationStatus(pool) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const { rows } = await client.query('SELECT name, applied_at FROM schema_migrations ORDER BY id ASC');
    const appliedMap = new Map(rows.map((r) => [r.name, r.applied_at]));

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

export async function applyMigrations(pool, dir = MIGRATIONS_DIR) {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const appliedSet = new Set(rows.map((r) => r.name));

    const files = getMigrationFiles(dir);
    const pendingFiles = files.filter((f) => !appliedSet.has(f));

    const applied = [];

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
        console.error(`Migration failed on ${file}:`, err.message);
        throw new Error(`Migration ${file} failed: ${err.message}`);
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

