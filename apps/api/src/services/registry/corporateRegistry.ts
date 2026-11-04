export const DATA_GOV_IN_PROVIDER = 'data.gov.in';
export const DATA_GOV_IN_SOURCE =
  'data.gov.in / Registrars of Companies (RoC)-wise Company Master Data';

export interface CorporateRegistryRecord {
  merchantId: string;
  cin: string;
  legalName: string;
  brandNames: string[];
  status: 'verified' | 'pending' | 'revoked';
  companyStatus?: string;
  registrationDate?: string;
  registeredAddress?: string;
  source: string;
  fetchedAt: string;
}

export interface CorporateRegistryLookup {
  by: 'name' | 'cin' | 'merchantId' | 'domain';
  query: string;
}

export interface CorporateRegistryResult {
  configured: boolean;
  provider: string;
  status: 'MATCH' | 'UNKNOWN';
  lookedUpAt: string;
  records: CorporateRegistryRecord[];
  error?: string;
}

interface RegistryConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

const responseLimit = 256 * 1024;
const recordLimit = 100;

function configFrom(env: NodeJS.ProcessEnv): RegistryConfig | null {
  const rawUrl = env.CORPORATE_REGISTRY_URL?.trim();
  const apiKey = env.CORPORATE_REGISTRY_API_KEY?.trim();
  if (!rawUrl || !apiKey) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'api.data.gov.in' ||
        url.username || url.password || url.search || url.hash) return null;
    const configuredTimeout = Number(env.CORPORATE_REGISTRY_TIMEOUT_MS);
    return {
      url: url.toString(),
      apiKey,
      timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? Math.min(10_000, Math.max(500, configuredTimeout))
        : 2500,
    };
  } catch {
    return null;
  }
}

export function corporateRegistryConfig(
  env: NodeJS.ProcessEnv = process.env,
): RegistryConfig | null {
  return configFrom(env);
}

function field(row: Record<string, unknown>, names: string[]): string | undefined {
  const normalized = names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const [key, value] of Object.entries(row)) {
    if (!normalized.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    if (value == null) return undefined;
    if (typeof value !== 'string') throw new Error('data.gov.in response contained a malformed field');
    return value.trim() || undefined;
  }
  return undefined;
}

function mapRecord(value: unknown): Omit<CorporateRegistryRecord, 'fetchedAt'> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('data.gov.in response contained a malformed company record');
  }
  const row = value as Record<string, unknown>;
  const cin = field(row, ['cin', 'corporate_identification_number']);
  const legalName = field(row, ['company_name', 'companyname', 'legal_name']);
  if (!cin || !legalName) throw new Error('data.gov.in response did not contain a company name and CIN');

  const companyStatus = field(row, ['company_status', 'companystatus', 'status']);
  const state = companyStatus?.toLowerCase() ?? '';
  return {
    merchantId: cin,
    cin,
    legalName,
    brandNames: [legalName],
    status: /\bactive\b/.test(state) ? 'verified' :
      /(strike.?off|dissolv|cancel|liquidat|closed)/.test(state) ? 'revoked' : 'pending',
    ...(companyStatus ? { companyStatus } : {}),
    ...(field(row, ['date_of_registration', 'dateofregistration', 'registration_date'])
      ? { registrationDate: field(row, ['date_of_registration', 'dateofregistration', 'registration_date']) }
      : {}),
    ...(field(row, ['registered_address', 'registeredaddress', 'registered_office_address'])
      ? { registeredAddress: field(row, ['registered_address', 'registeredaddress', 'registered_office_address']) }
      : {}),
    source: DATA_GOV_IN_SOURCE,
  };
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export class HttpCorporateRegistryProvider {
  readonly name = DATA_GOV_IN_PROVIDER;

  constructor(private readonly config: RegistryConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  async lookup(
    input: CorporateRegistryLookup,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<CorporateRegistryRecord[]> {
    const query = input.query.trim();
    if (!query || query.length > 200) throw new Error('company registry query is invalid');
    if (input.by === 'domain') return [];

    const url = new URL(this.config.url);
    url.searchParams.set('api-key', this.config.apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', String(recordLimit));
    url.searchParams.set(`filters[${input.by === 'name' ? 'company_name' : 'cin'}]`, query);
    const requestedTimeout = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : this.config.timeoutMs;
    const timeout = AbortSignal.timeout(Math.min(requestedTimeout, this.config.timeoutMs));
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', signal,
      });
    } catch {
      throw new Error(signal.aborted ? 'data.gov.in request timed out or was cancelled' : 'data.gov.in request failed');
    }
    if (!response.ok) throw new Error(`data.gov.in returned HTTP ${response.status}`);

    let text: string;
    try {
      text = await response.text();
    } catch {
      throw new Error(signal.aborted ? 'data.gov.in request timed out or was cancelled' : 'data.gov.in response could not be read');
    }
    if (text.length > responseLimit) throw new Error('data.gov.in response is too large');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('data.gov.in returned invalid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null ||
        !Array.isArray((parsed as { records?: unknown }).records) ||
        (parsed as { records: unknown[] }).records.length > recordLimit) {
      throw new Error('data.gov.in response did not match the records schema');
    }

    const records = (parsed as { records: unknown[] }).records.map(mapRecord);
    const seen = new Set<string>();
    const matches = records.filter((record) => {
      const actual = normalize(input.by === 'name' ? record.legalName : record.cin);
      if (actual !== normalize(query) || seen.has(record.cin.toLowerCase())) return false;
      seen.add(record.cin.toLowerCase());
      return true;
    }).slice(0, 5);
    const fetchedAt = new Date().toISOString();
    return matches.map((record) => ({ ...record, fetchedAt }));
  }
}

export async function lookupCorporateRegistry(
  input: CorporateRegistryLookup,
  options: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<CorporateRegistryResult> {
  const lookedUpAt = new Date().toISOString();
  const config = corporateRegistryConfig(options.env ?? process.env);
  if (!config) {
    return { configured: false, provider: DATA_GOV_IN_PROVIDER, status: 'UNKNOWN', lookedUpAt, records: [] };
  }
  try {
    const provider = new HttpCorporateRegistryProvider(config, options.fetchImpl ?? fetch);
    const records = await provider.lookup(input, {
      timeoutMs: options.timeoutMs ?? config.timeoutMs,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return {
      configured: true, provider: provider.name, status: records.length ? 'MATCH' : 'UNKNOWN',
      lookedUpAt, records,
    };
  } catch (error) {
    return {
      configured: true, provider: DATA_GOV_IN_PROVIDER, status: 'UNKNOWN', lookedUpAt, records: [],
      error: error instanceof Error ? error.message : 'data.gov.in lookup failed',
    };
  }
}
