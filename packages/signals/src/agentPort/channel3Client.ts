import { fetchWithTimeout } from '../util.js';
import type { CallOpts, Channel3Client, OfferSummary } from './types.js';

// Endpoint, key header, request body and response shape follow Channel3's v1 search reference
// (POST /v1/search with an x-api-key header; the response is { products: [{ offers: [...] }] }
// and each offer has url, domain and price: { price, compare_at_price, currency }).
// Checked against the published documentation on 2026-11-03.
export const CHANNEL3_SEARCH_URL = 'https://api.trychannel3.com/v1/search';

type Offer = {
  price?: number | { price?: number; amount?: number; currency?: string };
  currency?: string;
  url?: string;
  domain?: string;
};

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export class Channel3ApiClient implements Channel3Client {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Removes the API key from any text that might reach an error message or a log. */
  private redact(text: string): string {
    return this.apiKey ? text.split(this.apiKey).join('[redacted]') : text;
  }

  async searchOffers(
    input: { productQuery: string; maxPrice?: number; currency?: string },
    options: CallOpts,
  ): Promise<OfferSummary> {
    const filters: Record<string, unknown> = {};
    if (input.maxPrice !== undefined) {
      filters.price = { max_price: input.maxPrice };
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(this.fetchImpl, CHANNEL3_SEARCH_URL, options.timeoutMs, {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input.productQuery, filters, limit: 20 }),
        signal: options.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Channel3 request failed: ${this.redact(message).slice(0, 160)}`);
    }

    if (!response.ok) {
      throw new Error(`Channel3 API error: ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) {
      throw new Error('Channel3 returned an empty response');
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Channel3 returned a response that is not valid JSON');
    }

    const body = (data && typeof data === 'object' ? data : {}) as {
      products?: unknown;
      results?: unknown;
      data?: unknown;
    };
    const list = body.products ?? body.results ?? body.data;
    const products = Array.isArray(list) ? (list as Array<{ offers?: Offer[] }>) : [];
    const offers = products.flatMap((product) => (Array.isArray(product?.offers) ? product.offers : []));

    const valid = offers
      .map((offer) => {
        const price = typeof offer.price === 'number' ? offer.price : offer.price?.price ?? offer.price?.amount;
        const currency = offer.currency ?? (typeof offer.price === 'object' ? offer.price?.currency : undefined);
        const domain = offer.domain ?? (offer.url ? hostOf(offer.url) : undefined);
        return { price, currency, domain };
      })
      .filter(
        (offer) =>
          typeof offer.price === 'number' &&
          Number.isFinite(offer.price) &&
          (input.currency === undefined || offer.currency === input.currency) &&
          (input.maxPrice === undefined || offer.price <= input.maxPrice),
      );

    const prices = valid.map((offer) => offer.price as number).sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);
    const medianPrice =
      prices.length === 0 ? undefined : prices.length % 2 ? prices[middle] : (prices[middle - 1] + prices[middle]) / 2;

    return {
      offerCount: valid.length,
      medianPrice,
      minPrice: prices[0],
      currency: valid.find((offer) => offer.currency)?.currency,
      sampleDomains: [...new Set(valid.map((offer) => offer.domain).filter((d): d is string => !!d))].slice(0, 5),
    };
  }
}
