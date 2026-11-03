import { getPool, query } from '../../database/connection.js';
import type { CaptureState, PaymentEvent } from '../investigation/investigation.types.js';

export type RecordKind = 'order' | 'agent_checkout';

export interface StoredRow {
  id: string;
  kind: RecordKind;
  orderId?: string;
  paypalOrderId?: string;
  agentId?: string;
  verdict?: string;
  captureState: CaptureState;
  amount?: number;
  currency?: string;
  simulated: boolean;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface StoredPolicy {
  agentId: string;
  perOrderCap: number;
  dailyCap: number;
  firstPurchaseCap?: number;
  currency: string;
}

export interface SpendTotals {
  /** Amount authorized or captured today (UTC) by the agent, in the policy currency. */
  today: number;
  /** Number of earlier purchases that were authorized or captured. */
  purchases: number;
}

export interface RecordBackend {
  readonly mode: 'database' | 'memory';
  upsert(row: StoredRow): Promise<void>;
  /** Finds by id, or by order id for kind "order". */
  get(kind: RecordKind, idOrOrderId: string): Promise<StoredRow | undefined>;
  list(kind: RecordKind): Promise<StoredRow[]>;
  clear(): Promise<void>;
  addEvent(event: PaymentEvent): Promise<void>;
  events(investigationId: string): Promise<PaymentEvent[]>;
  getPolicy(agentId: string): Promise<StoredPolicy | undefined>;
  setPolicy(policy: StoredPolicy): Promise<void>;
  spendTotals(agentId: string, now: Date): Promise<SpendTotals>;
}

const COUNTS_AS_SPENT: CaptureState[] = ['AUTHORIZED', 'CAPTURED'];
const startOfUtcDay = (now: Date): number => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

export class MemoryBackend implements RecordBackend {
  readonly mode = 'memory' as const;
  private rows = new Map<string, StoredRow>();
  private eventLog: PaymentEvent[] = [];
  private policies = new Map<string, StoredPolicy>();

  async upsert(row: StoredRow): Promise<void> {
    this.rows.set(`${row.kind}:${row.id}`, structuredClone(row));
  }

  async get(kind: RecordKind, idOrOrderId: string): Promise<StoredRow | undefined> {
    const direct = this.rows.get(`${kind}:${idOrOrderId}`);
    if (direct) return structuredClone(direct);
    for (const row of this.rows.values()) {
      if (row.kind === kind && row.orderId === idOrOrderId) return structuredClone(row);
    }
    return undefined;
  }

  async list(kind: RecordKind): Promise<StoredRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.kind === kind)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => structuredClone(r));
  }

  async clear(): Promise<void> {
    this.rows.clear();
    this.eventLog = [];
  }

  async addEvent(event: PaymentEvent): Promise<void> {
    this.eventLog.push(structuredClone(event));
  }

  async events(investigationId: string): Promise<PaymentEvent[]> {
    return this.eventLog.filter((e) => e.investigationId === investigationId).map((e) => structuredClone(e));
  }

  async getPolicy(agentId: string): Promise<StoredPolicy | undefined> {
    const p = this.policies.get(agentId);
    return p ? { ...p } : undefined;
  }

  async setPolicy(policy: StoredPolicy): Promise<void> {
    this.policies.set(policy.agentId, { ...policy });
  }

  async spendTotals(agentId: string, now: Date): Promise<SpendTotals> {
    const dayStart = startOfUtcDay(now);
    let today = 0;
    let purchases = 0;
    for (const row of this.rows.values()) {
      if (row.kind !== 'agent_checkout' || row.agentId !== agentId) continue;
      if (!COUNTS_AS_SPENT.includes(row.captureState)) continue;
      purchases += 1;
      if (Date.parse(row.createdAt) >= dayStart) today += row.amount ?? 0;
    }
    return { today, purchases };
  }
}

// ---------------------------------------------------------------------------------------------
// PostgreSQL
// ---------------------------------------------------------------------------------------------

interface DbRow {
  id: string;
  kind: RecordKind;
  order_id: string | null;
  paypal_order_id: string | null;
  agent_id: string | null;
  verdict: string | null;
  capture_state: CaptureState;
  amount: string | null;
  currency: string | null;
  simulated: boolean;
  data: Record<string, unknown>;
  created_at: Date;
}

function fromDb(r: DbRow): StoredRow {
  return {
    id: r.id,
    kind: r.kind,
    ...(r.order_id ? { orderId: r.order_id } : {}),
    ...(r.paypal_order_id ? { paypalOrderId: r.paypal_order_id } : {}),
    ...(r.agent_id ? { agentId: r.agent_id } : {}),
    ...(r.verdict ? { verdict: r.verdict } : {}),
    captureState: r.capture_state,
    ...(r.amount !== null ? { amount: Number(r.amount) } : {}),
    ...(r.currency ? { currency: r.currency } : {}),
    simulated: r.simulated,
    data: r.data,
    createdAt: r.created_at.toISOString(),
  };
}

export class DatabaseBackend implements RecordBackend {
  readonly mode = 'database' as const;

  async upsert(row: StoredRow): Promise<void> {
    await query(
      `INSERT INTO investigations
         (id, kind, order_id, paypal_order_id, agent_id, verdict, capture_state, amount, currency, simulated, data, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (id) DO UPDATE SET
         order_id = EXCLUDED.order_id, paypal_order_id = EXCLUDED.paypal_order_id, agent_id = EXCLUDED.agent_id,
         verdict = EXCLUDED.verdict, capture_state = EXCLUDED.capture_state, amount = EXCLUDED.amount,
         currency = EXCLUDED.currency, simulated = EXCLUDED.simulated, data = EXCLUDED.data, updated_at = now()`,
      [
        row.id,
        row.kind,
        row.orderId ?? null,
        row.paypalOrderId ?? null,
        row.agentId ?? null,
        row.verdict ?? null,
        row.captureState,
        row.amount ?? null,
        row.currency ?? null,
        row.simulated,
        JSON.stringify(row.data),
        row.createdAt,
      ],
    );
  }

  async get(kind: RecordKind, idOrOrderId: string): Promise<StoredRow | undefined> {
    const res = await query<DbRow>(
      'SELECT * FROM investigations WHERE kind = $1 AND (id = $2 OR order_id = $2) ORDER BY (id = $2) DESC LIMIT 1',
      [kind, idOrOrderId],
    );
    return res.rows[0] ? fromDb(res.rows[0]) : undefined;
  }

  async list(kind: RecordKind): Promise<StoredRow[]> {
    const res = await query<DbRow>('SELECT * FROM investigations WHERE kind = $1 ORDER BY created_at DESC LIMIT 500', [kind]);
    return res.rows.map(fromDb);
  }

  async clear(): Promise<void> {
    await query('TRUNCATE investigations, payment_events');
  }

  async addEvent(event: PaymentEvent): Promise<void> {
    await query(
      'INSERT INTO payment_events (investigation_id, from_state, to_state, detail, simulated) VALUES ($1,$2,$3,$4,$5)',
      [event.investigationId, event.fromState ?? null, event.toState, JSON.stringify(event.detail ?? {}), event.simulated],
    );
  }

  async events(investigationId: string): Promise<PaymentEvent[]> {
    const res = await query<{ investigation_id: string; from_state: CaptureState | null; to_state: CaptureState; detail: Record<string, unknown>; simulated: boolean }>(
      'SELECT * FROM payment_events WHERE investigation_id = $1 ORDER BY id',
      [investigationId],
    );
    return res.rows.map((r) => ({
      investigationId: r.investigation_id,
      ...(r.from_state ? { fromState: r.from_state } : {}),
      toState: r.to_state,
      detail: r.detail,
      simulated: r.simulated,
    }));
  }

  async getPolicy(agentId: string): Promise<StoredPolicy | undefined> {
    const res = await query<{ agent_id: string; per_order_cap: string; daily_cap: string; first_purchase_cap: string | null; currency: string }>(
      'SELECT * FROM spend_policies WHERE agent_id = $1',
      [agentId],
    );
    const r = res.rows[0];
    if (!r) return undefined;
    return {
      agentId: r.agent_id,
      perOrderCap: Number(r.per_order_cap),
      dailyCap: Number(r.daily_cap),
      ...(r.first_purchase_cap !== null ? { firstPurchaseCap: Number(r.first_purchase_cap) } : {}),
      currency: r.currency,
    };
  }

  async setPolicy(policy: StoredPolicy): Promise<void> {
    await query(
      `INSERT INTO spend_policies (agent_id, per_order_cap, daily_cap, first_purchase_cap, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (agent_id) DO UPDATE SET per_order_cap = EXCLUDED.per_order_cap, daily_cap = EXCLUDED.daily_cap,
         first_purchase_cap = EXCLUDED.first_purchase_cap, currency = EXCLUDED.currency, updated_at = now()`,
      [policy.agentId, policy.perOrderCap, policy.dailyCap, policy.firstPurchaseCap ?? null, policy.currency],
    );
  }

  async spendTotals(agentId: string, now: Date): Promise<SpendTotals> {
    const dayStart = new Date(startOfUtcDay(now)).toISOString();
    const res = await query<{ today: string | null; purchases: string }>(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE created_at >= $2), 0) AS today, COUNT(*) AS purchases
         FROM investigations
        WHERE kind = 'agent_checkout' AND agent_id = $1 AND capture_state = ANY($3)`,
      [agentId, dayStart, COUNTS_AS_SPENT],
    );
    return { today: Number(res.rows[0]?.today ?? 0), purchases: Number(res.rows[0]?.purchases ?? 0) };
  }
}

// ---------------------------------------------------------------------------------------------
// Choosing the backend
// ---------------------------------------------------------------------------------------------

let resolved: RecordBackend | undefined;
let resolving: Promise<RecordBackend> | undefined;

async function resolveBackend(): Promise<RecordBackend> {
  const pool = getPool();
  if (!pool) {
    console.warn(
      '[store] WARNING: DATABASE_URL is not set. Investigations, checkouts, policies and the audit trail are kept in memory and are lost on restart.',
    );
    return new MemoryBackend();
  }
  try {
    await query('SELECT 1 FROM investigations LIMIT 1');
    return new DatabaseBackend();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `[store] WARNING: the database is configured but the investigations table is not usable (${reason}). Run the migrations. Falling back to memory: data is lost on restart.`,
    );
    return new MemoryBackend();
  }
}

export function getBackend(): Promise<RecordBackend> {
  if (resolved) return Promise.resolve(resolved);
  resolving ??= resolveBackend().then((b) => {
    resolved = b;
    return b;
  });
  return resolving;
}

/** Forget the chosen backend. Tests call this after changing the database settings. */
export function resetBackendChoice(): void {
  resolved = undefined;
  resolving = undefined;
}

export function currentStoreMode(): 'database' | 'memory' | 'unresolved' {
  return resolved ? resolved.mode : 'unresolved';
}
