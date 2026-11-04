import { randomBytes } from 'node:crypto';
import { query } from '../../database/connection.js';
import { loadStoreCatalog } from '../../config/storeCatalog.js';
import { getBackend } from '../persistence/recordStore.js';
import {
  corporateRegistryConfig,
  lookupCorporateRegistry,
  type CorporateRegistryRecord,
} from './corporateRegistry.js';

/**
 * Merchant registry: who is registered under which brand. Uses the merchant_records table when
 * the database is in use, otherwise memory seeded with the canonical merchants.
 */

export interface RegistryMerchant {
  merchantId: string;
  legalName: string;
  brandNames: string[];
  domain: string;
  payeeEmail?: string;
  status: 'verified' | 'pending' | 'revoked';
  /** Where the record came from: local merchant_records or the configured corporate provider. */
  source?: string;
  /** When a corporate-provider record was fetched. */
  fetchedAt?: string;
}

const memory = new Map<string, RegistryMerchant>();

function seedMemory(): void {
  if (memory.size > 0) return;
  for (const store of loadStoreCatalog()) {
    // The impersonator is not a registered merchant; it only claims the genuine brand.
    if (store.kind === 'impersonator') continue;
    memory.set(store.registeredMerchantId, {
      merchantId: store.registeredMerchantId,
      legalName: store.payeeName,
      brandNames: [store.brand],
      domain: store.domain.replace(/^www\./, ''),
      payeeEmail: store.payeeEmail,
      status: 'verified',
    });
  }
}

const cleanDomain = (d: string): string => d.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0] ?? '';

export interface NewMerchant {
  legalName: string;
  domain: string;
  paypalEmail: string;
  type: 'REGISTERED' | 'INDIVIDUAL';
  country: string;
}

/** Adds a merchant and returns its id. Individuals are stored as pending, not verified. */
export async function registryAddMerchant(input: NewMerchant): Promise<string> {
  const merchantId = `MCH-${randomBytes(3).toString('hex').toUpperCase()}`;
  const status = input.type === 'REGISTERED' ? 'verified' : 'pending';
  const backend = await getBackend();
  if (backend.mode === 'database') {
    await query(
      `INSERT INTO merchant_records (merchant_id, domain, claimed_name, payee_email, verification_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        merchantId,
        cleanDomain(input.domain),
        input.legalName,
        input.paypalEmail,
        input.type === 'REGISTERED' ? 'VERIFIED_GENUINE' : 'UNVERIFIED',
        JSON.stringify({ country: input.country, type: input.type }),
      ],
    );
  } else {
    seedMemory();
    memory.set(merchantId, {
      merchantId,
      legalName: input.legalName,
      brandNames: [input.legalName],
      domain: cleanDomain(input.domain),
      payeeEmail: input.paypalEmail,
      status,
    });
  }
  return merchantId;
}

interface MerchantRow {
  merchant_id: string | null;
  domain: string;
  claimed_name: string;
  payee_email: string | null;
  verification_status: string;
}

const fromRow = (r: MerchantRow): RegistryMerchant => ({
  merchantId: r.merchant_id ?? '',
  legalName: r.claimed_name,
  brandNames: [r.claimed_name],
  domain: r.domain,
  ...(r.payee_email ? { payeeEmail: r.payee_email } : {}),
  status: r.verification_status === 'VERIFIED_GENUINE' ? 'verified' : r.verification_status === 'UNVERIFIED' ? 'pending' : 'revoked',
});

export type RegistryField = 'name' | 'domain' | 'merchantId';

function corporateToLocal(record: CorporateRegistryRecord, fallbackDomain: string): RegistryMerchant {
  return {
    merchantId: record.merchantId,
    legalName: record.legalName,
    brandNames: record.brandNames,
    domain: record.domain ?? fallbackDomain,
    status: record.status,
    source: record.source,
    fetchedAt: record.fetchedAt,
  };
}

/** Looks up registered merchants locally, then optionally in the configured corporate provider. */
export async function registryLookup(
  by: RegistryField,
  value: string,
  options: { timeoutMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<RegistryMerchant[]> {
  const q = value.trim().toLowerCase();
  const backend = await getBackend();
  let local: RegistryMerchant[] = [];
  if (backend.mode === 'database') {
    const column = by === 'name' ? 'lower(claimed_name)' : by === 'domain' ? 'lower(domain)' : 'lower(merchant_id)';
    const res = await query<MerchantRow>(`SELECT * FROM merchant_records WHERE ${column} = $1 LIMIT 5`, [by === 'domain' ? cleanDomain(q) : q]);
    local = res.rows.map(fromRow);
  } else {
    seedMemory();
    for (const m of memory.values()) {
      const hit =
        (by === 'name' && m.brandNames.some((n) => n.toLowerCase() === q)) ||
        (by === 'merchantId' && m.merchantId.toLowerCase() === q) ||
        (by === 'domain' && m.domain === cleanDomain(q));
      if (hit) local.push(m);
    }
    local = local.slice(0, 5);
  }

  // A local record is an authoritative configured source. Only ask the optional corporate
  // provider when the local registry has nothing, so known demo data does not incur a network
  // round-trip and unknown merchants get an explicit external lookup.
  if (local.length > 0 || !corporateRegistryConfig()) return local;

  const result = await lookupCorporateRegistry(
    { by, query: value },
    {
      timeoutMs: options.timeoutMs ?? 2500,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    },
  );
  if (result.error) {
    console.warn(`[registry] corporate provider unavailable: ${result.error}`);
    return local;
  }
  const fallbackDomain = by === 'domain' ? cleanDomain(value) : '';
  return result.records.map((record) => corporateToLocal(record, fallbackDomain)).slice(0, 5);
}

/** Health/diagnostics: whether the optional corporate provider is configured. */
export function registryProviderStatus(): 'corporate+local' | 'local' {
  return corporateRegistryConfig() ? 'corporate+local' : 'local';
}

/** Empties merchants added at run time. Tests and the demo reset use it. */
export function registryResetMemory(): void {
  memory.clear();
}
