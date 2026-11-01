import { errorResponse } from '@checkout-guardian/contracts';

export function notFoundHandler(req, res, _next) {
  res.status(404).json(errorResponse('NOT_FOUND', `Cannot ${req.method} ${req.originalUrl || req.url}`));
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const code = err.code || (status === 404 ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR');
  const message = err.expose || status < 500 ? err.message : 'Internal server error';
  res.status(status).json(errorResponse(code, message));
}
