import { checkDatabase } from '../database/health.js';
import { findCatalogStore } from '../config/storeCatalog.js';
import { executeMerchantInvestigation } from './agent/agentRunner.service.js';
import { isCanonicalDomain, memoryInfo, signalsMode } from './agent/agentPorts.js';

/**
 * A few harmless in-process calls after the server starts listening, so the first real request
 * does not pay for lazy initialisation (module loading, the database pool, the memory store, the
 * agent wiring). Nothing is stored and no real site is contacted: the investigation uses the
 * invented genuine demo store, and only when that store is answered from recorded signals.
 * It never delays startup and never throws.
 */

export interface WarmUpStep {
  name: string;
  ok: boolean;
  ms: number;
}

export interface WarmUpReport {
  ms: number;
  steps: WarmUpStep[];
}

export function warmUpEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'test') return false;
  const flag = env.WARMUP?.trim().toLowerCase();
  return !(flag === 'off' || flag === 'false' || flag === '0');
}

async function timed(name: string, fn: () => Promise<unknown>): Promise<WarmUpStep> {
  const started = Date.now();
  try {
    await fn();
    return { name, ok: true, ms: Date.now() - started };
  } catch {
    return { name, ok: false, ms: Date.now() - started };
  }
}

export async function warmUp(): Promise<WarmUpReport> {
  const started = Date.now();
  const steps: WarmUpStep[] = [];
  steps.push(await timed('database', () => checkDatabase()));
  steps.push(await timed('memory', () => memoryInfo()));

  const store = findCatalogStore('harborline-outfitters');
  if (store && signalsMode() !== 'live' && isCanonicalDomain(store.domain)) {
    steps.push(await timed('agent', () => executeMerchantInvestigation({ url: `https://${store.domain}/` })));
  }
  return { ms: Date.now() - started, steps };
}
