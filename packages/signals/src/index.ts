import { Channel3ProductCollector } from './products/channel3.js';
import { KernelBrowserCollector } from './browser/kernel.js';
import { TlsCertificateCollector } from './certificate/tls.js';
import { RdapCollector } from './domain/rdap.js';
import { FixtureMockCollector } from './mocks/fixtures.js';
import { PayeeBindingCollector } from './payee/binding.js';
import type { Evidence, ISignalCollector, SignalCollectorOptions, SignalRequest } from './types.js';
import { makeEvidence } from './util.js';

export * from './types.js';
export { assertSafeUrl, isPrivateAddress, UnsafeUrlError } from './safety/url.js';
export { RdapCollector, domainAgeDays } from './domain/rdap.js';
export { TlsCertificateCollector, evaluateCertificate } from './certificate/tls.js';
export { PayeeBindingCollector, BINDING_PATH } from './payee/binding.js';
export { KernelBrowserCollector } from './browser/kernel.js';
export { Channel3ProductCollector } from './products/channel3.js';
export { FixtureMockCollector } from './mocks/fixtures.js';

export function defaultCollectors(options: SignalCollectorOptions = {}): ISignalCollector[] {
  if (options.useMocks) return [new FixtureMockCollector()];
  return [
    new RdapCollector(),
    new TlsCertificateCollector(),
    new PayeeBindingCollector(),
    new KernelBrowserCollector(),
    new Channel3ProductCollector(),
  ];
}

function errorEvidence(collector: ISignalCollector, reason: unknown): Evidence {
  const message = reason instanceof Error ? reason.message : String(reason);
  return makeEvidence({
    id: `${collector.name}:collector_error`,
    type: 'COLLECTOR_ERROR',
    severity: 'LOW',
    confidence: 1,
    summary: `Collector "${collector.name}" failed: ${message.slice(0, 200)}`,
    source: collector.name,
    hardFail: false,
  });
}

/**
 * Runs every collector and returns all evidence. A collector that fails or throws becomes a
 * COLLECTOR_ERROR evidence item. This function never throws and never returns a decision.
 */
export async function gatherAllSignals(
  request: SignalRequest,
  options: SignalCollectorOptions = {},
  collectors: ISignalCollector[] = defaultCollectors(options),
): Promise<Evidence[]> {
  const settled = await Promise.allSettled(
    collectors.map((c) => Promise.resolve().then(() => c.collect(request, options))),
  );
  const evidence: Evidence[] = [];
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      evidence.push(...result.value);
    } else {
      evidence.push(
        errorEvidence(collectors[i], result.status === 'rejected' ? result.reason : 'invalid result'),
      );
    }
  });
  return evidence;
}

export {
  createLocalSignalsPort,
  detectLookalike,
  isAmazonHostname,
  marketplaceBrandDomains,
  recognizeMarketplace,
  safeHostname,
} from './agentPort/index.js';
export type {
  AgentEvidence,
  AgentSignalsPort,
  Channel3Client,
  KernelClient,
  LocalSignalsPortOptions,
  MarketplaceIdentity,
  PageAccess,
  PageAccessState,
  PageClaims,
  PageMarketplace,
  PageProduct,
} from './agentPort/index.js';
export {
  KernelBrowserClient,
  Channel3ApiClient,
  createLiveClientsFromEnv,
} from './agentPort/index.js';
export type {
  KernelClientDeps,
  KernelSdkLike,
  ChromiumLike,
  BrowserLike,
  PageLike,
  ContextLike,
  LiveClients,
} from './agentPort/index.js';
