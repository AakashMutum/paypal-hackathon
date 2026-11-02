
import type { CallOpts, Channel3Client, OfferSummary } from './types.js';
import { fetchWithTimeout } from '../util.js';

type Offer = {
  price?: number | { price?: number; amount?: number; currency?: string };
  currency?: string;
  url?: string;
};

export class Channel3ApiClient implements Channel3Client {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async searchOffers(
    input: { productQuery: string; maxPrice?: number; currency?: string },
    options: CallOpts,
  ): Promise<OfferSummary> {
    const filters: Record<string, unknown> = {};

    if (input.maxPrice !== undefined) {
      filters.price = { max_price: input.maxPrice };
    }

    const response = await fetchWithTimeout(
      this.fetchImpl,
      'https://api.trychannel3.com/v1/search',
      options.timeoutMs,
      {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: input.productQuery,
          filters,
          limit: 20,
        }),
        signal: options.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`Channel3 API error: ${response.status}`);
    }

    const data = await response.json() as {
      products?: Array<{ offers?: Offer[] }>;
      results?: Array<{ offers?: Offer[] }>;
      data?: Array<{ offers?: Offer[] }>;
    };

    const products = data.products ?? data.results ?? data.data ?? [];
    const offers = products.flatMap(product => product.offers ?? []);

    const valid = offers.map(offer => {
      const price = typeof offer.price === 'number'
        ? offer.price
        : offer.price?.price ?? offer.price?.amount;

      const currency = offer.currency ??
        (typeof offer.price === 'object' ? offer.price.currency : undefined);

      let domain: string | undefined;
      try {
        if (offer.url) domain = new URL(offer.url).hostname;
      } catch {}

      return { price, currency, domain };
    }).filter(offer =>
      typeof offer.price === 'number' &&
      (input.currency === undefined || offer.currency === input.currency) &&
      (input.maxPrice === undefined || offer.price <= input.maxPrice)
    );

    const prices = valid.map(offer => offer.price as number).sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);

    const medianPrice = prices.length === 0 ? undefined :
      prices.length % 2
        ? prices[middle]
        : (prices[middle - 1] + prices[middle]) / 2;

    return {
      offerCount: valid.length,
      medianPrice,
      minPrice: prices[0],
      currency: valid.find(offer => offer.currency)?.currency,
      sampleDomains: [...new Set(
        valid.map(offer => offer.domain).filter((domain): domain is string => !!domain)
      )].slice(0, 5),
    };
  }
}
