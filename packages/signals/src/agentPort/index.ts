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
