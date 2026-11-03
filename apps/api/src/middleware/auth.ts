import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { sendError } from './errors.js';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

/** Compares two secrets without leaking their length or content through timing. */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newOrderToken(): string {
  return randomBytes(24).toString('hex');
}

const header = (req: Request, name: string): string => {
  const value = req.headers[name];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

/** True when the request carries the demo admin token. */
export function hasAdminToken(req: Request): boolean {
  return Boolean(env.demoAdminToken) && safeEqual(header(req, 'x-demo-token'), env.demoAdminToken);
}

/**
 * Protects POST /api/demo/reset. With DEMO_ADMIN_TOKEN set, the x-demo-token header must match.
 * With it unset, the route is refused in production and open in development.
 */
export function requireDemoAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!env.demoAdminToken) {
    if (isProduction()) {
      sendError(res, 403, 'FORBIDDEN', 'This route is disabled because DEMO_ADMIN_TOKEN is not set.');
      return;
    }
    next();
    return;
  }
  if (!hasAdminToken(req)) {
    sendError(res, 403, 'FORBIDDEN', 'A valid x-demo-token header is required.');
    return;
  }
  next();
}

/** Agent routes require Authorization: Bearer <GUARDIAN_API_KEY> when that variable is set. */
export function requireGuardianKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.guardianApiKey) {
    next();
    return;
  }
  const auth = header(req, 'authorization');
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!presented || !safeEqual(presented, env.guardianApiKey)) {
    sendError(res, 401, 'UNAUTHORIZED', 'A valid bearer token is required.');
    return;
  }
  next();
}

/**
 * True when the request may act on this order: it carries the order token returned when the
 * order was created, or the demo admin token (used by the analyst console).
 */
export function mayActOnOrder(req: Request, orderTokenHash: string | undefined): boolean {
  if (hasAdminToken(req)) return true;
  const presented = header(req, 'x-order-token');
  if (!presented || !orderTokenHash) return false;
  return safeEqual(hashToken(presented), orderTokenHash);
}
