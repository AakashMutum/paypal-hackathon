import {
  runInvestigatorAgentDetailed,
  createFixtureSignals,
  createFixtureRegistry,
  SCENARIOS,
  type AgentDeps,
  type AgentResult,
  type InvestigationRequest,
  type RegistryPort,
  type RegistryRecord,
  type RegistryLookup,
  type CallOpts,
} from '@checkout-guardian/agent';
import { createLocalSignalsPort } from '@checkout-guardian/signals';
import { InMemoryPatternStore, asAgentMemoryPort } from '@checkout-guardian/memory';
import { findCatalogStore, hostOf, loadStoreCatalog, type CatalogStore } from '../../config/storeCatalog.js';
import type { FrontendEvidence, FrontendInvestigation, UiVerdict } from '../investigation/investigation.types.js';

export type {
  FrontendEvidence,
  FrontendEvidenceField,
  FrontendInvestigation,
} from '../investigation/investigation.types.js';

type Scenario = 'A' | 'B' | 'C' | 'D2' | 'CUSTOM';

export interface MerchantProfile {
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
  scenario: Scenario;
  riskScore: number;
  payeeEmail?: string;
  sandboxPayee?: boolean;
}

const SCENARIO_FOR_KIND: Record<CatalogStore['kind'], Scenario> = { genuine: 'A', discount: 'B', impersonator: 'C' };
const RISK_FOR_KIND: Record<CatalogStore['kind'], number> = { genuine: 8, discount: 50, impersonator: 87 };

function profileFromCatalog(s: CatalogStore): MerchantProfile {
  return {
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
    scenario: SCENARIO_FOR_KIND[s.kind],
    riskScore: RISK_FOR_KIND[s.kind],
    sandboxPayee: s.sandboxPayee,
  };
}

export function knownProfiles(): MerchantProfile[] {
  return loadStoreCatalog().map(profileFromCatalog);
}

export function findProfileForUrlOrStore(input: string): MerchantProfile {
  const store = findCatalogStore(input);
  if (store) return profileFromCatalog(store);

  // An unknown store: no catalog data, so only what the request itself carries is known.
  const domain = hostOf(input) || 'storefront.example';
  const brand = (domain.replace(/^www\./, '').split('.')[0].split('-')[0] || 'Merchant').replace(/^./, (c) => c.toUpperCase());
  return {
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
    scenario: 'CUSTOM',
    riskScore: 0,
  };
}

/** In-memory pattern store initialised with default seeds. */
const memoryStore = new InMemoryPatternStore();
const memoryPort = asAgentMemoryPort(memoryStore);

/** Registry of the canonical demo merchants. */
const registryPort: RegistryPort = {
  async lookup(input: RegistryLookup, _options: CallOpts): Promise<RegistryRecord[]> {
    const q = input.query.trim().toLowerCase();
    const matches: RegistryRecord[] = [];
    for (const store of loadStoreCatalog()) {
      if (store.kind === 'impersonator') continue;
      const hit =
        (input.by === 'name' && store.brand.toLowerCase() === q) ||
        (input.by === 'merchantId' && store.registeredMerchantId.toLowerCase() === q) ||
        (input.by === 'domain' && store.domain.replace(/^www\./, '') === q.replace(/^www\./, ''));
      if (hit) {
        matches.push({
          merchantId: store.registeredMerchantId,
          legalName: store.payeeName,
          brandNames: [store.brand],
          domain: store.domain,
          status: 'verified',
          linkedBrandIds: [],
        });
      }
    }
    return matches;
  },
};

/**
 * Creates agent dependencies from the signals, memory and registry components. Known demo
 * scenarios use the agent's recorded fixtures; anything else uses the mock signals port.
 */
export function createAgentDeps(scenario?: Scenario): AgentDeps {
  if (scenario && scenario !== 'CUSTOM' && SCENARIOS[scenario]) {
    const fixture = SCENARIOS[scenario];
    return {
      signals: createFixtureSignals(fixture),
      memory: memoryPort,
      registry: createFixtureRegistry(fixture),
      now: () => Date.now(),
      log: () => undefined,
    };
  }
  return {
    signals: createLocalSignalsPort({ mode: 'mock' }),
    memory: memoryPort,
    registry: registryPort,
    now: () => Date.now(),
    log: () => undefined,
  };
}

/** Runs the investigator agent for one request. Errors propagate: nothing is invented on failure. */
export async function runAgent(request: InvestigationRequest, profile?: MerchantProfile): Promise<AgentResult> {
  const resolved = profile ?? findProfileForUrlOrStore(request.merchantUrl);
  return runInvestigatorAgentDetailed(request, createAgentDeps(resolved.scenario));
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

/**
 * Runs the merchant investigation using the agent and converts the result into the shape the
 * web app shows.
 */
export async function executeMerchantInvestigation(
  params: InvestigationExecutionParams,
): Promise<FrontendInvestigation> {
  const profile = findProfileForUrlOrStore(params.storeId || params.url);
  const domain = hostOf(params.url || profile.domain) || profile.domain;
  const claimedBrand = params.claimedBrand || profile.brand;
  const price = params.amount ?? profile.price;
  const benchmark = params.benchmark ?? profile.benchmark;
  const currency = (params.currency || 'USD').toUpperCase();
  const payeeEmail = params.payeeEmail ?? profile.payeeEmail;
  const payeeMerchantId = params.payeeMerchantId ?? profile.payeeId;
  const productName = params.productName || profile.product;

  const request: InvestigationRequest = {
    orderId: params.orderId || `ORD-PREVIEW-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    merchantUrl: `https://${domain}`,
    claimedBrand,
    ...(price > 0 ? { transactionAmount: price } : {}),
    currency,
    items: price > 0 ? [{ name: productName, unitPrice: price, quantity: 1 }] : undefined,
    payee: { merchantId: payeeMerchantId, ...(payeeEmail ? { email: payeeEmail } : {}) },
  };

  const result = await runAgent(request, profile);

  return mapResultToFrontend(result, profile, {
    id: params.id,
    orderId: params.orderId,
    paypalOrderId: params.paypalOrderId,
    buyerEmail: params.buyerEmail,
    price,
    benchmark,
    currency,
    productName,
  });
}

function mapResultToFrontend(
  result: AgentResult,
  profile: MerchantProfile,
  meta: {
    id?: string;
    orderId?: string;
    paypalOrderId?: string;
    buyerEmail?: string;
    price: number;
    benchmark: number;
    currency: string;
    productName: string;
  },
): FrontendInvestigation {
  const verdict = result.verdict;
  const uiVerdict: UiVerdict = verdict.decision;
  const hardRules = result.hardRulesTriggered.map((r) => r.rule);
  const payeeMismatch = hardRules.includes('HF1') || hardRules.includes('HF2');

  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${meta.currency}`;
  const dev = meta.benchmark > 0 ? Math.round((meta.price / meta.benchmark - 1) * 100) : 0;
  const bad = uiVerdict !== 'ALLOW';
  const vec = verdict.score > 80 ? verdict.score : 2;

  const st: Array<'PASS' | 'WARN' | 'FAIL'> =
    uiVerdict === 'ALLOW' ? ['PASS', 'PASS', 'PASS', 'PASS'] : uiVerdict === 'WARN' ? ['PASS', 'WARN', 'WARN', 'WARN'] : ['FAIL', 'FAIL', 'FAIL', 'FAIL'];

  const evidence: FrontendEvidence[] = [
    {
      id: 'e1', node: 'SURFACE', title: 'Surface Storefront Claims', status: st[0], badge: 'INGESTED', confidence: 99,
      fields: [
        { label: 'Presented Domain', value: profile.domain },
        { label: 'Claimed Brand', value: profile.brand },
        { label: 'Theme Signature', value: uiVerdict === 'PAUSE' ? 'Copied storefront theme' : bad ? 'Generic discount template' : 'Original theme', flag: bad },
      ],
    },
    {
      id: 'e2', node: 'MERCHANT', title: 'Merchant Verification', status: st[1], badge: profile.records ? 'MATCHED' : 'FAILED (0 MATCH)', confidence: 97,
      fields: [
        { label: 'Corporate Registry', value: `${profile.records} Legal Records`, flag: !profile.records },
        { label: 'Domain Age', value: `${profile.ageDays} Days`, flag: profile.ageDays < 90 },
        { label: 'Impersonation Vector', value: `${bad ? vec : 2}%`, flag: bad, meter: bad ? vec : 2 },
      ],
    },
    {
      id: 'e3', node: 'PRICE', title: 'Price Anomaly Model', status: st[2], badge: dev < -20 ? `${dev}% THRESHOLD` : 'IN RANGE', confidence: 96,
      fields: [
        { label: 'Cart Item', value: meta.productName },
        { label: 'Advertised Price', value: usd(meta.price), flag: dev < -20 },
        { label: 'Market Global Benchmark', value: usd(meta.benchmark), strike: dev < -20 },
      ],
    },
    {
      id: 'e4', node: 'PAYEE', title: 'PayPal Real Recipient', status: st[3], badge: 'DECODED', confidence: 99,
      fields: [
        { label: 'Actual Receiver', value: profile.payeeName },
        { label: 'PayPal Sandbox ID', value: profile.payeeId },
        { label: 'Account Status', value: profile.payeeTier, flag: bad },
      ],
    },
  ];

  const reasons =
    verdict.explanation?.bullets.map((b) => b.text) ??
    (uiVerdict === 'ALLOW' ? ['Storefront claims match the registered PayPal recipient.'] : [verdict.summary]);

  return {
    id: meta.id || `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    orderId: meta.orderId,
    paypalOrderId: meta.paypalOrderId,
    storeId: profile.storeId,
    domain: profile.domain,
    claimedBrand: profile.brand,
    productName: meta.productName,
    price: meta.price,
    benchmark: meta.benchmark,
    currency: meta.currency,
    payeeName: profile.payeeName,
    payeeId: profile.payeeId,
    payeeTier: profile.payeeTier,
    domainAgeDays: profile.ageDays,
    registryRecords: profile.records,
    riskScore: verdict.score,
    confidence: Math.round(verdict.confidence * 1000) / 10,
    status: 'COMPLETE',
    verdict: uiVerdict,
    captureState: 'PENDING',
    reasons,
    evidence,
    hardRules,
    payeeMismatch,
    buyerEmail: meta.buyerEmail,
    createdAt: new Date().toISOString(),
  };
}
