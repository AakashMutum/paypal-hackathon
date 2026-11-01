import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;
let pool = null;

export function buildPoolConfig(overrideConfig = {}) {
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

export function createPool(overrideConfig = {}) {
  const config = buildPoolConfig(overrideConfig);
  if (!config) {
    return null;
  }

  const newPool = new Pool(config);
  newPool.on('error', (err) => {
    console.error('Unexpected PostgreSQL client error on idle connection:', err.message);
  });

  return newPool;
}

export function getPool() {
  if (pool) {
    return pool;
  }

  if (!env.databaseUrl) {
    return null;
  }

  pool = createPool();
  return pool;
}

export async function query(text, params = []) {
  const activePool = getPool();
  if (!activePool) {
    throw new Error('Database connection is not configured');
  }
  return activePool.query(text, params);
}

export async function closeDatabase() {
  if (pool) {
    const activePool = pool;
    pool = null;
    await activePool.end();
  }
}

export function setPool(newPool) {
  pool = newPool;
}
