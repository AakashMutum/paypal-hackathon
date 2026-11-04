// Local mirrors of the investigation agent's shapes. They mirror packages/agent/src/ports.ts
// and packages/agent/src/types.ts. Keep them structurally identical to those files; a test
// loads the agent's scenario fixtures to catch drift.

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
  /** True only when the page is reachable, textual and contains a meaningful section body. */
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
  /** Present only when live section validation is enabled. Mere link presence is not verification. */
  contactValidation?: SectionValidation;
  legalValidation?: SectionValidation;
  screenshotUrl?: string;
  pageAccess?: PageAccess;
  product?: PageProduct;
  marketplace?: PageMarketplace;
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

export type AgentSeverity = 'info' | 'low' | 'medium' | 'high';
export type AgentEvidenceSource =
  | 'rdap'
  | 'tls'
  | 'kernel'
  | 'channel3'
  | 'registry'
  | 'paypal'
  | 'elastic'
  | 'llm'
  | 'rule';

export interface AgentEvidence {
  id: string;
  type: string;
  severity: AgentSeverity;
  confidence: number;
  summary: string;
  source: AgentEvidenceSource;
  deterministic: boolean;
  hardFail?: boolean;
  data?: Record<string, unknown>;
}

export interface OrderItemLike {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface PayeeLike {
  merchantId: string;
  email?: string;
}

/** Structurally the agent's SignalsPort (six methods). */
export interface AgentSignalsPort {
  getPageClaims(url: string, options: CallOpts): Promise<PageClaims>;
  getDomainReport(domain: string, options: CallOpts): Promise<AgentEvidence[]>;
  getPriceReport(
    input: { claims: PageClaims; items?: OrderItemLike[]; amount?: number; currency?: string },
    options: CallOpts,
  ): Promise<AgentEvidence[]>;
  checkPayeeBinding(
    input: { domain: string; payee?: PayeeLike; claimedBrand?: string },
    options: CallOpts,
  ): Promise<AgentEvidence[]>;
  fetchPageSection(input: { baseUrl: string; hint: SectionHint }, options: CallOpts): Promise<SectionResult>;
  compareOffers(input: { productQuery: string; maxPrice?: number }, options: CallOpts): Promise<OfferSummary>;
}

/** Plug-in point for the browser-based page scraper. Interface only; no implementation here. */
export interface KernelClient {
  getPageClaims(url: string, options: CallOpts): Promise<PageClaims>;
}

/** Plug-in point for the product catalogue lookup. Interface only; no implementation here. */
export interface Channel3Client {
  searchOffers(input: { productQuery: string; maxPrice?: number; currency?: string }, options: CallOpts): Promise<OfferSummary>;
}

export interface CertificateProbe {
  validFrom: string;
  validTo: string;
  issuer: string;
  daysToExpiry: number;
  authorized: boolean;
  authorizationError?: string;
}

export interface LocalSignalsPortOptions {
  mode: 'mock' | 'live';
  fetchImpl?: typeof fetch;
  lookupImpl?: (hostname: string) => Promise<string[]>;
  kernel?: KernelClient;
  channel3?: Channel3Client;
  /** Registrable domains of brands the lookalike check protects. */
  knownBrandDomains?: string[];
  /** Brand name to protect when the page claims do not name one. */
  claimedBrand?: string;
  now?: () => number;
  /** Inject the TLS probe (tests). Defaults to a real TLS handshake. */
  tlsProbe?: (hostname: string, address: string, timeoutMs: number) => Promise<CertificateProbe>;
  /** Directory of fixture JSON files for mock mode. Defaults to tests/fixtures at the repo root. */
  fixturesDir?: string;
  /** Validate linked contact/privacy/terms pages with bounded, SSRF-safe fetches. */
  validateSectionPages?: boolean;
}
