import { Channel3ApiClient } from './channel3Client.js';
import { KernelBrowserClient, type KernelClientDeps } from './kernelClient.js';

export interface LiveClients {
  kernel?: KernelBrowserClient;
  channel3?: Channel3ApiClient;
}

export interface CreateLiveClientsOptions {
  fetchImpl?: typeof fetch;
  kernelDeps?: KernelClientDeps;
}

/**
 * Builds the live clients from environment variables. A missing or blank key gives undefined
 * for that client and never throws, so callers can pass the result straight to
 * createLocalSignalsPort and fall back to the no-network behaviour.
 */
export function createLiveClientsFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: CreateLiveClientsOptions = {},
): LiveClients {
  const kernelKey = env.KERNEL_API_KEY?.trim();
  const channel3Key = env.CHANNEL3_API_KEY?.trim();
  const channel3BaseUrl = env.CHANNEL3_BASE_URL?.trim();
  return {
    ...(kernelKey ? { kernel: new KernelBrowserClient(kernelKey, options.kernelDeps) } : {}),
    ...(channel3Key
      ? {
          channel3: new Channel3ApiClient(
            channel3Key,
            options.fetchImpl,
            channel3BaseUrl || undefined,
          ),
        }
      : {}),
  };
}
