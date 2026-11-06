export const CHANNEL3_PROVIDER = 'channel3';
export const CHANNEL3_SOURCE = 'Channel3 Product API';

export const PRICE_DEVIATION_THRESHOLD_PCT = 25;

export interface Channel3PriceOffer {
  merchant: string;
  merchantUrl: string;
  price: number;
  currency: string;
  availability: string;
  condition?: string;
  compareAtPrice?: number;
  variant?: string;
}

export interface Channel3PriceDeviation {
  observedPrice: number;
  observedCurrency: string;
  marketLow: number;
  marketHigh: number;
  marketMedian: number;
  deviationPct: number;
  direction: 'above' | 'below';
  comparableOfferCount: number;
}

export interface Channel3PriceProduct {
  id: string;
  title: string;
  brand?: string;
  url?: string;
}

export interface Channel3PriceResult {
  configured: boolean;
  provider: string;
  status: 'PRICE_DEVIATION' | 'PRICE_UNKNOWN';
  lookedUpAt: string;
  product?: Channel3PriceProduct;
  offers: Channel3PriceOffer[];
  deviation?: Channel3PriceDeviation;
  error?: string;
}

export interface Channel3PriceLookup {
  productName: string;
  observedPrice?: number;
  observedCurrency?: string;
  variant?: { name: string; value: string };
}

interface Channel3Config {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

const responseLimit = 256 * 1024;

function configFrom(env: NodeJS.ProcessEnv): Channel3Config | null {
  const rawUrl = env.CHANNEL3_BASE_URL?.trim();
  const apiKey = env.CHANNEL3_API_KEY?.trim();
  if (!rawUrl || !apiKey) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'api.trychannel3.com' ||
        url.username || url.password || url.search || url.hash) return null;
    const configuredTimeout = Number(env.CHANNEL3_TIMEOUT_MS);
    return {
      baseUrl: url.origin,
      apiKey,
      timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? Math.min(10_000, Math.max(500, configuredTimeout))
        : 2500,
    };
  } catch {
    return null;
  }
}

export function channel3Config(
  env: NodeJS.ProcessEnv = process.env,
): Channel3Config | null {
  return configFrom(env);
}

function normalizeCurrency(currency: unknown): string | undefined {
  if (typeof currency !== 'string') return undefined;
  const c = currency.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  return undefined;
}

function validPrice(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function variantMatches(offerVariant: unknown, wanted?: { name: string; value: string }): boolean {
  if (!wanted) return true;
  if (!offerVariant || typeof offerVariant !== 'object' || Array.isArray(offerVariant)) return false;
  const selected = (offerVariant as { selected?: unknown[] }).selected;
  if (!Array.isArray(selected)) return false;
  return selected.some((option) => {
    if (!option || typeof option !== 'object' || Array.isArray(option)) return false;
    const o = option as { name?: unknown; value?: unknown };
    return typeof o.name === 'string' && typeof o.value === 'string' &&
      o.name.toLowerCase() === wanted.name.toLowerCase() &&
      o.value.toLowerCase() === wanted.value.toLowerCase();
  });
}

function mapOffer(offer: unknown, wantedVariant?: { name: string; value: string }): Channel3PriceOffer | null {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) return null;
  const row = offer as Record<string, unknown>;
  const domain = row['domain'];
  const url = row['url'];
  if (typeof domain !== 'string' || !domain.trim()) return null;
  if (typeof url !== 'string' || !url.trim()) return null;

  if (!variantMatches(row['variants'], wantedVariant)) return null;

  const priceField = row['price'];
  if (!priceField || typeof priceField !== 'object' || Array.isArray(priceField)) return null;
  const priceRow = priceField as Record<string, unknown>;
  const price = validPrice(priceRow['price']);
  if (!price) return null;
  const currency = normalizeCurrency(priceRow['currency']);
  if (!currency) return null;

  const availability = typeof row['availability'] === 'string' ? row['availability'] : undefined;
  const condition = typeof row['condition'] === 'string' ? row['condition'] : undefined;
  const compareAtPrice = validPrice(priceRow['compare_at_price']);

  let variant: string | undefined;
  const variantField = row['variants'];
  if (variantField && typeof variantField === 'object' && !Array.isArray(variantField)) {
    const selected = (variantField as { selected?: unknown[] }).selected;
    if (Array.isArray(selected)) {
      variant = selected
        .filter((o) => o !== null && o !== undefined && typeof o === 'object' && !Array.isArray(o))
        .map((o) => `${String((o as { name?: unknown }).name ?? '')}:${String((o as { value?: unknown }).value ?? '')}`)
        .join(';');
    }
  }

  return {
    merchant: domain.trim(),
    merchantUrl: url.trim(),
    price,
    currency,
    availability: (availability ?? 'Unknown').trim() || 'Unknown',
    ...(condition ? { condition } : {}),
    ...(compareAtPrice !== undefined ? { compareAtPrice } : {}),
    ...(variant ? { variant } : {}),
  };
}

export class HttpChannel3Provider {
  readonly name = CHANNEL3_PROVIDER;

  constructor(private readonly config: Channel3Config, private readonly fetchImpl: typeof fetch = fetch) {}

  async lookup(
    input: Channel3PriceLookup,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ products: unknown[] }> {
    const query = input.productName.trim();
    if (!query || query.length > 200) throw new Error('Channel3 product query is invalid');

    const url = new URL(`${this.config.baseUrl}/v1/search`);
    const body: Record<string, unknown> = { query, limit: 10 };

    const requestedTimeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : this.config.timeoutMs;
    const timeout = AbortSignal.timeout(Math.min(requestedTimeout, this.config.timeoutMs));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        signal,
      });
    } catch {
      throw new Error(signal.aborted ? 'Channel3 request timed out or was cancelled' : 'Channel3 request failed');
    }
    if (!response.ok) throw new Error(`Channel3 returned HTTP ${response.status}`);

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new Error(signal.aborted ? 'Channel3 request timed out or was cancelled' : 'Channel3 response could not be read');
    }
    if (text.length > responseLimit) throw new Error('Channel3 response is too large');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Channel3 returned invalid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null ||
        !Array.isArray((parsed as { products?: unknown }).products)) {
      throw new Error('Channel3 response did not match the products schema');
    }

    return { products: (parsed as { products: unknown[] }).products };
  }
}

export async function compareChannel3Prices(
  input: Channel3PriceLookup,
  options: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<Channel3PriceResult> {
  const lookedUpAt = new Date().toISOString();
  const config = channel3Config(options.env ?? process.env);
  if (!config) {
    return { configured: false, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt, offers: [] };
  }

  const observedCurrency = input.observedCurrency ? normalizeCurrency(input.observedCurrency) : undefined;
  if (input.observedCurrency && !observedCurrency) {
    return {
      configured: true, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt, offers: [],
      error: 'observed currency is not a valid ISO 4217 code',
    };
  }

  try {
    const provider = new HttpChannel3Provider(config, options.fetchImpl ?? fetch);
    const { products } = await provider.lookup(input, {
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!products.length) {
      return { configured: true, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt, offers: [] };
    }

    const topProduct = products[0];
    if (!topProduct || typeof topProduct !== 'object' || Array.isArray(topProduct)) {
      return { configured: true, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt, offers: [] };
    }
    const row = topProduct as Record<string, unknown>;
    const id = typeof row['id'] === 'string' ? row['id'] : undefined;
    const title = typeof row['title'] === 'string' ? row['title'] : undefined;
    if (!id || !title) {
      return { configured: true, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt, offers: [] };
    }

    const brandField = row['brands'];
    let brand: string | undefined;
    if (Array.isArray(brandField) && brandField.length) {
      const first = brandField[0];
      if (first && typeof first === 'object' && !Array.isArray(first) &&
          typeof (first as { name?: unknown }).name === 'string') {
        brand = String((first as { name: string }).name);
      }
    }

    let url: string | undefined;
    if (typeof row['url'] === 'string' && row['url'].trim()) url = row['url'].trim();

    const product: Channel3PriceProduct = { id, title, ...(brand ? { brand } : {}), ...(url ? { url } : {}) };

    const rawOffers = row['offers'];
    const allOffers: Channel3PriceOffer[] = [];
    if (Array.isArray(rawOffers)) {
      for (const offer of rawOffers) {
        const mapped = mapOffer(offer, input.variant);
        if (mapped) allOffers.push(mapped);
      }
    }

    const comparable = allOffers.filter((offer) => {
      if (offer.availability !== 'InStock') return false;
      if (observedCurrency && offer.currency !== observedCurrency) return false;
      return true;
    });

    const result: Channel3PriceResult = {
      configured: true, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt,
      product, offers: comparable,
    };

    if (input.observedPrice !== undefined) {
      const observedPrice = validPrice(input.observedPrice);
      if (observedPrice && comparable.length) {
        const prices = comparable.map((o) => o.price);
        const marketLow = Math.min(...prices);
        const marketHigh = Math.max(...prices);
        const marketMedian = median(prices);
        const deviationPct = Math.abs(observedPrice - marketMedian) / marketMedian * 100;
        const direction = observedPrice > marketMedian ? 'above' : 'below';

        result.deviation = {
          observedPrice, observedCurrency: observedCurrency!,
          marketLow, marketHigh, marketMedian, deviationPct, direction,
          comparableOfferCount: comparable.length,
        };

        if (deviationPct >= PRICE_DEVIATION_THRESHOLD_PCT) {
          result.status = 'PRICE_DEVIATION';
        }
      }
    }

    return result;
  } catch (error) {
    return {
      configured: true, provider: CHANNEL3_PROVIDER, status: 'PRICE_UNKNOWN', lookedUpAt, offers: [],
      error: error instanceof Error ? error.message : 'Channel3 lookup failed',
    };
  }
}
