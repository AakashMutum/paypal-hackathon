import { getBackend, type SpendTotals, type StoredPolicy } from './recordStore.js';

export type SpendPolicy = StoredPolicy;

export const policyStore = {
  async get(agentId: string): Promise<SpendPolicy | undefined> {
    return (await getBackend()).getPolicy(agentId);
  },

  async set(policy: SpendPolicy): Promise<void> {
    await (await getBackend()).setPolicy(policy);
  },

  async totals(agentId: string, now: Date = new Date()): Promise<SpendTotals> {
    return (await getBackend()).spendTotals(agentId, now);
  },
};

export interface PolicyCheck {
  allowed: boolean;
  /** Which cap was exceeded: perOrderCap, dailyCap or firstPurchaseCap. */
  cap?: 'perOrderCap' | 'dailyCap' | 'firstPurchaseCap';
  message?: string;
}

/** Checks a new purchase against the agent's policy. No policy means no limit. */
export async function checkSpendPolicy(agentId: string | undefined, amount: number, currency: string): Promise<PolicyCheck> {
  if (!agentId) return { allowed: true };
  const policy = await policyStore.get(agentId);
  if (!policy) return { allowed: true };
  if (policy.currency.toUpperCase() !== currency.toUpperCase()) {
    return { allowed: false, message: `The agent policy is in ${policy.currency}; this purchase is in ${currency}.` };
  }
  if (amount > policy.perOrderCap) {
    return { allowed: false, cap: 'perOrderCap', message: `This purchase (${amount.toFixed(2)}) is above the per-order cap (${policy.perOrderCap.toFixed(2)}).` };
  }
  const totals = await policyStore.totals(agentId);
  if (policy.firstPurchaseCap !== undefined && totals.purchases === 0 && amount > policy.firstPurchaseCap) {
    return { allowed: false, cap: 'firstPurchaseCap', message: `This first purchase (${amount.toFixed(2)}) is above the first-purchase cap (${policy.firstPurchaseCap.toFixed(2)}).` };
  }
  if (totals.today + amount > policy.dailyCap) {
    return { allowed: false, cap: 'dailyCap', message: `This purchase would take today's spending to ${(totals.today + amount).toFixed(2)}, above the daily cap (${policy.dailyCap.toFixed(2)}).` };
  }
  return { allowed: true };
}
