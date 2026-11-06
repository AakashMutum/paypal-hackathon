import type { Investigation } from '../types';

export interface DashboardMetrics {
  websitesChecked: number;
  allowed: number;
  suspicious: number;
  prevented: number;
  /** Amount on flagged investigations that has not been captured, in the investigation currency. */
  defendedAmount: number;
}

/**
 * Dashboard counters come only from persisted investigations. An empty store is an honest zero,
 * not a demo baseline. RUNNING and QUEUED investigations are excluded from completed counters.
 */
export function dashboardMetrics(list: readonly Investigation[]): DashboardMetrics {
  const done = list.filter((inv) => inv.status === 'COMPLETE');
  const flagged = done.filter((inv) => inv.verdict === 'WARN' || inv.verdict === 'PAUSE');
  const prevented = done.filter((inv) => inv.verdict === 'PAUSE');
  const defendedAmount = flagged
    .filter((inv) => inv.captureState !== 'CAPTURED')
    .reduce((sum, inv) => sum + (typeof inv.price === 'number' ? inv.price : 0), 0);

  return {
    websitesChecked: done.length,
    allowed: done.filter((inv) => inv.verdict === 'ALLOW').length,
    suspicious: flagged.length,
    prevented: prevented.length,
    defendedAmount,
  };
}
