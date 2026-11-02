import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

export const ListingSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().min(1).max(160),
  merchant: z.string().min(1).max(120),
  merchantId: z.string().min(1).max(100).optional(),
  payeeEmail: z.string().email().max(254).optional(),
  claimedBrand: z.string().min(1).max(80).optional(),
  url: z.string().url().max(2048),
  price: z.number().positive().max(1_000_000),
  currency: z.string().length(3),
  condition: z.string().max(40).optional(),
});

export type Listing = z.infer<typeof ListingSchema>;

export const MarketContextSchema = z.object({
  medianPrice: z.number().nonnegative(),
  offerCount: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

export type MarketContext = z.infer<typeof MarketContextSchema>;

export const GuardianVerdictFixtureSchema = z.object({
  decision: z.enum(['ALLOW', 'WARN', 'PAUSE']),
  score: z.number().min(0).max(100),
  summary: z.string().max(240).optional(),
});

export type GuardianVerdictFixture = z.infer<typeof GuardianVerdictFixtureSchema>;

export const ScenarioFixtureSchema = z.object({
  scenario: z.string().min(1).max(20),
  goal: z.string().min(1).max(300),
  budget: z.number().positive(),
  currency: z.string().length(3),
  marketContext: MarketContextSchema,
  listings: z.array(ListingSchema).min(1),
  guardianVerdicts: z.record(GuardianVerdictFixtureSchema),
  actions: z.array(z.record(z.unknown())).min(1),
  guardianOffActions: z.array(z.record(z.unknown())).optional(),
});

export type ScenarioFixture = z.infer<typeof ScenarioFixtureSchema>;

export interface MarketplaceResult {
  listings: Listing[];
  marketContext: MarketContext;
  source: 'api' | 'fixture';
  contextSource: 'api' | 'channel3' | 'fixture';
  fallbackReason?: string;
}

export interface MarketplaceLoadOptions {
  apiUrl?: string;
  fixture: ScenarioFixture;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MarketContextLoadOptions {
  fixture: MarketContext;
  query: string;
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/marketplace.json', import.meta.url)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function loadScenarioFixture(filePath = DEFAULT_FIXTURE_PATH): ScenarioFixture {
  const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  return ScenarioFixtureSchema.parse(raw);
}

export function listingById(listings: Listing[], id: string): Listing | undefined {
  return listings.find((listing) => listing.id === id);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      ...init,
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`marketplace request failed with ${response.status}`);
    }
    return raw.length > 0 ? JSON.parse(raw) : null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadMarketplace(
  options: MarketplaceLoadOptions
): Promise<MarketplaceResult> {
  const fallback: MarketplaceResult = {
    listings: options.fixture.listings,
    marketContext: options.fixture.marketContext,
    source: 'fixture',
    contextSource: 'fixture',
  };

  if (!options.apiUrl) return fallback;

  try {
    const body = await fetchJson(
      `${options.apiUrl.replace(/\/+$/, '')}/api/v1/demo/marketplace`,
      { method: 'GET', headers: { Accept: 'application/json' } },
      options
    );

    const data =
      isRecord(body) && body.success === true && 'data' in body ? body.data : body;
    const rawListings = isRecord(data)
      ? data.listings
      : Array.isArray(data)
        ? data
        : undefined;

    if (!Array.isArray(rawListings)) {
      throw new Error('marketplace response did not contain listings');
    }

    const listings = z.array(ListingSchema).parse(rawListings);
    const marketContext =
      isRecord(data) && data.marketContext !== undefined
        ? MarketContextSchema.parse(data.marketContext)
        : options.fixture.marketContext;

    return {
      listings,
      marketContext,
      source: 'api',
      contextSource: isRecord(data) && data.marketContext !== undefined ? 'api' : 'fixture',
    };
  } catch {
    return { ...fallback, fallbackReason: 'marketplace_unavailable' };
  }
}

export async function loadMarketContext(
  options: MarketContextLoadOptions
): Promise<{ context: MarketContext; source: 'channel3' | 'fixture' }> {
  if (!options.apiKey) {
    return { context: options.fixture, source: 'fixture' };
  }

  try {
    const { Channel3 } = await import('@channel3/sdk');
    const client = new Channel3({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      timeoutInSeconds: Math.max(1, Math.round((options.timeoutMs ?? 4_000) / 1_000)),
      maxRetries: 1,
    });

    const page = await client.products.search({ query: options.query });
    const prices: number[] = [];
    let currency = options.fixture.currency;

    for (const product of page.data) {
      for (const offer of product.offers ?? []) {
        const price = offer.price;
        if (price && Number.isFinite(price.price) && price.price > 0) {
          prices.push(price.price);
          if (typeof price.currency === 'string' && price.currency.length === 3) {
            currency = price.currency.toUpperCase();
          }
        }
      }
    }

    if (prices.length === 0) {
      return { context: options.fixture, source: 'fixture' };
    }

    prices.sort((a, b) => a - b);
    const middle = Math.floor(prices.length / 2);
    const median =
      prices.length % 2 === 0
        ? (prices[middle - 1] + prices[middle]) / 2
        : prices[middle];

    return {
      context: {
        medianPrice: roundMoney(median),
        offerCount: prices.length,
        currency,
      },
      source: 'channel3',
    };
  } catch {
    return { context: options.fixture, source: 'fixture' };
  }
}
