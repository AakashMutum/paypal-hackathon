import type { Decision, Evidence, InvestigationRequest } from './types.js';
import type { LlmClient } from './llm/client.js';

/**
 * The outside world, behind interfaces. The agent never talks to a network
 * client directly: each port has a fixture implementation for tests and a live
 * implementation that is wired up by the caller.
 */

export interface CallOpts {
  signal?: AbortSignal;
  timeoutMs: number;
}

export type SectionHint = 'about' | 'contact' | 'returns' | 'terms' | 'privacy' | 'shipping';

export type PageAccessState = 'ok' | 'blocked' | 'empty' | 'unreachable' | 'unsupported';

/** Whether the page could actually be read, and why it could not. */
export interface PageAccess {
  state: PageAccessState;
  httpStatus?: number;
  reason?: string;
}

/** Product facts read from structured page metadata. Absent fields are genuinely absent. */
export interface PageProduct {
  name?: string;
  price?: number;
  currency?: string;
  brand?: string;
  availability?: string;
  seller?: string;
  source: 'json-ld' | 'opengraph' | 'microdata' | 'metadata' | 'title' | 'visible-text';
}

export interface PageMarketplace {
  id: string;
  displayName: string;
  officialDomain: string;
  region?: string;
}

export type FaviconCheckState =
  | 'no_reference'
  | 'reference_domain'
  | 'no_favicon'
  | 'fetch_failed'
  | 'too_large'
  | 'invalid'
  | 'match'
  | 'differs';

export interface FaviconCheck {
  state: FaviconCheckState;
  observedHash?: string;
  referenceDomain?: string;
  referenceHash?: string;
  referenceSource?: string;
  referenceRetrievedOn?: string;
}

export interface PageClaims {
  finalUrl: string;
  domain: string;
  siteName?: string;
  legalName?: string;
  claimedBrand?: string;
  claimedLocation?: { city?: string; country?: string };
  contacts: { emails: string[]; phones: string[]; address?: string };
  linkedDomains: string[];
  visibleText: string;
  hiddenText: string;
  sectionLinks: Partial<Record<SectionHint, string>>;
  faviconUrl?: string;
  faviconSameOrigin?: boolean;
  faviconHash?: string;
  /** Outcome of comparing the favicon with a trusted reference. Absent when no check ran. */
  faviconCheck?: FaviconCheck;
  hasContactPage: boolean;
  hasLegalPage: boolean;
  screenshotUrl?: string;
  pageAccess?: PageAccess;
  product?: PageProduct;
  marketplace?: PageMarketplace;
}

export interface RegistryRecord {
  merchantId: string;
  legalName: string;
  brandNames: string[];
  domain: string;
  city?: string;
  country?: string;
  status: 'verified' | 'pending' | 'revoked';
  linkedBrandIds?: string[];
}

export interface SectionResult {
  found: boolean;
  url?: string;
  text?: string;
  legalName?: string;
  address?: string;
  registrationNo?: string;
}

export interface OfferSummary {
  offerCount: number;
  medianPrice?: number;
  minPrice?: number;
  currency?: string;
  sampleDomains: string[];
}

export interface SignalsPort {
  getPageClaims(url: string, options: CallOpts): Promise<PageClaims>;
  getDomainReport(domain: string, options: CallOpts): Promise<Evidence[]>;
  getPriceReport(
    input: {
      claims: PageClaims;
      items?: InvestigationRequest['items'];
      amount?: number;
      currency?: string;
    },
    options: CallOpts
  ): Promise<Evidence[]>;
  checkPayeeBinding(
    input: { domain: string; payee?: InvestigationRequest['payee']; claimedBrand?: string },
    options: CallOpts
  ): Promise<Evidence[]>;
  fetchPageSection(input: { baseUrl: string; hint: SectionHint }, options: CallOpts): Promise<SectionResult>;
  compareOffers(
    input: { productQuery: string; maxPrice?: number },
    options: CallOpts
  ): Promise<OfferSummary>;
}

export interface RegistryLookup {
  by: 'name' | 'domain' | 'merchantId';
  query: string;
}

export interface RegistryPort {
  /** Returns at most five records. */
  lookup(input: RegistryLookup, options: CallOpts): Promise<RegistryRecord[]>;
}

export type MemoryMatchType = 'exact_payee' | 'exact_domain' | 'semantic';

export interface MemoryQuery {
  patternText: string;
  registrableDomain: string;
  payeeMerchantId?: string;
}

export interface MemoryHit {
  id: string;
  matchType: MemoryMatchType;
  patternText: string;
  decision: Decision;
  riskScore: number;
  seed: boolean;
  score?: number;
  /** exact, embedding or lexical retrieval used for this hit. */
  retrieval?: string;
  embeddingProvider?: string;
}

export interface MemoryDocument {
  id?: string;
  patternText: string;
  domain: string;
  registrableDomain: string;
  payeeMerchantId?: string;
  decision: Decision;
  riskScore: number;
  evidenceTypes: string[];
  domainAgeBucket: string;
  discountBucket: string;
  seed?: boolean;
}

export interface MemoryPort {
  search(query: MemoryQuery, options: CallOpts): Promise<MemoryHit[]>;
  write(document: MemoryDocument, options: CallOpts): Promise<void>;
}

export interface AgentDeps {
  signals: SignalsPort;
  registry: RegistryPort;
  /** Optional: without it the agent uses deterministic fallbacks only. */
  llm?: LlmClient;
  /** Optional: without it memory search and write are skipped. */
  memory?: MemoryPort;
  now: () => number;
  log: (event: Record<string, unknown>) => void;
}

export type AgentLogger = AgentDeps['log'];
