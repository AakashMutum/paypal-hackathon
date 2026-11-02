import type { Request, Response, NextFunction } from 'express';
import { errorResponse } from '@checkout-guardian/contracts';

export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  expose?: boolean;
}

export function notFoundHandler(req: Request, res: Response, _next: NextFunction): void {
  res.status(404).json(errorResponse('NOT_FOUND', `Cannot ${req.method} ${req.originalUrl || req.url}`));
}

export function errorHandler(
  err: HttpError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');
  const message = err.expose || status < 500 ? err.message : 'Internal server error';
  res.status(status).json(errorResponse(code, message));
}
