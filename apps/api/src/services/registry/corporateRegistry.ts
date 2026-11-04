import { z } from 'zod';

/**
 * Optional corporate-registry provider.
 *
 * The configured endpoint must return only records the provider actually supplied. There is no
 * local fallback record, no invented registration, and no invented owner or address. If the
 * provider is absent, slow, malformed, or returns no records, the caller keeps the local
 * merchant_records result and the agent sees an explicit empty/unknown registry outcome.
 *
 * Expected response:
 *   { "records": [{ "merchantId": "...", "legalName": "...", "brandNames": ["..."],
 *                    "domain": "...", "city": "...", "country": "...",
 *                    "status": "verified" | "pending" | "revoked",
 *                    "source": "..." }] }
 */

export interface CorporateRegistryRecord {
  merchantId: string;
  legalName: string;
  brandNames: string[];
  domain?: string;
  city?: string;
  country?: string;
  status: 'verified' | 'pending' | 'revoked';
  source: string;
  fetchedAt: string;
}

export interface CorporateRegistryLookup {
  by: 'name' | 'domain' | 'merchantId';
  query: string;
}

export interface CorporateRegistryProvider {
  readonly name: string;
  lookup(input: CorporateRegistryLookup, options: { timeoutMs: number; signal?: AbortSignal }): Promise<CorporateRegistryRecord[]>;
}

export interface CorporateRegistryConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
}

const RecordSchema = z.object({
  merchantId: z.string().min(1).max(100),
  legalName: z.string().min(1).max(200),
  brandNames: z.array(z.string().min(1).max(100)).max(20).optional(),
  domain: z.string().min(1).max(253).optional(),
  city: z.string().min(1).max(100).optional(),
  country: z.string().min(1).max(100).optional(),
  status: z.enum(['verified', 'pending', 'revoked']).optional(),
  source: z.string().min(1).max(100).optional(),
});

const ResponseSchema = z.object({
  records: z.array(RecordSchema).max(10),
});

function cleanDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    try {
      return new URL(`https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return value.trim().toLowerCase().replace(/^www\./, '');
    }
  }
}

function readPositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(10_000, Math.max(500, value)) : fallback;
}

export function corporateRegistryConfig(env: NodeJS.ProcessEnv = process.env): CorporateRegistryConfig | null {
  const url = env.CORPORATE_REGISTRY_URL?.trim();
  if (!url) return null;
  // A corporate registry carries identity data; require HTTPS rather than silently sending it
  // over cleartext. Local tests inject a provider directly and do not use this config.
  if (!/^https:\/\//i.test(url)) return null;
  return {
    url,
    ...(env.CORPORATE_REGISTRY_API_KEY?.trim() ? { apiKey: env.CORPORATE_REGISTRY_API_KEY.trim() } : {}),
    timeoutMs: readPositiveNumber(env.CORPORATE_REGISTRY_TIMEOUT_MS, 2500),
  };
}

export class HttpCorporateRegistryProvider implements CorporateRegistryProvider {
  readonly name = 'corporate-registry-http';

  constructor(
    private readonly config: CorporateRegistryConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async lookup(
    input: CorporateRegistryLookup,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<CorporateRegistryRecord[]> {
    const url = new URL(this.config.url);
    url.searchParams.set('by', input.by);
    url.searchParams.set('query', input.query);
    const timeout = AbortSignal.timeout(Math.min(options.timeoutMs, this.config.timeoutMs));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`corporate registry request failed: ${message.slice(0, 160)}`);
    }

    if (!response.ok) throw new Error(`corporate registry HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 256 * 1024) throw new Error('corporate registry response is too large');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('corporate registry returned invalid JSON');
    }
    const result = ResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`corporate registry response did not match the documented schema (${result.error.issues.length} issue(s))`);
    }

    const fetchedAt = new Date().toISOString();
    const seen = new Set<string>();
    const records: CorporateRegistryRecord[] = [];
    for (const record of result.data.records) {
      const key = `${record.merchantId.toLowerCase()}|${cleanDomain(record.domain) ?? ''}|${record.legalName.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        merchantId: record.merchantId,
        legalName: record.legalName,
        brandNames: record.brandNames?.length ? record.brandNames : [record.legalName],
        ...(cleanDomain(record.domain) ? { domain: cleanDomain(record.domain) } : {}),
        ...(record.city ? { city: record.city } : {}),
        ...(record.country ? { country: record.country } : {}),
        status: record.status ?? 'pending',
        source: record.source ?? this.name,
        fetchedAt,
      });
      if (records.length >= 5) break;
    }
    return records;
  }
}

export interface CorporateRegistryResult {
  configured: boolean;
  provider?: string;
  records: CorporateRegistryRecord[];
  error?: string;
}

/** Calls the configured provider and never throws. The caller decides how to merge the result. */
export async function lookupCorporateRegistry(
  input: CorporateRegistryLookup,
  options: { timeoutMs: number; signal?: AbortSignal; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = { timeoutMs: 2500 },
): Promise<CorporateRegistryResult> {
  const config = corporateRegistryConfig(options.env ?? process.env);
  if (!config) return { configured: false, records: [] };
  try {
    const provider = new HttpCorporateRegistryProvider(config, options.fetchImpl ?? fetch);
    const records = await provider.lookup(input, options);
    return { configured: true, provider: provider.name, records };
  } catch (error) {
    return {
      configured: true,
      provider: 'corporate-registry-http',
      records: [],
      error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    };
  }
}
