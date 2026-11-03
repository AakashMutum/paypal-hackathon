import { llmMode, memoryMode, signalsMode } from './agent/agentPorts.js';
import { paymentMode } from './payments/paymentFlow.service.js';
import { getBackend } from './persistence/recordStore.js';

/** Which parts of the system run for real and which are simulated or replayed. */
export interface RuntimeModes {
  paypal: 'sandbox' | 'simulated';
  store: 'database' | 'memory';
  /** replay, live or auto (replay for the canonical stores, live for any other domain). */
  signals: string;
  /** live, replay, record or none. */
  llm: string;
  /** elastic or memory. */
  memory: string;
}

export async function getModes(): Promise<RuntimeModes> {
  return {
    paypal: paymentMode(),
    store: (await getBackend()).mode,
    signals: signalsMode(),
    llm: llmMode(),
    memory: await memoryMode(),
  };
}
