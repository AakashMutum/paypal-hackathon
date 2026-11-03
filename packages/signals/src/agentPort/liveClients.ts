import { Channel3ApiClient } from './channel3Client.js';
import { KernelBrowserClient } from './kernelClient.js';

export interface LiveClients {
  kernel?: KernelBrowserClient;
  channel3?: Channel3ApiClient;
}

/**
 * Builds the live clients from environment variables. A missing or blank key gives undefined
 * for that client and never throws, so callers can pass the result straight to
 * createLocalSignalsPort and fall back to the no-network behaviour.
 */
export function createLiveClientsFromEnv(env: Record<string, string | undefined> = process.env): LiveClients {
  const kernelKey = env.KERNEL_API_KEY?.trim();
  const channel3Key = env.CHANNEL3_API_KEY?.trim();
  return {
    ...(kernelKey ? { kernel: new KernelBrowserClient(kernelKey) } : {}),
    ...(channel3Key ? { channel3: new Channel3ApiClient(channel3Key) } : {}),
  };
}
