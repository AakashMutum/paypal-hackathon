import { env } from '../../config/env.js';
import { getAccessToken, PayPalAuthError } from './paypalAuth.service.js';

export interface PayPalAmount {
  currency_code: string;
  value: string;
}

export interface PayPalPayee {
  email_address?: string;
  merchant_id?: string;
}

export interface PayPalCaptureDetails {
  id: string;
  status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'FAILED';
  amount: PayPalAmount;
  final_capture?: boolean;
  create_time?: string;
  update_time?: string;
}

export interface PayPalPurchaseUnit {
  reference_id?: string;
  amount: PayPalAmount;
  payee?: PayPalPayee;
  description?: string;
  payments?: {
    captures?: PayPalCaptureDetails[];
  };
}

export interface PayPalOrderResponse {
  id: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  intent: 'CAPTURE' | 'AUTHORIZE';
  purchase_units: PayPalPurchaseUnit[];
  create_time?: string;
  update_time?: string;
  links?: Array<{ href: string; rel: string; method: string }>;
}

export type PayPalOrderErrorCode =
  | 'VALIDATION_ERROR'
  | 'ORDER_NOT_FOUND'
  | 'CAPTURE_FAILED'
  | 'ALREADY_CAPTURED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'API_ERROR';

export class PayPalOrderError extends Error {
  public readonly code: PayPalOrderErrorCode;
  public readonly status?: number;
  public readonly details?: unknown;

  constructor(message: string, code: PayPalOrderErrorCode, status?: number, details?: unknown) {
    super(message);
    this.name = 'PayPalOrderError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface CreateOrderParams {
  amount: number;
  currency?: string;
  description?: string;
  referenceId?: string;
  requestId?: string;
  payeeEmail?: string;
  payeeMerchantId?: string;
}

type FetchFn = typeof fetch;
let customFetch: FetchFn | null = null;

export function setCustomOrdersFetch(fn: FetchFn | null): void {
  customFetch = fn;
}

function validateAmountAndCurrency(amount: number, currency: string): void {
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    throw new PayPalOrderError(
      'Order amount must be a positive number greater than zero',
      'VALIDATION_ERROR',
      400
    );
  }
  if (!currency || currency.length !== 3) {
    throw new PayPalOrderError(
      'Currency must be a valid 3-letter ISO-4217 code (e.g. USD)',
      'VALIDATION_ERROR',
      400
    );
  }
}

/**
 * Creates an order in PayPal Sandbox using PayPal Orders API v2.
 * Enforces backend validation, currency standards, and idempotency headers.
 */
export async function createPayPalOrder(params: CreateOrderParams): Promise<PayPalOrderResponse> {
  const currency = (params.currency || 'USD').toUpperCase().trim();
  validateAmountAndCurrency(params.amount, currency);

  const formattedAmount = params.amount.toFixed(2);
  const token = await getAccessToken();
  const activeFetch = customFetch || fetch;

  const url = `${env.paypalBaseUrl}/v2/checkout/orders`;

  const purchaseUnit: Record<string, unknown> = {
    reference_id: params.referenceId || 'default',
    amount: {
      currency_code: currency,
      value: formattedAmount,
    },
    description: params.description || 'Checkout Guardian Protected Order',
  };

  if (params.payeeEmail || params.payeeMerchantId) {
    const payee: Record<string, string> = {};
    if (params.payeeEmail) payee.email_address = params.payeeEmail;
    if (params.payeeMerchantId) payee.merchant_id = params.payeeMerchantId;
    purchaseUnit.payee = payee;
  }

  const payload = {
    intent: 'CAPTURE',
    purchase_units: [purchaseUnit],
    application_context: {
      user_action: 'PAY_NOW',
      brand_name: 'Checkout Guardian Storefront',
    },
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (params.requestId) {
    headers['PayPal-Request-Id'] = params.requestId;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.paypalTimeoutMs);

  let response: Response;
  try {
    response = await activeFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PayPalOrderError(`PayPal Create Order timed out after ${env.paypalTimeoutMs}ms`, 'TIMEOUT');
    }
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new PayPalOrderError(`PayPal Create Order network failure: ${message}`, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorJson: { message?: string; name?: string; details?: unknown } = {};
    try {
      errorJson = (await response.json()) as typeof errorJson;
    } catch {
      // ignore JSON parse failure
    }
    const message = errorJson.message || `PayPal API responded with status ${response.status}`;
    throw new PayPalOrderError(message, 'API_ERROR', response.status, errorJson.details);
  }

  return (await response.json()) as PayPalOrderResponse;
}

/**
 * Retrieves order details directly from PayPal Orders API v2.
 * Used to inspect true order status and payee identity before capture.
 */
export async function getPayPalOrder(orderId: string): Promise<PayPalOrderResponse> {
  if (!orderId || !orderId.trim()) {
    throw new PayPalOrderError('Valid PayPal order ID is required', 'VALIDATION_ERROR', 400);
  }

  const token = await getAccessToken();
  const activeFetch = customFetch || fetch;
  const url = `${env.paypalBaseUrl}/v2/checkout/orders/${encodeURIComponent(orderId.trim())}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.paypalTimeoutMs);

  let response: Response;
  try {
    response = await activeFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PayPalOrderError(`PayPal Get Order timed out after ${env.paypalTimeoutMs}ms`, 'TIMEOUT');
    }
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new PayPalOrderError(`PayPal Get Order network failure: ${message}`, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new PayPalOrderError(`PayPal order "${orderId}" not found`, 'ORDER_NOT_FOUND', 404);
    }
    let errorJson: { message?: string } = {};
    try {
      errorJson = (await response.json()) as typeof errorJson;
    } catch {
      // ignore JSON parse failure
    }
    const message = errorJson.message || `PayPal API error on get order (status ${response.status})`;
    throw new PayPalOrderError(message, 'API_ERROR', response.status);
  }

  return (await response.json()) as PayPalOrderResponse;
}

/**
 * Captures payment for an approved PayPal order via Orders API v2.
 * Supports idempotency via PayPal-Request-Id to prevent duplicate charges.
 */
export async function capturePayPalOrder(orderId: string, requestId?: string): Promise<PayPalOrderResponse> {
  if (!orderId || !orderId.trim()) {
    throw new PayPalOrderError('Valid PayPal order ID is required for capture', 'VALIDATION_ERROR', 400);
  }

  const token = await getAccessToken();
  const activeFetch = customFetch || fetch;
  const url = `${env.paypalBaseUrl}/v2/checkout/orders/${encodeURIComponent(orderId.trim())}/capture`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (requestId) {
    headers['PayPal-Request-Id'] = requestId;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), env.paypalTimeoutMs);

  let response: Response;
  try {
    response = await activeFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PayPalOrderError(`PayPal Capture Order timed out after ${env.paypalTimeoutMs}ms`, 'TIMEOUT');
    }
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new PayPalOrderError(`PayPal Capture Order network failure: ${message}`, 'NETWORK_ERROR');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    let errorJson: { name?: string; message?: string; details?: unknown[] } = {};
    try {
      errorJson = (await response.json()) as typeof errorJson;
    } catch {
      // ignore JSON parse failure
    }

    if (
      response.status === 422 &&
      (errorJson.name === 'ORDER_ALREADY_CAPTURED' ||
        (Array.isArray(errorJson.details) &&
          errorJson.details.some((d: any) => d?.issue === 'ORDER_ALREADY_CAPTURED')))
    ) {
      throw new PayPalOrderError('Order has already been captured', 'ALREADY_CAPTURED', 422, errorJson);
    }

    const message = errorJson.message || `PayPal capture failed with status ${response.status}`;
    throw new PayPalOrderError(message, 'CAPTURE_FAILED', response.status, errorJson);
  }

  return (await response.json()) as PayPalOrderResponse;
}

