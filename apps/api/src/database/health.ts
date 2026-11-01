import type pg from 'pg';
import { getPool, closeDatabase } from './connection.js';
import type { DatabaseHealthInfo } from '@checkout-guardian/contracts';

export { getPool, closeDatabase };

export type CheckDatabaseResult = DatabaseHealthInfo;

export async function checkDatabase(poolInstance?: pg.Pool | null): Promise<CheckDatabaseResult> {
  const activePool = poolInstance !== undefined ? poolInstance : getPool();
  if (!activePool) {
    return { status: 'not_configured' };
  }

  try {
    const client = await activePool.connect();
    try {
      await client.query('SELECT 1 AS health_check');
      return { status: 'healthy' };
    } finally {
      client.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Database connectivity check failed:', message);
    return {
      status: 'unhealthy',
      error: 'Database connection unavailable',
    };
  }
}
