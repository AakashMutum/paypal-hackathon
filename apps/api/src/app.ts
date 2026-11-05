import express, { type Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { healthRouter } from './routes/health.routes.js';
import { orderRouter } from './routes/order.routes.js';
import { frontendApiRouter } from './routes/frontendApi.routes.js';
import { agentBridgeRouter } from './routes/agentBridge.routes.js';
import { getHealth } from './controllers/health.controller.js';

export function createApp(): Application {
  const app: Application = express();

  app.disable('x-powered-by');
  app.use(helmet());
  const corsOrigins = env.corsOrigin
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
  allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'x-order-token', 'x-demo-token', 'authorization'],
  exposedHeaders: ['Content-Type'],
  optionsSuccessStatus: 204,
}));
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
  app.use('/api/v1', agentBridgeRouter);
  app.use('/api', frontendApiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
