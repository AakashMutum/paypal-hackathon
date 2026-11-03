import { env } from '../../config/env.js';

export interface PayPalTokenResponse {
  scope: string;
  access_token: string;
  token_type: string;
  app_id: string;
  expires_in: number;
  nonce?: string;
}

export type PayPalAuthErrorCode =
  | 'MISSING_CREDENTIALS'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_MODE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'API_ERROR';

export class PayPalAuthError extends Error {
  public readonly code: PayPalAuthErrorCode;
  public readonly status?: number;

  constructor(message: string, code: PayPalAuthErrorCode, status?: number) {
    super(message);
    this.name = 'PayPalAuthError';
    this.code = code;
    this.status = status;
  }
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let inFlightTokenPromise: Promise<string> | null = null;

// Allow injecting a custom fetch function for deterministic unit testing
type FetchFn = typeof fetch;
let customFetch: FetchFn | null = null;

export function setCustomFetch(fn: FetchFn | null): void {
  customFetch = fn;
}

export function clearTokenCache(): void {
  cachedToken = null;
  inFlightTokenPromise = null;
}

export function getCachedTokenForTesting(): CachedToken | null {
  return cachedToken;
}

/**
 * Retrieves a valid PayPal OAuth 2.0 access token using Client ID & Secret.
 * Uses HTTP Basic Authentication, caches tokens in memory with a safety margin,
 * and handles concurrent requests, network timeouts, and invalid credentials safely.
 */
export async function getAccessToken(options: { forceRefresh?: boolean } = {}): Promise<string> {
  const mode = env.paypalMode.toLowerCase().trim();
  if (mode !== 'sandbox') {
    throw new PayPalAuthError(
      `Invalid PayPal mode: "${mode}". Checkout Guardian enforces sandbox mode only.`,
      'INVALID_MODE'
    );
  }

  const clientId = env.paypalClientId.trim();
  const clientSecret = env.paypalClientSecret.trim();

  if (!clientId || !clientSecret) {
    throw new PayPalAuthError(
      'PayPal Client ID or Client Secret is not configured',
      'MISSING_CREDENTIALS'
    );
  }

  const now = Date.now();
  const safetyBufferMs = 60 * 1000; // Refresh 60 seconds before expiration

  if (!options.forceRefresh && cachedToken && cachedToken.expiresAt - now > safetyBufferMs) {
    return cachedToken.accessToken;
  }

  if (inFlightTokenPromise) {
    return inFlightTokenPromise;
  }

  inFlightTokenPromise = (async () => {
    try {
      const activeFetch = customFetch || fetch;
      const tokenUrl = `${env.paypalBaseUrl}/v1/oauth2/token`;

      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), env.paypalTimeoutMs);

      let response: Response;
      try {
        response = await activeFetch(tokenUrl, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: 'grant_type=client_credentials',
          signal: controller.signal,
        });
      } catch (networkError: unknown) {
        if (networkError instanceof Error && networkError.name === 'AbortError') {
          throw new PayPalAuthError(
            `PayPal OAuth request timed out after ${env.paypalTimeoutMs}ms`,
            'TIMEOUT'
          );
        }
        const message = networkError instanceof Error ? networkError.message : 'Unknown network failure';
        throw new PayPalAuthError(
          `PayPal OAuth network error: ${message}`,
          'NETWORK_ERROR'
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 401) {
          throw new PayPalAuthError(
            'Invalid PayPal credentials or unauthorized access',
            'INVALID_CREDENTIALS',
            401
          );
        }
        let errorDetails = '';
        try {
          const errorJson = (await response.json()) as { error?: string; error_description?: string };
          errorDetails = errorJson.error_description || errorJson.error || '';
        } catch {
          console.warn('[paypal] the error response body was not JSON');
        }
        throw new PayPalAuthError(
          `PayPal OAuth API error (status ${response.status})${errorDetails ? `: ${errorDetails}` : ''}`,
          'API_ERROR',
          response.status
        );
      }

      const data = (await response.json()) as PayPalTokenResponse;
      if (!data.access_token || typeof data.expires_in !== 'number') {
        throw new PayPalAuthError(
          'Invalid response received from PayPal OAuth endpoint',
          'API_ERROR'
        );
      }

      cachedToken = {
        accessToken: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      return cachedToken.accessToken;
    } finally {
      inFlightTokenPromise = null;
    }
  })();

  return inFlightTokenPromise;
}

