import type { Request, Response, NextFunction } from 'express';
import { successResponse, type HealthData, type HealthMeta } from '@checkout-guardian/contracts';
import { checkDatabase } from '../database/health.js';
import { getModes } from '../services/modes.service.js';

export async function getHealth(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const database = await checkDatabase();
    const isHealthy = database.status === 'healthy' || database.status === 'not_configured';
    const healthData: HealthData = {
      status: isHealthy ? 'ok' : 'degraded',
      service: 'checkout-guardian-api',
      version: '0.1.0',
      database,
      modes: { ...(await getModes()) },
    };
    const healthMeta: HealthMeta = {
      timestamp: new Date().toISOString(),
    };
    res.status(isHealthy ? 200 : 503).json(successResponse(healthData, healthMeta));
  } catch (error) {
    next(error);
  }
}
