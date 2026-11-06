import type { CreateOrderRequest, CreateOrderResponse, Health, Investigation, MerchantRegistration, MerchantResult, ReportRequest } from '../types';
import { mock } from './mock';
// All payment logic lives in the backend. The frontend only requests actions and renders what the API reports.
const BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
const FORCE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const FORCE_LIVE = import.meta.env.VITE_USE_MOCK === 'false';
/**
 * VITE_USE_MOCK=false always uses the API. With an empty VITE_API_URL the requests stay on the
 * same origin, so the Vite dev proxy forwards /api to the backend. The simulated backend only
 * runs when it is forced or when no API target is configured at all.
 */
export const USE_MOCK = FORCE_MOCK || (!FORCE_LIVE && !BASE);

// The API returns an order token when an order is created. It is needed to approve, cancel, review
// or acknowledge that order, so it is kept for the browser session (memory first, session storage
// when available) and sent as x-order-token.
const tokens = new Map<string, string>();
function rememberToken(ids: string[], token: string): void {
  for (const id of ids) {
    tokens.set(id, token);
    try {
      sessionStorage.setItem('trustora.orderToken.' + id, token);
    } catch (e) {
      console.warn('Order token kept in memory only:', e instanceof Error ? e.message : e);
    }
  }
}
function tokenFor(path: string): string | undefined {
  const m = path.match(/^\/api\/orders\/([^/]+)\//);
  if (!m) return undefined;
  const id = decodeURIComponent(m[1]);
  const inMemory = tokens.get(id);
  if (inMemory) return inMemory;
  try {
    return sessionStorage.getItem('trustora.orderToken.' + id) ?? undefined;
  } catch (e) {
    console.warn('Session storage is not available:', e instanceof Error ? e.message : e);
    return undefined;
  }
}

/** An API error with the HTTP status and, when the API sent one, its error code. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function http<T>(path: string, init?: RequestInit, extraHeaders: Record<string, string> = {}): Promise<T> {
  const token = tokenFor(path);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'x-order-token': token } : {}),
    ...extraHeaders,
  };
  const r = await fetch(BASE + path, { headers, ...init });
  if (!r.ok) {
    const text = await r.text();
    let message = text;
    let code: string | undefined;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
      if (parsed.error?.message) message = parsed.error.message;
      code = parsed.error?.code;
    } catch (e) {
      console.warn('The API answered with a body that is not JSON:', e instanceof Error ? e.message : e);
    }
    throw new ApiError(message, r.status, code);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const post = <T>(p: string, b?: unknown, headers?: Record<string, string>) => http<T>(p, { method: 'POST', body: b ? JSON.stringify(b) : undefined }, headers);

export const api = {
  scanUrl: (url: string): Promise<Investigation> => USE_MOCK ? mock.scan(url) : post('/api/scan', { url }),
  createOrder: async (r: CreateOrderRequest): Promise<CreateOrderResponse> => {
    if (USE_MOCK) return mock.createOrder(r);
    const created = await post<CreateOrderResponse>('/api/orders', r);
    if (created.orderToken) rememberToken([created.orderId, created.investigationId], created.orderToken);
    return created;
  },
  notifyApproval: (orderId: string): Promise<void> => USE_MOCK ? mock.approved(orderId) : post(`/api/orders/${orderId}/approved`),
  listInvestigations: (): Promise<Investigation[]> => USE_MOCK ? mock.list() : http('/api/investigations'),
  getInvestigation: (id: string): Promise<Investigation> => USE_MOCK ? mock.get(id) : http(`/api/investigations/${id}`),
  cancelOrder: (id: string): Promise<Investigation> => USE_MOCK ? mock.cancel(id) : post(`/api/orders/${id}/cancel`),
  acknowledge: (id: string): Promise<Investigation> => USE_MOCK ? mock.acknowledge(id) : post(`/api/orders/${id}/acknowledge`, {}),
  requestReview: (id: string): Promise<Investigation> => USE_MOCK ? mock.review(id) : post(`/api/orders/${id}/review`),
  reportMerchant: (r: ReportRequest): Promise<void> => USE_MOCK ? mock.report(r) : post('/api/reports', r),
  registerMerchant: (r: MerchantRegistration): Promise<MerchantResult> => USE_MOCK ? mock.register(r) : post('/api/merchants', r),
  /** The admin token is sent as x-demo-token for this one request only. It is never stored. */
  resetDemo: (adminToken?: string): Promise<void> => USE_MOCK ? mock.reset() : post('/api/demo/reset', undefined, adminToken ? { 'x-demo-token': adminToken } : undefined),
  /** The API's GET /health. Not available from the simulated backend. */
  health: async (): Promise<Health | null> => {
    if (USE_MOCK) return null;
    const body = await http<{ data: Health }>('/health');
    return body.data;
  },
};
