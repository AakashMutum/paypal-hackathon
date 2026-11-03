import {
  buildPatternFacts,
  runInvestigatorAgentDetailed,
  templatePatternSentence,
  type AgentResult,
  type Evidence,
  type InvestigationRequest,
} from '@checkout-guardian/agent';
import { findCatalogStore, hostOf, type CatalogStore } from '../../config/storeCatalog.js';
import type {
  FrontendEvidence,
  FrontendInvestigation,
  Provenance,
  SimilarCase,
  UiVerdict,
} from '../investigation/investigation.types.js';
import {
  createAgentWiring,
  isCanonicalDomain,
  llmMode,
  memoryMode,
  searchMemory,
  signalsMode,
} from './agentPorts.js';

export type {
  FrontendEvidence,
  FrontendEvidenceField,
  FrontendInvestigation,
} from '../investigation/investigation.types.js';

/** What the catalog (plain data) says about a store. Unknown stores have `known: false`. */
export interface MerchantProfile {
  known: boolean;
  storeId?: string;
  domain: string;
  brand: string;
  product: string;
  price: number;
  benchmark: number;
  payeeName: string;
  payeeId: string;
  payeeTier: string;
  ageDays: number;
  records: number;
  payeeEmail?: string;
  sandboxPayee?: boolean;
}

function profileFromCatalog(s: CatalogStore): MerchantProfile {
  return {
    known: true,
    storeId: s.storeId,
    domain: s.domain,
    brand: s.brand,
    product: s.product,
    price: s.price,
    benchmark: s.benchmark,
    payeeName: s.payeeName,
    payeeId: s.payeeMerchantId,
    payeeEmail: s.payeeEmail,
    payeeTier: s.payeeTier,
    ageDays: s.ageDays,
    records: s.registryRecords,
    sandboxPayee: s.sandboxPayee,
  };
}

export function findProfileForUrlOrStore(input: string): MerchantProfile {
  const store = findCatalogStore(input);
  if (store) return profileFromCatalog(store);
  const domain = hostOf(input) || 'unknown.example';
  const brand = (domain.replace(/^www\./, '').split('.')[0].split('-')[0] || 'Merchant').replace(/^./, (c) => c.toUpperCase());
  return {
    known: false,
    domain,
    brand,
    product: 'Storefront item',
    price: 0,
    benchmark: 0,
    payeeName: 'Unknown receiver',
    payeeId: 'UNKNOWN',
    payeeTier: 'Unknown',
    ageDays: 0,
    records: 0,
  };
}

// ---------------------------------------------------------------------------------------------
// Running the agent
// ---------------------------------------------------------------------------------------------

export interface AgentRun {
  result: AgentResult;
  similarCases: SimilarCase[];
  provenance: Provenance;
}

const RETRIEVAL_TIMEOUT_MS = 2000;

function provenanceFor(domain: string, memory: 'elastic' | 'memory'): Provenance {
  const configured = signalsMode();
  const signals = configured === 'live' ? 'live' : configured === 'auto' ? (isCanonicalDomain(domain) ? 'replay' : 'live') : 'replay';
  return { signals, llm: llmMode(), memory, signalsMode: configured };
}

/**
 * Runs the investigator agent with the configured ports. Errors propagate: nothing is invented
 * on failure. The top three similar past cases are attached for display; they are never an
 * input to the decision.
 */
export async function runAgent(request: InvestigationRequest): Promise<AgentRun> {
  const { deps, recorder } = await createAgentWiring();
  const result = await runInvestigatorAgentDetailed(request, deps);

  const domain = hostOf(request.merchantUrl);
  const registrable = domain.replace(/^www\./, '');
  let hits = recorder.searched ? recorder.hits : [];
  if (!recorder.searched) {
    // The agent skips memory on its fast path, so search here with the same query shape.
    hits = await searchMemory(
      {
        patternText: result.patternSentence ?? templatePatternSentence(buildPatternFacts(result.evidence)),
        registrableDomain: registrable,
        ...(request.payee?.merchantId ? { payeeMerchantId: request.payee.merchantId } : {}),
      },
      { timeoutMs: RETRIEVAL_TIMEOUT_MS },
    );
  }

  const similarCases: SimilarCase[] = hits.slice(0, 3).map((h) => ({
    patternSentence: h.patternText,
    matchType: h.matchType,
    score: Number((h.score ?? 0).toFixed(3)),
    decision: h.decision,
  }));

  return { result, similarCases, provenance: provenanceFor(domain, await memoryMode()) };
}

// ---------------------------------------------------------------------------------------------
// Mapping to the web app's shape
// ---------------------------------------------------------------------------------------------

type NodeId = FrontendEvidence['node'];

const NODE_FOR_TYPE: Record<string, NodeId> = {
  DOMAIN_AGE: 'SURFACE',
  TLS_INVALID: 'SURFACE',
  LOOKALIKE_DOMAIN: 'SURFACE',
  INJECTION_ATTEMPT: 'SURFACE',
  PAGE_SECTION_CLAIMS: 'SURFACE',
  CONTACT_LEGAL_MISSING: 'SURFACE',
  FAVICON_MISMATCH: 'SURFACE',
  IMAGE_REUSE: 'SURFACE',
  TOOL_UNAVAILABLE: 'SURFACE',
  AGENT_ERROR: 'SURFACE',
  INVESTIGATION_NOTE: 'SURFACE',
  REGISTRY_RECORD: 'MERCHANT',
  IDENTITY_MATCH: 'MERCHANT',
  IDENTITY_UNVERIFIABLE: 'MERCHANT',
  CLAIMED_BRAND_MISMATCH: 'MERCHANT',
  SCAM_MEMORY_MATCH: 'MERCHANT',
  PRICE_DEVIATION: 'PRICE',
  PRICE_UNKNOWN: 'PRICE',
  OFFER_COMPARISON: 'PRICE',
  PAYEE_BINDING: 'PAYEE',
  PAYEE_UNKNOWN: 'PAYEE',
  PAYEE_FREE_EMAIL: 'PAYEE',
};

const NODE_TITLE: Record<NodeId, string> = {
  SURFACE: 'Surface Storefront Claims',
  MERCHANT: 'Merchant Verification',
  PRICE: 'Price Anomaly Model',
  PAYEE: 'PayPal Real Recipient',
};

const humanize = (type: string): string =>
  type
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const SEVERITY_RANK: Record<Evidence['severity'], number> = { info: 0, low: 1, medium: 2, high: 3 };

function cardFor(node: NodeId, items: Evidence[]): FrontendEvidence {
  const worst = items.reduce((m, e) => Math.max(m, SEVERITY_RANK[e.severity]), -1);
  const status: FrontendEvidence['status'] = items.length === 0 ? 'WARN' : worst >= 3 ? 'FAIL' : worst >= 1 ? 'WARN' : 'PASS';
  const confidence = items.length ? Math.round((items.reduce((s, e) => s + e.confidence, 0) / items.length) * 100) : 0;
  return {
    id: `e-${node.toLowerCase()}`,
    node,
    title: NODE_TITLE[node],
    status,
    badge: items.length === 0 ? 'NO DATA' : status === 'PASS' ? 'CHECKED' : status === 'FAIL' ? 'FLAGGED' : 'REVIEW',
    confidence,
    fields: items.length
      ? items.map((e) => ({ label: humanize(e.type), value: e.summary, flag: e.severity === 'high' || e.severity === 'medium' }))
      : [{ label: 'Result', value: 'No evidence was collected for this check.', flag: true }],
    sources: [...new Set(items.map((e) => e.source))],
  };
}

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export interface MapMeta {
  id?: string;
  orderId?: string;
  paypalOrderId?: string;
  buyerEmail?: string;
  profile: MerchantProfile;
  price: number;
  benchmark: number;
  currency: string;
  productName: string;
  claimedBrand: string;
  payeeEmail?: string;
}

/**
 * Turns the agent's result into what the web app shows, using the agent's own evidence. Two
 * rules sit on top of the agent's decision: a payee-binding hard rule is always PAUSE, and an
 * ALLOW needs at least some deterministic evidence behind it.
 */
export function mapRunToFrontend(run: AgentRun, meta: MapMeta): FrontendInvestigation {
  const { result, provenance, similarCases } = run;
  const verdict = result.verdict;
  const hardRules = result.hardRulesTriggered.map((r) => r.rule);
  const payeeMismatch = hardRules.includes('HF1') || hardRules.includes('HF2');
  const evidence = result.evidence;

  const reasons = verdict.explanation?.bullets.map((b) => b.text) ?? [verdict.summary];

  const hasGroundingEvidence = evidence.some(
    (e) => e.deterministic && (e.type === 'DOMAIN_AGE' || (e.type === 'PAYEE_BINDING' && e.data?.status === 'MATCH')),
  );
  let decision: UiVerdict = verdict.decision;
  if (payeeMismatch) decision = 'PAUSE';
  if (decision === 'ALLOW' && !hasGroundingEvidence) {
    decision = 'WARN';
    reasons.unshift(
      provenance.signals === 'replay'
        ? 'No live signals were available for this domain, so it could not be cleared. Unknown domains need live signals.'
        : 'Not enough evidence was collected to clear this merchant.',
    );
  }

  const byNode = new Map<NodeId, Evidence[]>();
  for (const e of evidence) {
    const node = NODE_FOR_TYPE[e.type] ?? 'SURFACE';
    byNode.set(node, [...(byNode.get(node) ?? []), e]);
  }
  const cards = (['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'] as NodeId[]).map((n) => cardFor(n, byNode.get(n) ?? []));

  const age = evidence.find((e) => e.type === 'DOMAIN_AGE');
  const price = evidence.find((e) => e.type === 'PRICE_DEVIATION');
  const registryCount = evidence.filter((e) => e.type === 'REGISTRY_RECORD').length;
  const p = meta.profile;

  return {
    id: meta.id || `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    orderId: meta.orderId,
    paypalOrderId: meta.paypalOrderId,
    storeId: p.storeId,
    domain: p.domain,
    claimedBrand: meta.claimedBrand,
    productName: meta.productName,
    price: meta.price,
    benchmark: num(price?.data?.medianPrice) ?? meta.benchmark,
    currency: meta.currency,
    payeeName: p.payeeName,
    payeeId: p.payeeId,
    payeeTier: p.payeeTier,
    domainAgeDays: num(age?.data?.ageDays) ?? p.ageDays,
    registryRecords: registryCount || p.records,
    riskScore: verdict.score,
    confidence: Math.round(verdict.confidence * 1000) / 10,
    status: 'COMPLETE',
    verdict: decision,
    captureState: 'PENDING',
    reasons,
    evidence: cards,
    trace: result.trace,
    provenance,
    similarCases,
    ...(result.patternSentence ? { patternSentence: result.patternSentence } : {}),
    hardRules,
    payeeMismatch,
    buyerEmail: meta.buyerEmail,
    createdAt: new Date().toISOString(),
  };
}

export interface InvestigationExecutionParams {
  id?: string;
  orderId?: string;
  paypalOrderId?: string;
  storeId?: string;
  url: string;
  amount?: number;
  currency?: string;
  claimedBrand?: string;
  buyerEmail?: string;
  payeeEmail?: string;
  payeeMerchantId?: string;
  productName?: string;
  benchmark?: number;
}

/** Investigates a merchant with the real pipeline and returns the web app's shape. */
export async function executeMerchantInvestigation(params: InvestigationExecutionParams): Promise<FrontendInvestigation> {
  const profile = findProfileForUrlOrStore(params.storeId || params.url);
  const domain = hostOf(params.url || profile.domain) || profile.domain;
  const currency = (params.currency || 'USD').toUpperCase();
  const price = params.amount ?? profile.price;
  const productName = params.productName || profile.product;
  const claimedBrand = params.claimedBrand || (profile.known ? profile.brand : undefined);
  // A known demo store brings its own payee; an unknown store has none unless the caller names one.
  const named = params.payeeMerchantId && params.payeeMerchantId !== 'UNKNOWN' ? params.payeeMerchantId : undefined;
  const payeeMerchantId = named ?? (profile.known ? profile.payeeId : undefined);
  const payeeEmail = params.payeeEmail ?? (profile.known && !named ? profile.payeeEmail : undefined);

  const request: InvestigationRequest = {
    orderId: params.orderId || `ORD-PREVIEW-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    merchantUrl: `https://${domain}`,
    ...(claimedBrand ? { claimedBrand } : {}),
    ...(price > 0 ? { transactionAmount: price, items: [{ name: productName, unitPrice: price, quantity: 1 }] } : {}),
    currency,
    ...(payeeMerchantId ? { payee: { merchantId: payeeMerchantId, ...(payeeEmail ? { email: payeeEmail } : {}) } } : {}),
  };

  const run = await runAgent(request);
  return mapRunToFrontend(run, {
    id: params.id,
    orderId: params.orderId,
    paypalOrderId: params.paypalOrderId,
    buyerEmail: params.buyerEmail,
    profile: { ...profile, domain: profile.known ? profile.domain : domain },
    price,
    benchmark: params.benchmark ?? profile.benchmark,
    currency,
    productName,
    claimedBrand: claimedBrand ?? profile.brand,
    payeeEmail,
  });
}
