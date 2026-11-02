import pg from 'pg';
import { env, type EnvConfig } from '../config/env.js';

const { Pool } = pg;

export type DatabaseConfigOverrides = Partial<Pick<EnvConfig, 'databaseUrl' | 'databaseSsl' | 'databaseTimeoutMs' | 'databaseMaxConnections'>>;

let pool: pg.Pool | null = null;

export function buildPoolConfig(overrideConfig: DatabaseConfigOverrides = {}): pg.PoolConfig | null {
  const databaseUrl = overrideConfig.databaseUrl !== undefined ? overrideConfig.databaseUrl : env.databaseUrl;
  const databaseSsl = overrideConfig.databaseSsl !== undefined ? overrideConfig.databaseSsl : env.databaseSsl;
  const databaseTimeoutMs = overrideConfig.databaseTimeoutMs !== undefined ? overrideConfig.databaseTimeoutMs : env.databaseTimeoutMs;
  const databaseMaxConnections = overrideConfig.databaseMaxConnections !== undefined ? overrideConfig.databaseMaxConnections : env.databaseMaxConnections;

  if (!databaseUrl) {
    return null;
  }

  return {
    connectionString: databaseUrl,
    ssl: databaseSsl ? { rejectUnauthorized: false } : undefined,
    max: databaseMaxConnections || 10,
    connectionTimeoutMillis: databaseTimeoutMs || 2000,
    idleTimeoutMillis: 30000,
  };
}

export function createPool(overrideConfig: DatabaseConfigOverrides = {}): pg.Pool | null {
  const config = buildPoolConfig(overrideConfig);
  if (!config) {
    return null;
  }

  const newPool = new Pool(config);
  newPool.on('error', (err: Error) => {
    console.error('Unexpected PostgreSQL client error on idle connection:', err.message);
  });

  return newPool;
}

export function getPool(): pg.Pool | null {
  if (pool) {
    return pool;
  }

  if (!env.databaseUrl) {
    return null;
  }

  pool = createPool();
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('Database connection is not configured');
  }
  return activePool.query<T>(text, params);
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    const activePool = pool;
    pool = null;
    await activePool.end();
  }
}

export function setPool(newPool: pg.Pool | null): void {
  pool = newPool;
}
