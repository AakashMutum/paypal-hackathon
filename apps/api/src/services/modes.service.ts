import { llmInfo, memoryInfo, signalsMode } from './agent/agentPorts.js';
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
  llmProvider?: string;
  llmModel?: string;
  llmModels?: { fast: string[]; strong: string[] };
  llmKeySource?: string;
  llmError?: string;
  /** elastic, file or memory. */
  memory: string;
  memoryPersistent?: boolean;
  embeddings?: string;
  memorySize?: number;
  memoryLocation?: string;
}

export async function getModes(): Promise<RuntimeModes> {
  const llm = llmInfo();
  const memory = await memoryInfo();
  return {
    paypal: paymentMode(),
    store: (await getBackend()).mode,
    signals: signalsMode(),
    llm: llm.mode,
    llmProvider: llm.provider,
    llmModel: llm.models.fast[0],
    llmModels: llm.models,
    llmKeySource: llm.keySource,
    ...(llm.error ? { llmError: llm.error } : {}),
    memory: memory.mode,
    memoryPersistent: memory.persistent,
    embeddings: memory.embeddings,
    memorySize: memory.size,
    ...(memory.location ? { memoryLocation: memory.location } : {}),
  };
}
