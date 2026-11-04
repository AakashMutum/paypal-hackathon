import {
  buildPatternFacts,
  runInvestigatorAgentDetailed,
  templatePatternSentence,
  type AgentResult,
  type Evidence,
  type InvestigationRequest,
} from '@checkout-guardian/agent';
import { recognizeMarketplace } from '@checkout-guardian/signals';
import { findCatalogStore, hostOf, type CatalogStore } from '../../config/storeCatalog.js';
import { normalizeMerchantUrl } from '../../validation/url.js';
import type {
  FrontendEvidence,
  FrontendInvestigation,
  Provenance,
  SignalAvailability,
  SimilarCase,
  UiVerdict,
} from '../investigation/investigation.types.js';
import {
  createAgentWiring,
  isCanonicalDomain,
  llmInfo,
  memoryInfo,
  searchMemory,
  signalsMode,
  type MemoryInfo,
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

const UNKNOWN_PRODUCT_NAME = 'Unknown product';

export function findProfileForUrlOrStore(input: string): MerchantProfile {
  const store = findCatalogStore(input);
  if (store) return profileFromCatalog(store);
  const domain = hostOf(input) || 'unknown.example';
  const brand = (domain.replace(/^www\./, '').split('.')[0].split('-')[0] || 'Merchant').replace(/^./, (c) => c.toUpperCase());
  return {
    known: false,
    domain,
    brand,
    product: UNKNOWN_PRODUCT_NAME,
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

function provenanceFor(
  domain: string,
  memory: MemoryInfo,
  modelBudget?: Provenance['modelBudget'],
): Provenance {
  const configured = signalsMode();
  const signals = configured === 'live' ? 'live' : configured === 'auto' ? (isCanonicalDomain(domain) ? 'replay' : 'live') : 'replay';
  const llm = llmInfo();
  return {
    signals,
    llm: llm.mode,
    llmProvider: llm.provider,
    llmModel: llm.models.fast[0],
    llmModels: llm.models,
    llmKeySource: llm.keySource,
    ...(llm.error ? { llmError: llm.error } : {}),
    memory: memory.mode,
    memoryPersistent: memory.persistent,
    embeddings: memory.embeddings,
    signalsMode: configured,
    ...(modelBudget ? { modelBudget } : {}),
  };
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

  const relevance = new Map(
    (result.explanation?.retrievedCases ?? []).map((entry) => [entry.caseId, entry.relevance]),
  );
  const similarCases: SimilarCase[] = hits.slice(0, 3).map((h) => ({
    caseId: h.id,
    patternSentence: h.patternText,
    matchType: h.matchType,
    score: Number((h.score ?? 0).toFixed(3)),
    decision: h.decision,
    ...(h.retrieval ? { retrieval: h.retrieval } : {}),
    ...(h.embeddingProvider ? { retrieval: `${h.retrieval ?? 'semantic'} (${h.embeddingProvider})` } : {}),
    relevance:
      relevance.get(h.id) ??
      `Retrieved as a ${h.matchType.replace(/_/g, ' ')} match with similarity ${Number((h.score ?? 0).toFixed(2))}; historical context only, not used to change the decision.`,
  }));

  return { result, similarCases, provenance: provenanceFor(domain, await memoryInfo(), result.stats.modelBudget) };
}

// ---------------------------------------------------------------------------------------------
// Mapping to the web app's shape
// ---------------------------------------------------------------------------------------------

type NodeId = FrontendEvidence['node'];

const NODE_FOR_TYPE: Record<string, NodeId> = {
  DOMAIN_AGE: 'SURFACE',
  TLS_INVALID: 'SURFACE',
  TLS_VALID: 'SURFACE',
  LOOKALIKE_DOMAIN: 'SURFACE',
  INJECTION_ATTEMPT: 'SURFACE',
  PAGE_SECTION_CLAIMS: 'SURFACE',
  CONTACT_LEGAL_MISSING: 'SURFACE',
  FAVICON_MISMATCH: 'SURFACE',
  FAVICON_OBSERVED: 'SURFACE',
  PROMOTIONAL_LANGUAGE: 'SURFACE',
  IMAGE_REUSE: 'SURFACE',
  TOOL_UNAVAILABLE: 'SURFACE',
  AGENT_ERROR: 'SURFACE',
  INVESTIGATION_NOTE: 'SURFACE',
  REGISTRY_RECORD: 'MERCHANT',
  REGISTRY_EMPTY: 'MERCHANT',
  SITE_NAME: 'MERCHANT',
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
  MERCHANT_RECOGNIZED: 'MERCHANT',
  PAGE_BLOCKED: 'SURFACE',
  PAGE_UNAVAILABLE: 'SURFACE',
  PAGE_EMPTY: 'SURFACE',
  PRODUCT_METADATA: 'PRICE',
  PRODUCT_DATA_UNAVAILABLE: 'PRICE',
};

function nodeForEvidence(entry: Evidence): NodeId {
  if (entry.type !== 'TOOL_UNAVAILABLE') return NODE_FOR_TYPE[entry.type] ?? 'SURFACE';
  const tool = String(entry.data?.tool ?? '').toLowerCase();
  if (tool.includes('binding')) return 'PAYEE';
  if (tool.includes('payee') || tool.includes('registry')) return 'MERCHANT';
  if (tool.includes('price') || tool.includes('offer') || tool.includes('catalogue')) return 'PRICE';
  return 'SURFACE';
}

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

interface EmptyCard {
  reason: string;
  badge: string;
}

function cardFor(node: NodeId, items: Evidence[], empty: EmptyCard): FrontendEvidence {
  const worst = items.reduce((m, e) => Math.max(m, SEVERITY_RANK[e.severity]), -1);
  const status: FrontendEvidence['status'] = items.length === 0 ? 'WARN' : worst >= 3 ? 'FAIL' : worst >= 1 ? 'WARN' : 'PASS';
  const confidence = items.length ? Math.round((items.reduce((s, e) => s + e.confidence, 0) / items.length) * 100) : 0;
  return {
    id: `e-${node.toLowerCase()}`,
    node,
    title: NODE_TITLE[node],
    status,
    badge: items.length === 0 ? empty.badge : status === 'PASS' ? 'CHECKED' : status === 'FAIL' ? 'FLAGGED' : 'REVIEW',
    confidence,
    fields: items.length
      ? items.map((e) => ({ label: humanize(e.type), value: e.summary, flag: e.severity === 'high' || e.severity === 'medium' }))
      : [{ label: 'Reason', value: empty.reason, flag: false }],
    sources: [...new Set(items.map((e) => e.source))],
  };
}

function pageFailureReason(evidence: Evidence): string {
  const failure = evidence;
  if (failure.type === 'PAGE_BLOCKED') return failure.summary;
  if (failure.type === 'PAGE_UNAVAILABLE') return failure.summary;
  return 'The merchant page returned no readable content, so the product offer could not be checked.';
}

function surfaceEmptyReason(pageFailure: Evidence | undefined, provenance: Provenance): string {
  if (pageFailure) return pageFailureReason(pageFailure);
  if (provenance.signals === 'replay') {
    return 'This API is replaying recorded signals and has no recording for this domain. Set SIGNALS_MODE=live or auto for a live scan.';
  }
  return 'No storefront evidence was collected for this domain.';
}

function hasUnavailableTool(evidence: readonly Evidence[], needle: string): boolean {
  return evidence.some(
    (entry) =>
      entry.type === 'TOOL_UNAVAILABLE' &&
      String(entry.data?.tool ?? '').toLowerCase().includes(needle),
  );
}

function computeSignalAvailability(
  evidence: readonly Evidence[],
  pageFailure: Evidence | undefined,
  payeeProvided: boolean,
): SignalAvailability {
  const page: SignalAvailability['page'] =
    pageFailure?.type === 'PAGE_BLOCKED'
      ? 'blocked'
      : pageFailure?.type === 'PAGE_UNAVAILABLE'
        ? 'unavailable'
        : pageFailure?.type === 'PAGE_EMPTY'
          ? 'empty'
          : evidence.some((entry) =>
                ['SITE_NAME', 'PRODUCT_METADATA', 'PAGE_SECTION_CLAIMS', 'CONTACT_LEGAL_MISSING'].includes(entry.type),
              )
            ? 'ok'
            : hasUnavailableTool(evidence, 'page')
              ? 'unavailable'
              : 'not_checked';

  const domainAge: SignalAvailability['domainAge'] = evidence.some((entry) => entry.type === 'DOMAIN_AGE')
    ? 'known'
    : hasUnavailableTool(evidence, 'domain age')
      ? 'unavailable'
      : 'not_checked';

  const registry: SignalAvailability['registry'] = evidence.some((entry) => entry.type === 'REGISTRY_RECORD')
    ? 'found'
    : evidence.some((entry) => entry.type === 'REGISTRY_EMPTY')
      ? 'empty'
      : hasUnavailableTool(evidence, 'payee') || hasUnavailableTool(evidence, 'registry')
        ? 'unavailable'
        : 'not_checked';

  const price: SignalAvailability['price'] = evidence.some((entry) => entry.type === 'PRICE_DEVIATION')
    ? 'known'
    : evidence.some(
          (entry) => entry.type === 'PRODUCT_METADATA' && typeof entry.data?.price === 'number',
        )
      ? 'known'
      : evidence.some((entry) => entry.type === 'PRICE_UNKNOWN')
        ? 'unavailable'
        : 'not_checked';

  const tls: SignalAvailability['tls'] = evidence.some((entry) => entry.type === 'TLS_VALID')
    ? 'valid'
    : evidence.some((entry) => entry.type === 'TLS_INVALID')
      ? 'invalid'
      : hasUnavailableTool(evidence, 'certificate')
        ? 'unavailable'
        : 'not_checked';

  return {
    page,
    domainAge,
    registry,
    price,
    tls,
    payee: payeeProvided ? 'provided' : 'not_provided',
    registrarReputation: 'not_assessed',
  };
}

function priceEmptyReason(priceUnknown: Evidence | undefined, provenance: Provenance): string {
  const reason = typeof priceUnknown?.data?.reason === 'string' ? priceUnknown.data.reason : undefined;
  switch (reason) {
    case 'no_catalogue':
      return 'No product catalogue was configured, so no comparable price could be checked.';
    case 'no_price':
      return 'No product price was supplied or found in the page structured metadata.';
    case 'no_product':
      return 'No product name was available for a price comparison.';
    case 'no_offers':
      return 'No comparable offers were found for this product.';
    case 'no_recorded_signals':
    case 'replay_mode':
      return 'This API is replaying recorded signals and has no price recording for this domain.';
    default:
      return provenance.signals === 'replay'
        ? 'Price signals were not collected because the API is replaying recorded signals.'
        : 'No pricing evidence was collected for this merchant.';
  }
}

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

export interface MapMeta {
  id?: string;
  orderId?: string;
  paypalOrderId?: string;
  buyerEmail?: string;
  profile: MerchantProfile;
  price: number | null;
  benchmark: number | null;
  currency: string;
  productName: string;
  claimedBrand: string;
  registryChecked: boolean;
  payeeProvided: boolean;
  payeeName: string | null;
  payeeId: string | null;
  payeeTier: string | null;
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
  const addReason = (text: string, first: boolean): void => {
    if (!text || reasons.includes(text)) return;
    if (first) reasons.unshift(text);
    else reasons.push(text);
  };

  const pageFailure = evidence.find(
    (e) => e.type === 'PAGE_BLOCKED' || e.type === 'PAGE_UNAVAILABLE' || e.type === 'PAGE_EMPTY',
  );
  const priceUnknown = evidence.find((e) => e.type === 'PRICE_UNKNOWN');
  const recognized = evidence.find((e) => e.type === 'MERCHANT_RECOGNIZED');
  const pageUnavailable = Boolean(pageFailure);

  const hasGroundingEvidence = evidence.some(
    (e) => e.deterministic && (e.type === 'DOMAIN_AGE' || (e.type === 'PAYEE_BINDING' && e.data?.status === 'MATCH')),
  );
  const wasAllow = verdict.decision === 'ALLOW' && !payeeMismatch;
  let decision: UiVerdict = verdict.decision;
  if (payeeMismatch) decision = 'PAUSE';
  // An ALLOW explanation cannot be reused after the result is downgraded: it would say the
  // identity, age and price are consistent when they were not verified.
  if (wasAllow && (pageUnavailable || !hasGroundingEvidence)) reasons.length = 0;
  // A page that could not be read cannot clear the offer. This is a warning, never a fraud
  // finding: missing product data is not evidence of dishonesty.
  if (decision === 'ALLOW' && pageUnavailable) decision = 'WARN';
  if (pageUnavailable && pageFailure) addReason(pageFailureReason(pageFailure), decision !== 'PAUSE');
  if (decision === 'ALLOW' && !hasGroundingEvidence) {
    decision = 'WARN';
    addReason(
      provenance.signals === 'replay'
        ? 'No live signals were available for this domain, so it could not be cleared. Unknown domains need live signals.'
        : 'Not enough evidence was collected to clear this merchant.',
      true,
    );
  }
  if (!meta.payeeProvided && decision !== 'PAUSE') {
    addReason(
      'No PayPal payee was supplied, so this is a merchant-level scan only; the receiving account was not checked.',
      decision === 'ALLOW',
    );
  }

  const byNode = new Map<NodeId, Evidence[]>();
  for (const e of evidence) {
    const node = nodeForEvidence(e);
    byNode.set(node, [...(byNode.get(node) ?? []), e]);
  }
  const cards = (['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'] as NodeId[]).map((n) => {
    const items = byNode.get(n) ?? [];
    const empty: EmptyCard =
      n === 'SURFACE'
        ? {
            reason: surfaceEmptyReason(pageFailure, provenance),
            badge: pageFailure?.type === 'PAGE_BLOCKED' ? 'BLOCKED' : 'NOT CHECKED',
          }
        : n === 'MERCHANT'
          ? {
              reason: recognized?.summary ?? 'No merchant registry evidence was collected.',
              badge: recognized ? 'IDENTIFIED' : 'NOT CHECKED',
            }
          : n === 'PRICE'
            ? {
                reason: priceEmptyReason(priceUnknown, provenance),
                badge: 'NOT CHECKED',
              }
            : {
                reason: 'No payment account was supplied, so the payee could not be checked.',
                badge: 'NO PAYEE',
              };
    return cardFor(n, items, empty);
  });

  const age = evidence.find((e) => e.type === 'DOMAIN_AGE');
  const price = evidence.find((e) => e.type === 'PRICE_DEVIATION');
  const registryCount = new Set(
    evidence
      .filter((e) => e.type === 'REGISTRY_RECORD')
      .map((e) => String(e.data?.merchantId ?? e.id)),
  ).size;
  const p = meta.profile;
  const rawConfidence = Math.round(verdict.confidence * 1000) / 10;
  const downgraded = wasAllow && decision === 'WARN';
  const needsPageCap = (downgraded || pageUnavailable) && decision !== 'PAUSE';
  const needsPayeeCap = !meta.payeeProvided && decision !== 'PAUSE';
  const confidence = Math.min(rawConfidence, needsPageCap ? 60 : 100, needsPayeeCap ? 80 : 100);
  const productEvidence = evidence.find((e) => e.type === 'PRODUCT_METADATA');
  const extractedProductName =
    typeof productEvidence?.data?.name === 'string' ? productEvidence.data.name : undefined;
  const productName =
    meta.productName === UNKNOWN_PRODUCT_NAME && extractedProductName
      ? extractedProductName
      : meta.productName;
  const siteNameEvidence = evidence.find((e) => e.type === 'SITE_NAME');
  const pageName =
    typeof siteNameEvidence?.data?.siteName === 'string' ? siteNameEvidence.data.siteName : undefined;
  const claimedBrand = meta.claimedBrand || pageName || 'Not claimed';
  const domainAgeDays = num(age?.data?.ageDays) ?? null;
  const registryRecords = meta.registryChecked ? registryCount : null;
  const confidenceReason = pageUnavailable
    ? 'Confidence capped at 60% because the merchant page could not be read.'
    : downgraded
      ? 'Confidence capped at 60% because the domain-level checks did not provide enough grounding to clear the merchant.'
      : needsPayeeCap
        ? 'Confidence capped at 80% because no PayPal payee was supplied; the receiving account was not checked.'
        : provenance.signals === 'replay'
          ? 'Replay mode: recorded signals were used for this domain.'
          : undefined;
  const signalAvailability = computeSignalAvailability(evidence, pageFailure, meta.payeeProvided);

  return {
    id: meta.id || `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    orderId: meta.orderId,
    paypalOrderId: meta.paypalOrderId,
    storeId: p.storeId,
    domain: p.domain,
    claimedBrand,
    productName,
    price: meta.price,
    benchmark: num(price?.data?.medianPrice) ?? meta.benchmark,
    currency: meta.currency,
    payeeName: meta.payeeName,
    payeeId: meta.payeeId,
    payeeTier: meta.payeeTier,
    domainAgeDays,
    registryRecords,
    riskScore: verdict.score,
    confidence,
    ...(confidenceReason ? { confidenceReason } : {}),
    signalAvailability,
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
  const normalizedUrl = normalizeMerchantUrl(params.url || profile.domain);
  const merchantUrl = normalizedUrl ?? `https://${profile.domain}`;
  const domain = hostOf(merchantUrl) || profile.domain;
  const marketplace = recognizeMarketplace(domain);
  const currency = (params.currency || 'USD').toUpperCase();
  const price = params.amount ?? (profile.known ? profile.price : null);
  const benchmark = params.benchmark ?? (profile.known ? profile.benchmark : null);
  const productName = params.productName || (profile.known ? profile.product : UNKNOWN_PRODUCT_NAME);
  const claimedBrand =
    params.claimedBrand || (profile.known ? profile.brand : marketplace?.displayName);
  // A known demo store brings its own payee; an unknown store has none unless the caller names one.
  const named = params.payeeMerchantId && params.payeeMerchantId !== 'UNKNOWN' ? params.payeeMerchantId : undefined;
  const payeeMerchantId = named ?? (profile.known ? profile.payeeId : undefined);
  const payeeEmail = params.payeeEmail ?? (profile.known && !named ? profile.payeeEmail : undefined);

  const request: InvestigationRequest = {
    orderId: params.orderId || `ORD-PREVIEW-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    merchantUrl,
    ...(claimedBrand ? { claimedBrand } : {}),
    ...(price !== null && price > 0
      ? { transactionAmount: price, items: [{ name: productName, unitPrice: price, quantity: 1 }] }
      : {}),
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
    benchmark,
    currency,
    productName,
    claimedBrand: claimedBrand ?? '',
    registryChecked: Boolean(payeeMerchantId),
    payeeProvided: Boolean(payeeMerchantId),
    payeeName: payeeMerchantId ? (profile.known ? profile.payeeName : null) : null,
    payeeId: payeeMerchantId ?? null,
    payeeTier: payeeMerchantId ? (profile.known ? profile.payeeTier : null) : null,
    payeeEmail,
  });
}
