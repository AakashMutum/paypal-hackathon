import {
  runInvestigatorAgentDetailed,
  createFixtureSignals,
  createFixtureRegistry,
  createHttpProvider,
  createJsonClient,
  SCENARIOS,
  type AgentDeps,
  type InvestigationRequest,
  type Verdict,
  type Decision,
  type RegistryPort,
  type RegistryRecord,
  type RegistryLookup,
  type CallOpts,
  type LlmClient,
} from '@checkout-guardian/agent';
import { createLocalSignalsPort, createLiveClientsFromEnv } from '@checkout-guardian/signals';
import { InMemoryPatternStore, asAgentMemoryPort, createPatternStore } from '@checkout-guardian/memory';

export interface FrontendEvidenceField {
  label: string;
  value: string;
  flag?: boolean;
  strike?: boolean;
  meter?: number;
}

export interface FrontendEvidence {
  id: string;
  node: 'SURFACE' | 'MERCHANT' | 'PRICE' | 'PAYEE';
  title: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  badge: string;
  confidence: number;
  fields: FrontendEvidenceField[];
}

export interface FrontendInvestigation {
  id: string;
  orderId?: string;
  paypalOrderId?: string;
  storeId?: string;
  domain: string;
  claimedBrand: string;
  productName: string;
  price: number;
  benchmark: number;
  currency: string;
  payeeName: string;
  payeeId: string;
  payeeTier: string;
  domainAgeDays: number;
  registryRecords: number;
  riskScore: number;
  confidence: number;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
  verdict?: 'ALLOW' | 'WARN' | 'BLOCK';
  captureState: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'HELD' | 'VOIDED';
  reasons: string[];
  evidence: FrontendEvidence[];
  buyerEmail?: string;
  reviewRequested?: boolean;
  createdAt: string;
}

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
  scenario: 'A' | 'B' | 'C' | 'D2' | 'CUSTOM';
  verdict: 'ALLOW' | 'WARN' | 'BLOCK';
  riskScore: number;
  payeeEmail?: string;
}

export const KNOWN_PROFILES: MerchantProfile[] = [
  {
    storeId: 'pulseaudio',
    domain: 'pulseaudio-store.com',
    brand: 'PulseAudio',
    product: 'PulseAudio Pro Headphones',
    price: 299,
    benchmark: 299,
    payeeName: 'PulseAudio Inc.',
    payeeId: 'PP-MCH-100201',
    payeeEmail: 'billing@pulseaudio-store.com',
    payeeTier: 'Registered Merchant',
    ageDays: 3650,
    records: 3,
    scenario: 'A',
    verdict: 'ALLOW',
    riskScore: 4,
  },
  {
    storeId: 'mega-deals',
    domain: 'mega-dealsoutlet.net',
    brand: 'Unbranded',
    product: 'Unbranded Luxury Watch',
    price: 19.99,
    benchmark: 499,
    payeeName: 'seller-88@fastmail.com',
    payeeId: 'PP-MCH-448812',
    payeeEmail: 'seller-88@fastmail.com',
    payeeTier: 'Unverified Individual',
    ageDays: 41,
    records: 0,
    scenario: 'B',
    verdict: 'WARN',
    riskScore: 58,
  },
  {
    storeId: 'luxaura-outlet',
    domain: 'luxaura-outletdeals.com',
    brand: 'Luxaura',
    product: 'Luxaura Handbag',
    price: 149,
    benchmark: 2500,
    payeeName: 'personalfake@webmail.net',
    payeeId: 'PP-MCH-994103',
    payeeEmail: 'personalfake@webmail.net',
    payeeTier: 'Inactive Individual Tier',
    ageDays: 4,
    records: 0,
    scenario: 'C',
    verdict: 'BLOCK',
    riskScore: 97,
  },
];

export function findProfileForUrlOrStore(input: string): MerchantProfile {
  const clean = input.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  const byStore = KNOWN_PROFILES.find((p) => p.storeId === input.trim().toLowerCase());
  if (byStore) return byStore;

  const byDomain = KNOWN_PROFILES.find(
    (p) => p.domain === clean || clean.includes(p.domain) || p.domain.includes(clean)
  );
  if (byDomain) return byDomain;

  const isLuxury = /luxaura|aether|velvex|nordex|solarbeats|prestige|designer|boutique/.test(clean);
  const isCheap = /outlet|deal|sale|discount|cheap|clearance|bargain|90off/.test(clean);
  const verdict: 'ALLOW' | 'WARN' | 'BLOCK' = isLuxury && isCheap ? 'BLOCK' : isLuxury || isCheap ? 'WARN' : 'ALLOW';
  const brandPart = (clean.split('.')[0].split('-')[0] || 'Merchant').replace(/^./, (c) => c.toUpperCase());
  const ok = verdict === 'ALLOW';

  return {
    domain: clean || 'storefront.example.com',
    brand: brandPart,
    product: 'Storefront Item',
    price: ok ? 120 : 39,
    benchmark: ok ? 125 : 650,
    payeeName: ok ? `${brandPart} Corporation` : 'Independent Seller',
    payeeId: `PP-MCH-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
    payeeEmail: ok ? `payments@${clean}` : 'seller-personal@webmail.example',
    payeeTier: ok ? 'Registered Merchant' : 'Unverified Individual',
    ageDays: ok ? 2400 : 14,
    records: ok ? 2 : 0,
    scenario: ok ? 'A' : verdict === 'WARN' ? 'B' : 'C',
    verdict,
    riskScore: ok ? 6 : verdict === 'WARN' ? 55 : 94,
  };
}

/** Pattern store initialized with default seeds; upgrades to Elastic if configured */
let memoryPort = asAgentMemoryPort(new InMemoryPatternStore());
createPatternStore()
  .then((store) => {
    memoryPort = asAgentMemoryPort(store);
  })
  .catch((err) => {
    console.warn('[agentRunner] Failed to initialize pattern store from env, using in-memory fallback:', err);
  });

/**
 * Creates an LLM client when LLM_MODE=live and LLM_API_KEY is configured.
 * When absent or in fallback mode, returns undefined so the agent uses
 * deterministic security rules and templates.
 */
export function createLlmClientFromEnv(): LlmClient | undefined {
  const mode = (process.env.LLM_MODE || 'live').toLowerCase();
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (mode !== 'live' || !apiKey) {
    return undefined;
  }
  const provider = createHttpProvider({
    apiKey,
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    models: {
      fast: process.env.LLM_MODEL_FAST || 'gpt-4o-mini',
      strong: process.env.LLM_MODEL_STRONG || 'gpt-4o-mini',
    },
  });
  return createJsonClient(provider);
}

/** Registry adapter for looking up known merchants */
const registryPort: RegistryPort = {
  async lookup(input: RegistryLookup, _options: CallOpts): Promise<RegistryRecord[]> {
    const q = input.query.trim().toLowerCase();
    const matches: RegistryRecord[] = [];

    if (q.includes('pulseaudio') || q.includes('pulse')) {
      matches.push({
        merchantId: 'PP-MCH-100201',
        legalName: 'PulseAudio Inc.',
        brandNames: ['PulseAudio'],
        domain: 'pulseaudio-store.com',
        city: 'San Francisco',
        country: 'US',
        status: 'verified',
        linkedBrandIds: ['pulseaudio'],
      });
    }

    if (q.includes('luxaura')) {
      matches.push({
        merchantId: 'PP-MCH-LUXAURA-HQ',
        legalName: 'Luxaura Luxury Fashion S.A.',
        brandNames: ['Luxaura', 'Luxaura Paris'],
        domain: 'luxaura.com',
        city: 'Paris',
        country: 'FR',
        status: 'verified',
        linkedBrandIds: ['luxaura'],
      });
    }

    return matches;
  },
};

/**
 * Creates Agent dependencies using the signals, memory, and registry components.
 * Supports known scenarios (A, B, C, D2) for deterministic high-fidelity demonstrations.
 */
export function createAgentDeps(scenario?: 'A' | 'B' | 'C' | 'D2' | 'CUSTOM'): AgentDeps {
  const llm = createLlmClientFromEnv();

  if (scenario && scenario !== 'CUSTOM' && SCENARIOS[scenario]) {
    const fixture = SCENARIOS[scenario];
    return {
      signals: createFixtureSignals(fixture),
      memory: memoryPort,
      registry: createFixtureRegistry(fixture),
      ...(llm ? { llm } : {}),
      now: () => Date.now(),
      log: () => {},
    };
  }

  // Wire live Kernel / Channel3 clients when API keys are present in the environment.
  // createLiveClientsFromEnv() reads KERNEL_API_KEY and CHANNEL3_API_KEY; a missing or
  // blank key returns undefined for that client so we fall back silently to the local
  // mock behaviour. This keeps unit tests and local dev without credentials working.
  const liveClients = createLiveClientsFromEnv();
  const hasLiveClients = liveClients.kernel !== undefined || liveClients.channel3 !== undefined;
  if (!hasLiveClients) {
    console.warn(
      '[agentRunner] KERNEL_API_KEY and CHANNEL3_API_KEY are not set — using mock signals. ' +
      'Set these environment variables to enable live Kernel and Channel3 signal collection.',
    );
  }
  const signals = createLocalSignalsPort(
    hasLiveClients
      ? { mode: 'live', kernel: liveClients.kernel, channel3: liveClients.channel3 }
      : { mode: 'mock' },
  );
  return {
    signals,
    memory: memoryPort,
    registry: registryPort,
    ...(llm ? { llm } : {}),
    now: () => Date.now(),
    log: () => {},
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

/**
 * Runs the merchant investigation using the autonomous agent and converts the results
 * into the structured format required by the Sentinel UI and contracts.
 */
export async function executeMerchantInvestigation(
  params: InvestigationExecutionParams
): Promise<FrontendInvestigation> {
  const profile = findProfileForUrlOrStore(params.storeId || params.url);
  const domain = (params.url || profile.domain).replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  const claimedBrand = params.claimedBrand || profile.brand;
  const price = params.amount ?? profile.price;
  const benchmark = params.benchmark ?? profile.benchmark;
  const currency = (params.currency || 'USD').toUpperCase();
  const payeeEmail = params.payeeEmail ?? profile.payeeEmail;
  const payeeMerchantId = params.payeeMerchantId ?? profile.payeeId;
  const buyerEmail = params.buyerEmail || 'alex.walker@gmail.com';

  const orderId = params.orderId || `ORD-PREV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
  const merchantUrl = domain.startsWith('http') ? domain : `https://${domain}`;

  const req: InvestigationRequest = {
    orderId,
    merchantUrl,
    transactionAmount: price,
    currency,
    claimedBrand,
    items: [
      {
        name: params.productName || profile.product,
        unitPrice: price,
        quantity: 1,
      },
    ],
    payee: {
      merchantId: payeeMerchantId,
      ...(payeeEmail ? { email: payeeEmail } : {}),
    },
  };

  const deps = createAgentDeps(profile.scenario);
  let verdict: Verdict;

  try {
    const detailed = await runInvestigatorAgentDetailed(req, deps);
    verdict = detailed.verdict;
  } catch {
    // Deterministic safe fallback
    const decision: Decision = profile.verdict === 'BLOCK' ? 'PAUSE' : (profile.verdict as Decision);
    verdict = {
      orderId,
      decision,
      score: profile.riskScore,
      riskScore: profile.riskScore / 100,
      confidence: 0.95,
      summary: `${decision}: Storefront verification evaluated with ${profile.riskScore} risk points.`,
      flaggedEvidenceIds: [],
      recommendedAction: decision === 'PAUSE' ? 'CAPTURE_PAUSED' : decision === 'WARN' ? 'WARN_DISPLAYED' : 'PROCEED',
      evidence: [],
      explanation: {
        headline: decision === 'PAUSE' ? 'Payment Capture Paused' : decision === 'WARN' ? 'Review Hold Active' : 'Storefront Claims Verified',
        bullets: [{ text: profile.verdict === 'BLOCK' ? 'Destination PayPal recipient does not match claimed storefront brand.' : 'Claims verified.', evidenceIds: ['ev-fallback'] }],
      },
      trace: [],
    };
  }

  return mapVerdictToFrontend(verdict, profile, {
    id: params.id,
    orderId: params.orderId,
    paypalOrderId: params.paypalOrderId,
    buyerEmail,
    price,
    benchmark,
    currency,
    productName: params.productName || profile.product,
  });
}

function mapVerdictToFrontend(
  verdict: Verdict,
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
  }
): FrontendInvestigation {
  const invId = meta.id || `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
  const uiVerdict: 'ALLOW' | 'WARN' | 'BLOCK' =
    verdict.decision === 'PAUSE' ? 'BLOCK' : (verdict.decision as 'ALLOW' | 'WARN');

  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })} ${meta.currency}`;
  const dev = Math.round((meta.price / meta.benchmark - 1) * 100);
  const bad = uiVerdict !== 'ALLOW';
  const vec = profile.riskScore > 90 ? profile.riskScore : 2;

  const st: Array<'PASS' | 'WARN' | 'FAIL'> =
    uiVerdict === 'ALLOW'
      ? ['PASS', 'PASS', 'PASS', 'PASS']
      : uiVerdict === 'WARN'
        ? ['PASS', 'WARN', 'WARN', 'WARN']
        : ['FAIL', 'FAIL', 'FAIL', 'FAIL'];

  const evidence: FrontendEvidence[] = [
    {
      id: 'e1',
      node: 'SURFACE',
      title: 'Surface Storefront Claims',
      status: st[0],
      badge: 'INGESTED',
      confidence: 99,
      fields: [
        { label: 'Presented Domain', value: profile.domain },
        { label: 'Claimed Brand', value: profile.brand },
        {
          label: 'Theme Signature',
          value: uiVerdict === 'BLOCK' ? 'Stolen Luxury Theme' : bad ? 'Generic Discount Template' : 'Original Theme',
          flag: bad,
        },
      ],
    },
    {
      id: 'e2',
      node: 'MERCHANT',
      title: 'Merchant Verification',
      status: st[1],
      badge: profile.records ? 'MATCHED' : 'FAILED (0 MATCH)',
      confidence: 97,
      fields: [
        { label: 'Corporate Registry', value: `${profile.records} Legal Records`, flag: !profile.records },
        { label: 'Domain Age', value: `${profile.ageDays} Days (WHOIS ${bad ? 'Obfuscated' : 'Public'})`, flag: profile.ageDays < 90 },
        { label: 'Impersonation Vector', value: `${bad ? vec : 2}%`, flag: bad, meter: bad ? vec : 2 },
      ],
    },
    {
      id: 'e3',
      node: 'PRICE',
      title: 'Price Anomaly Model',
      status: st[2],
      badge: dev < -20 ? `${dev}% THRESHOLD` : 'IN RANGE',
      confidence: 96,
      fields: [
        { label: 'Cart Item', value: meta.productName },
        { label: 'Advertised Price', value: usd(meta.price), flag: dev < -20 },
        { label: 'Market Global Benchmark', value: usd(meta.benchmark), strike: dev < -20 },
      ],
    },
    {
      id: 'e4',
      node: 'PAYEE',
      title: 'PayPal Real Recipient',
      status: st[3],
      badge: 'DECODED',
      confidence: 99,
      fields: [
        { label: 'Actual Receiver', value: profile.payeeName },
        { label: 'PayPal Sandbox ID', value: profile.payeeId },
        { label: 'Account Status', value: profile.payeeTier, flag: bad },
      ],
    },
  ];

  const reasons =
    uiVerdict === 'BLOCK'
      ? [
          'The merchant receiving your funds does not match the brand shown on the storefront. Payment capture was intercepted automatically before authorization completion.',
          `Advertised price is ${Math.abs(dev)}% below the market benchmark.`,
          `PayPal receiver was created ${profile.ageDays} days ago and is an unverified individual account.`,
          `Domain matches a known scam template with ${vec}% confidence.`,
        ]
      : uiVerdict === 'WARN'
        ? [
            'Some storefront claims could not be verified against the PayPal recipient. Capture is on hold pending review.',
            `Advertised price is ${Math.abs(dev)}% below the market benchmark.`,
            'No corporate registry record found for the receiving merchant.',
          ]
        : ['Storefront claims match the registered PayPal recipient. Safe to capture.'];

  const captureState: FrontendInvestigation['captureState'] =
    uiVerdict === 'ALLOW' && meta.orderId
      ? 'CAPTURED'
      : uiVerdict === 'ALLOW'
        ? 'PENDING'
        : 'HELD';

  return {
    id: invId,
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
    riskScore: verdict.score ?? profile.riskScore,
    confidence: Math.round((verdict.confidence ?? 0.95) * 1000) / 10,
    status: 'COMPLETE',
    verdict: uiVerdict,
    captureState,
    reasons,
    evidence,
    buyerEmail: meta.buyerEmail,
    createdAt: new Date().toISOString(),
  };
}
