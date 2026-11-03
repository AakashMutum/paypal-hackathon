import { paymentMode } from './payments/paymentFlow.service.js';
import { getBackend } from './persistence/recordStore.js';

/** Which parts of the system run for real and which are simulated or replayed. */
export interface RuntimeModes {
  paypal: 'sandbox' | 'simulated';
  store: 'database' | 'memory';
  signals: string;
  llm: string;
  memory: string;
}

export async function getModes(): Promise<RuntimeModes> {
  return {
    paypal: paymentMode(),
    store: (await getBackend()).mode,
    signals: 'replay',
    llm: 'none',
    memory: 'memory',
  };
}
