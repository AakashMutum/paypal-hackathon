import dotenv from 'dotenv';

dotenv.config();

export interface EnvConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigin: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  databaseUrl: string;
  databaseSsl: boolean;
  databaseTimeoutMs: number;
  databaseMaxConnections: number;
  paypalMode: string;
  paypalClientId: string;
  paypalClientSecret: string;
  paypalBaseUrl: string;
  paypalTimeoutMs: number;
  /** Protects POST /api/demo/reset. Unset is refused in production. */
  demoAdminToken: string;
  /** When set, agent routes require Authorization: Bearer <this value>. */
  guardianApiKey: string;
}

const rawPaypalMode = (process.env.PAYPAL_MODE || 'sandbox').toLowerCase().trim();
if (rawPaypalMode !== 'sandbox') {
  throw new Error(`Invalid PAYPAL_MODE: "${rawPaypalMode}". Checkout Guardian requires PAYPAL_MODE=sandbox and will not silently fall back to live mode.`);
}

export const env: EnvConfig = {
  nodeEnv: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '120', 10),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  databaseTimeoutMs: parseInt(process.env.DATABASE_TIMEOUT_MS || '2000', 10),
  databaseMaxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || '10', 10),
  paypalMode: 'sandbox',
  paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
  paypalTimeoutMs: parseInt(process.env.PAYPAL_TIMEOUT_MS || '10000', 10),
  demoAdminToken: process.env.DEMO_ADMIN_TOKEN || '',
  guardianApiKey: process.env.GUARDIAN_API_KEY || '',
};

export function isProduction(): boolean {
  return env.nodeEnv === 'production';
}

/**
 * Overrides the configured database URL at runtime.
 *
 * This is intended for test isolation: it allows tests that must run
 * without a database (e.g. the health endpoint test asserting the
 * `not_configured` state) to deterministically clear the value that
 * `dotenv.config()` loaded from the developer's root `.env` file, without
 * deleting or modifying that file. Callers that mutate the URL must also
 * reset the cached connection pool via `setPool(null)` so the change takes
 * effect immediately.
 */
export function setDatabaseUrl(url: string): void {
  env.databaseUrl = url;
}

/**
 * Overrides PayPal configuration at runtime for testing purposes.
 */
export function setPaypalConfig(overrides: Partial<Pick<EnvConfig, 'paypalClientId' | 'paypalClientSecret' | 'paypalMode' | 'paypalBaseUrl' | 'paypalTimeoutMs'>>): void {
  if (overrides.paypalClientId !== undefined) env.paypalClientId = overrides.paypalClientId;
  if (overrides.paypalClientSecret !== undefined) env.paypalClientSecret = overrides.paypalClientSecret;
  if (overrides.paypalMode !== undefined) env.paypalMode = overrides.paypalMode;
  if (overrides.paypalBaseUrl !== undefined) env.paypalBaseUrl = overrides.paypalBaseUrl;
  if (overrides.paypalTimeoutMs !== undefined) env.paypalTimeoutMs = overrides.paypalTimeoutMs;
}
