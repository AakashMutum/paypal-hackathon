export { createLocalSignalsPort, ageSeverity, discountSeverity } from './port.js';
export { detectLookalike, editDistance, normalizedDistance } from './lookalike.js';
export { extractPage, extractPageClaims, extractSection } from './html.js';
export type {
  AgentEvidence,
  AgentSeverity,
  AgentSignalsPort,
  CallOpts,
  Channel3Client,
  KernelClient,
  LocalSignalsPortOptions,
  OfferSummary,
  PageClaims,
  SectionHint,
  SectionResult,
} from './types.js';
export { KernelBrowserClient } from './kernelClient.js';
export type { KernelClientDeps, KernelSdkLike, ChromiumLike, BrowserLike, PageLike, ContextLike, KernelSession } from './kernelClient.js';
export { Channel3ApiClient, CHANNEL3_SEARCH_URL } from './channel3Client.js';
export { createLiveClientsFromEnv } from './liveClients.js';
export type { LiveClients } from './liveClients.js';
