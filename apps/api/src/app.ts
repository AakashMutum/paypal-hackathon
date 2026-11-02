import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRouter } from './routes/health.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { getHealth } from './controllers/health.controller.js';

export function createApp(): Application {
  const app: Application = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimit({
    windowMs: env.rateLimitWindowMs,
    limit: env.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  }));
  app.use(requestLogger);

  app.get('/health', getHealth);
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/orders', orderRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
