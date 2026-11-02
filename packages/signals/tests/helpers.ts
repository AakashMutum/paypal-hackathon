import type { SignalCollectorOptions, SignalRequest } from '../src/types.js';

export const publicLookup = async (): Promise<string[]> => ['93.184.216.34'];

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function options(fetchImpl: typeof fetch): SignalCollectorOptions {
  return { fetchImpl, lookupImpl: publicLookup };
}

export const request: SignalRequest = {
  orderId: 'order-1',
  merchantUrl: 'https://www.harborline-outfitters.example/checkout',
  payee: { merchantId: 'MERCH-HARBORLINE', email: 'payments@harborline-outfitters.example' },
};
