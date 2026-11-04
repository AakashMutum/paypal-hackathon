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

/** Result of a bounded, SSRF-safe check of a linked contact or legal page. */
export interface SectionValidation {
  url: string;
  reachable: boolean;
  status?: number;
  contentType?: string;
  meaningful: boolean;
  reason?: string;
}

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
  source: 'json-ld' | 'opengraph' | 'microdata' | 'metadata' | 'title';
}

export interface PageMarketplace {
  id: string;
  displayName: string;
  officialDomain: string;
  region?: string;
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
  hasContactPage: boolean;
  hasLegalPage: boolean;
  contactValidation?: SectionValidation;
  legalValidation?: SectionValidation;
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
  /** Provenance of a registry record, for example local or a corporate provider. */
  source?: string;
  fetchedAt?: string;
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
  /** Where the offers came from. */
  source?: 'channel3' | 'fixture' | 'history';
  /** Provider/client identifier for provenance. */
  provider?: string;
  /** When the provider response was received. */
  fetchedAt?: string;
  /** Historical norms are only present when a genuine history source supplied them. */
  history?: 'available' | 'unavailable';
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
