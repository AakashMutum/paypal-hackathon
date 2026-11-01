import { getPool, closeDatabase } from './connection.js';

export { getPool, closeDatabase };

export async function checkDatabase(poolInstance) {
  const activePool = poolInstance || getPool();
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
    // Log the actual diagnostic error internally for operators
    console.error('Database connectivity check failed:', error.message);
    // Never expose database credentials, host, or SQL errors to public consumers
    return {
      status: 'unhealthy',
      error: 'Database connection unavailable',
    };
  }
}
