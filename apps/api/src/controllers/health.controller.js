import { successResponse } from '@checkout-guardian/contracts';
import { checkDatabase } from '../database/health.js';

export async function getHealth(_req, res, next) {
  try {
    const database = await checkDatabase();
    const isHealthy = database.status === 'healthy' || database.status === 'not_configured';
    res.status(isHealthy ? 200 : 503).json(successResponse({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'checkout-guardian-api',
      version: '0.1.0',
      database
    }, { timestamp: new Date().toISOString() }));
  } catch (error) {
    next(error);
  }
}
