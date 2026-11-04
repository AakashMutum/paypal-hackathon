import { randomBytes } from 'node:crypto';
import { query } from '../../database/connection.js';
import { loadStoreCatalog } from '../../config/storeCatalog.js';
import { getBackend } from '../persistence/recordStore.js';

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

/** Looks up registered merchants. At most five are returned. */
export async function registryLookup(by: RegistryField, value: string): Promise<RegistryMerchant[]> {
  const q = value.trim().toLowerCase();
  const backend = await getBackend();
  if (backend.mode === 'database') {
    const column = by === 'name' ? 'lower(claimed_name)' : by === 'domain' ? 'lower(domain)' : 'lower(merchant_id)';
    const res = await query<MerchantRow>(`SELECT * FROM merchant_records WHERE ${column} = $1 LIMIT 5`, [by === 'domain' ? cleanDomain(q) : q]);
    return res.rows.map(fromRow);
  }
  seedMemory();
  const out: RegistryMerchant[] = [];
  for (const m of memory.values()) {
    const hit =
      (by === 'name' && m.brandNames.some((n) => n.toLowerCase() === q)) ||
      (by === 'merchantId' && m.merchantId.toLowerCase() === q) ||
      (by === 'domain' && m.domain === cleanDomain(q));
    if (hit) out.push(m);
  }
  return out.slice(0, 5);
}

/** Empties merchants added at run time. Tests and the demo reset use it. */
export function registryResetMemory(): void {
  memory.clear();
}

export interface SeedDeps {
  /** Runs a SQL statement. Defaults to the shared database connection. */
  run?: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  /** Defaults to DEMO_SEED from the environment. */
  enabled?: boolean;
}

export interface SeedResult {
  seeded: number;
  reason: 'disabled' | 'not_empty' | 'seeded';
}

/**
 * With DEMO_SEED=true and an empty merchant_records table, inserts the invented demo merchants so
 * the hosted genuine store matches a registry record. It mirrors the in-memory registry: the
 * impersonator is deliberately not a registered merchant. A table that already has rows is never
 * touched, and the merchants are inserted with ON CONFLICT DO NOTHING so a second start is safe.
 */
export async function seedDemoMerchants(deps: SeedDeps = {}): Promise<SeedResult> {
  const enabled = deps.enabled ?? process.env.DEMO_SEED?.trim().toLowerCase() === 'true';
  if (!enabled) return { seeded: 0, reason: 'disabled' };
  const run = deps.run ?? ((text: string, params?: unknown[]) => query(text, params));
  const count = await run('SELECT COUNT(*)::int AS n FROM merchant_records');
  if (Number(count.rows[0]?.n ?? 0) > 0) return { seeded: 0, reason: 'not_empty' };

  let seeded = 0;
  for (const store of loadStoreCatalog()) {
    if (store.kind === 'impersonator') continue;
    await run(
      `INSERT INTO merchant_records (merchant_id, domain, claimed_name, payee_email, verification_status, metadata)
       VALUES ($1,$2,$3,$4,'VERIFIED_GENUINE',$5)
       ON CONFLICT (merchant_id) DO NOTHING`,
      [
        store.registeredMerchantId,
        store.domain.replace(/^www\./, ''),
        store.payeeName,
        store.payeeEmail,
        JSON.stringify({ seed: 'demo', brand: store.brand }),
      ],
    );
    seeded += 1;
  }
  return { seeded, reason: 'seeded' };
}
