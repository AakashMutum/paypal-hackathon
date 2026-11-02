const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_FINALIZE_TIMEOUT_MS = 60_000;

export interface GuardianApiClientOptions {
  baseUrl: string;
  apiKey?: string;
  requestTimeoutMs?: number;
  finalizeTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface InvestigateMerchantPayload {
  orderId: string;
  merchantUrl: string;
  claimedBrand?: string;
  transactionAmount?: number;
  currency?: string;
  payee?: { merchantId: string; email?: string };
  agentId?: string;
}

export interface CreateCheckoutPayload {
  merchantUrl: string;
  amount: number;
  currency: string;
  merchantId: string;
  payeeEmail?: string;
  claimedBrand?: string;
  agentId?: string;
  items?: Array<{ name: string; quantity: number; unitPrice: number }>;
}

export interface FinalizeCheckoutPayload {
  humanDecision?: 'proceed' | 'abort';
}

export interface SpendPolicyPayload {
  perOrderCap: number;
  dailyCap: number;
  firstPurchaseCap?: number;
  currency: string;
}

export interface CreateCheckoutResponse {
  checkoutId?: string;
  approvalUrl?: string;
  status?: string;
  [key: string]: unknown;
}

export interface JsonObject {
  [key: string]: unknown;
}

const PLAIN_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: 'The guardian service rejected the request as invalid.',
  POLICY_VIOLATION: 'This purchase is outside the agent spending policy.',
  GUARDIAN_PAUSED: 'Checkout Guardian paused this purchase for a human decision.',
  REQUIRES_DECISION: 'A human decision is required before this checkout can continue.',
  UPSTREAM_TIMEOUT: 'The guardian service timed out. Nothing was charged.',
  UPSTREAM_ERROR: 'Could not reach the guardian service. Nothing was charged.',
  HTTP_ERROR: 'The guardian service returned an unexpected response.',
  BAD_RESPONSE: 'The guardian service returned an unreadable response.',
};

export function plainMessageFor(code: string): string {
  return PLAIN_MESSAGES[code] ?? 'The guardian service returned an error. Nothing was charged.';
}

export class GuardianApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 0, details?: unknown) {
    super(message);
    this.name = 'GuardianApiError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorEnvelope(value: unknown): value is {
  success: false;
  error: { code: string; message?: string; details?: unknown };
} {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === 'string';
}

function isSuccessEnvelope(value: unknown): value is {
  success: true;
  data: unknown;
  meta?: unknown;
} {
  return isRecord(value) && value.success === true && 'data' in value;
}

export class GuardianApiClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly requestTimeoutMs: number;
  private readonly finalizeTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GuardianApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.finalizeTimeoutMs = options.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  investigateMerchant(payload: InvestigateMerchantPayload): Promise<JsonObject> {
    return this.request<JsonObject>('POST', '/api/v1/investigations', payload);
  }

  createCheckout(payload: CreateCheckoutPayload): Promise<CreateCheckoutResponse> {
    return this.request<CreateCheckoutResponse>('POST', '/api/v1/checkout/orders', payload);
  }

  finalizeCheckout(
    checkoutId: string,
    payload: FinalizeCheckoutPayload
  ): Promise<JsonObject> {
    return this.request<JsonObject>(
      'POST',
      `/api/v1/checkout/orders/${encodeURIComponent(checkoutId)}/finalize`,
      payload,
      this.finalizeTimeoutMs
    );
  }

  setSpendPolicy(agentId: string, payload: SpendPolicyPayload): Promise<JsonObject> {
    return this.request<JsonObject>(
      'PUT',
      `/api/v1/policies/${encodeURIComponent(agentId)}`,
      payload
    );
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    timeoutMs = this.requestTimeoutMs
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const raw = await response.text();
      let parsed: unknown = null;
      if (raw.length > 0) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new GuardianApiError(
            'BAD_RESPONSE',
            plainMessageFor('BAD_RESPONSE'),
            response.status
          );
        }
      }

      if (isErrorEnvelope(parsed)) {
        throw new GuardianApiError(
          parsed.error.code,
          plainMessageFor(parsed.error.code),
          response.status,
          parsed.error.details
        );
      }

      if (!response.ok) {
        throw new GuardianApiError('HTTP_ERROR', plainMessageFor('HTTP_ERROR'), response.status);
      }

      if (isSuccessEnvelope(parsed)) return parsed.data as T;
      return parsed as T;
    } catch (error) {
      if (error instanceof GuardianApiError) throw error;

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GuardianApiError(
          'UPSTREAM_TIMEOUT',
          plainMessageFor('UPSTREAM_TIMEOUT')
        );
      }

      throw new GuardianApiError('UPSTREAM_ERROR', plainMessageFor('UPSTREAM_ERROR'));
    } finally {
      clearTimeout(timer);
    }
  }
}
