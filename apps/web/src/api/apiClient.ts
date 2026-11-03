import type { CreateOrderRequest, CreateOrderResponse, Health, Investigation, MerchantRegistration, MerchantResult, ReportRequest } from '../types';
import { mock } from './mock';
// All payment logic lives in the backend. The frontend only requests actions and renders what the API reports.
const BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
/** The API is used when VITE_API_URL is set and VITE_USE_MOCK is not "true". Otherwise the simulated backend runs. */
export const USE_MOCK = !(BASE && import.meta.env.VITE_USE_MOCK !== 'true');

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

// The demo admin token (for the analyst console) is typed in by a person and kept for the session.
const ADMIN_KEY = 'trustora.demoToken';
export function getAdminToken(): string | undefined {
  try {
    return sessionStorage.getItem(ADMIN_KEY) ?? undefined;
  } catch (e) {
    console.warn('Session storage is not available:', e instanceof Error ? e.message : e);
    return undefined;
  }
}
export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_KEY, token);
  } catch (e) {
    console.warn('The admin token could not be kept:', e instanceof Error ? e.message : e);
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = tokenFor(path);
  const admin = getAdminToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { 'x-order-token': token } : {}),
    ...(admin ? { 'x-demo-token': admin } : {}),
  };
  const r = await fetch(BASE + path, { headers, ...init });
  if (!r.ok) {
    const text = await r.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch (e) {
      console.warn('The API answered with a body that is not JSON:', e instanceof Error ? e.message : e);
    }
    throw new Error(`${r.status} ${message}`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
const post = <T>(p: string, b?: unknown) => http<T>(p, { method: 'POST', body: b ? JSON.stringify(b) : undefined });

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
  resetDemo: (): Promise<void> => USE_MOCK ? mock.reset() : post('/api/demo/reset'),
  /** The API's GET /health. Not available from the simulated backend. */
  health: async (): Promise<Health | null> => {
    if (USE_MOCK) return null;
    const body = await http<{ data: Health }>('/health');
    return body.data;
  },
};
