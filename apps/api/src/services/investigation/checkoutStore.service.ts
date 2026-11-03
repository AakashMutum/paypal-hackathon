import { getBackend, type StoredRow } from '../persistence/recordStore.js';
import type { CaptureState, UiVerdict } from './investigation.types.js';

export type AgentCheckoutStatus =
  | 'AWAITING_APPROVAL'
  | 'CAPTURED'
  | 'PAUSED'
  | 'NEEDS_HUMAN_DECISION'
  | 'ABORTED'
  | 'FAILED';

export interface AgentCheckoutRecord {
  /** Same as checkoutId; lets the payment steps treat a checkout like any payable record. */
  id: string;
  checkoutId: string;
  agentId?: string;
  paypalOrderId: string;
  authorizationId?: string;
  captureId?: string;
  merchantUrl: string;
  domain: string;
  claimedBrand?: string;
  payee: { merchantId: string; email?: string };
  items?: Array<{ name: string; quantity: number; unitPrice: number }>;
  amount: number;
  currency: string;
  status: AgentCheckoutStatus;
  captureState: CaptureState;
  captureReason?: string;
  verdict?: UiVerdict;
  acknowledged?: boolean;
  payeeMismatch?: boolean;
  simulated: boolean;
  mode: 'sandbox' | 'simulated';
  createdAt: string;
}

function toRow(c: AgentCheckoutRecord): StoredRow {
  return {
    id: c.checkoutId,
    kind: 'agent_checkout',
    paypalOrderId: c.paypalOrderId,
    ...(c.agentId ? { agentId: c.agentId } : {}),
    ...(c.verdict ? { verdict: c.verdict } : {}),
    captureState: c.captureState,
    amount: c.amount,
    currency: c.currency,
    simulated: c.simulated,
    data: c as unknown as Record<string, unknown>,
    createdAt: c.createdAt,
  };
}

export const checkoutStore = {
  async save(record: AgentCheckoutRecord): Promise<void> {
    await (await getBackend()).upsert(toRow(record));
  },

  async get(checkoutId: string): Promise<AgentCheckoutRecord | undefined> {
    const row = await (await getBackend()).get('agent_checkout', checkoutId);
    return row ? (row.data as unknown as AgentCheckoutRecord) : undefined;
  },
};
