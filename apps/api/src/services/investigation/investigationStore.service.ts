import { getBackend, type StoredRow } from '../persistence/recordStore.js';
import type { FrontendInvestigation } from './investigation.types.js';

export type { FrontendInvestigation } from './investigation.types.js';

function toRow(inv: FrontendInvestigation): StoredRow {
  return {
    id: inv.id,
    kind: 'order',
    ...(inv.orderId ? { orderId: inv.orderId } : {}),
    ...(inv.paypalOrderId ? { paypalOrderId: inv.paypalOrderId } : {}),
    ...(inv.verdict ? { verdict: inv.verdict } : {}),
    captureState: inv.captureState,
    amount: inv.price,
    currency: inv.currency,
    simulated: inv.simulated ?? true,
    data: inv as unknown as Record<string, unknown>,
    createdAt: inv.createdAt,
  };
}

const fromRow = (row: StoredRow): FrontendInvestigation => row.data as unknown as FrontendInvestigation;

/**
 * Investigations for the web app. Uses PostgreSQL when DATABASE_URL is set and the migrations
 * have run, otherwise memory (with a loud warning logged once). Callers see the same interface.
 */
export const investigationStore = {
  async add(inv: FrontendInvestigation): Promise<void> {
    await (await getBackend()).upsert(toRow(inv));
  },

  /** Finds by investigation id or by order id. */
  async get(id: string): Promise<FrontendInvestigation | undefined> {
    const row = await (await getBackend()).get('order', id);
    return row ? fromRow(row) : undefined;
  },

  async list(): Promise<FrontendInvestigation[]> {
    return (await (await getBackend()).list('order')).map(fromRow);
  },

  /** Empties investigations and the audit trail. */
  async reset(): Promise<void> {
    await (await getBackend()).clear();
  },
};
