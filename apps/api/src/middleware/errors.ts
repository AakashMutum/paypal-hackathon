import type { Request, Response, NextFunction } from 'express';
import { errorResponse } from '@checkout-guardian/contracts';

export interface HttpError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
  expose?: boolean;
}

/** Sends an error in the standard envelope: { success: false, error: { code, message, details? } }. */
export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  res.status(status).json(errorResponse(code, message, details));
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
  if (status >= 500) console.error(`[error] ${code}: ${err.message}`);
  res.status(status).json(errorResponse(code, message));
}
