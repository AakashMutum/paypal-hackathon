import { jsonResponse, publicLookup } from './helpers.js';
import type { CertificateProbe, Channel3Client, LocalSignalsPortOptions } from '../src/agentPort/types.js';

export const NOW = Date.parse('2026-11-02T12:00:00Z');
export const callOpts = { timeoutMs: 2000 };

export const goodCert: CertificateProbe = {
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  issuer: 'Example CA',
  daysToExpiry: 200,
  authorized: true,
};

export function rdapBody(daysAgo: number, registrar?: string): unknown {
  const date = new Date(NOW - daysAgo * 86400000).toISOString();
  return {
    events: [{ eventAction: 'registration', eventDate: date }],
    ...(registrar
      ? { entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', registrar]]] }] }
      : {}),
  };
}

export interface Route {
  rdapDaysAgo?: number;
  registrar?: string;
  bindingMerchantId?: string | null;
  pages?: Record<string, string>;
}

/** A fake internet: rdap.org, the binding file and a few HTML pages. No real network. */
export function fakeFetch(route: Route, seen: string[] = []): typeof fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.startsWith('https://rdap.org/domain/')) {
      return route.rdapDaysAgo === undefined
        ? new Response('no', { status: 404 })
        : jsonResponse(rdapBody(route.rdapDaysAgo, route.registrar));
    }
    if (url.endsWith('/.well-known/checkout-guardian.json')) {
      return route.bindingMerchantId ? jsonResponse({ merchant_id: route.bindingMerchantId }) : new Response('no', { status: 404 });
    }
    const page = route.pages?.[url];
    if (page !== undefined) return new Response(page, { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

export function baseOptions(route: Route, extra: Partial<LocalSignalsPortOptions> = {}): LocalSignalsPortOptions {
  return {
    mode: 'live',
    fetchImpl: fakeFetch(route),
    lookupImpl: publicLookup,
    now: () => NOW,
    tlsProbe: async () => goodCert,
    ...extra,
  };
}

export function channel3With(median: number, count = 9): Channel3Client {
  return {
    async searchOffers() {
      return { offerCount: count, medianPrice: median, minPrice: median / 2, sampleDomains: ['shop-one.example'] };
    },
  };
}
