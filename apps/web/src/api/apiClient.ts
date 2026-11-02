import type { CreateOrderRequest, CreateOrderResponse, Investigation, MerchantRegistration, MerchantResult, ReportRequest } from '@checkout-guardian/contracts';
import { mock } from './mock';
// All payment logic lives in the backend. The frontend only requests actions and renders what the API reports.
const BASE: string = import.meta.env.VITE_API_URL ?? '';
export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? (undefined as T) : r.json();
}
const post = <T>(p: string, b?: unknown) => http<T>(p, { method: 'POST', body: b ? JSON.stringify(b) : undefined });
export const api = {
  scanUrl: (url: string): Promise<Investigation> => USE_MOCK ? mock.scan(url) : post('/api/scan', { url }),
  createOrder: (r: CreateOrderRequest): Promise<CreateOrderResponse> => USE_MOCK ? mock.createOrder(r) : post('/api/orders', r),
  notifyApproval: (orderId: string): Promise<void> => USE_MOCK ? mock.approved(orderId) : post(`/api/orders/${orderId}/approved`),
  listInvestigations: (): Promise<Investigation[]> => USE_MOCK ? mock.list() : http('/api/investigations'),
  getInvestigation: (id: string): Promise<Investigation> => USE_MOCK ? mock.get(id) : http(`/api/investigations/${id}`),
  cancelOrder: (id: string): Promise<Investigation> => USE_MOCK ? mock.cancel(id) : post(`/api/orders/${id}/cancel`),
  requestReview: (id: string): Promise<Investigation> => USE_MOCK ? mock.review(id) : post(`/api/orders/${id}/review`),
  reportMerchant: (r: ReportRequest): Promise<void> => USE_MOCK ? mock.report(r) : post('/api/reports', r),
  registerMerchant: (r: MerchantRegistration): Promise<MerchantResult> => USE_MOCK ? mock.register(r) : post('/api/merchants', r),
  resetDemo: (): Promise<void> => USE_MOCK ? mock.reset() : post('/api/demo/reset'),
};
