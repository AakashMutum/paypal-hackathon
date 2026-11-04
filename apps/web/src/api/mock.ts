// Simulated backend so the UI works end to end offline. Used when VITE_API_URL is not set or
// VITE_USE_MOCK=true. Everything here is simulated and every investigation says so.
import type { CreateOrderRequest, CreateOrderResponse, Evidence, EvidenceStatus, Investigation, MerchantRegistration, MerchantResult, Provenance, ReportRequest, SimilarCase, Verdict } from '../types';

const KEY = 'trustora_mock_v2', STEP = 1000;
const wait = (ms = 150) => new Promise(r => setTimeout(r, ms));
const rid = () => Math.random().toString(16).slice(2, 8).toUpperCase();

interface Profile { storeId?: string; domain: string; brand: string; product: string; price: number; benchmark: number; payeeName: string; payeeId: string; payeeTier: string; ageDays: number; records: number; verdict: Verdict; risk: number }

// The canonical stores (same data as tests/fixtures and the API catalog).
const KNOWN: Profile[] = [
  { storeId: 'harborline-outfitters', domain: 'www.harborline-outfitters.example', brand: 'Harborline Outfitters', product: 'Canvas weekender bag', price: 84.5, benchmark: 84.5, payeeName: 'Harborline Outfitters Ltd', payeeId: 'MERCH-HARBORLINE', payeeTier: 'Registered Merchant', ageDays: 3285, records: 1, verdict: 'ALLOW', risk: 8 },
  { storeId: 'bargainbarn-outlet', domain: 'www.bargainbarn-outlet.example', brand: 'Bargain Barn Outlet', product: 'Insulated trail jacket', price: 39, benchmark: 139, payeeName: 'Bargain Barn Outlet', payeeId: 'MERCH-BARGAINBARN', payeeTier: 'Registered Merchant', ageDays: 210, records: 1, verdict: 'WARN', risk: 50 },
  { storeId: 'harborlyne-outfitters-sale', domain: 'www.harborlyne-outfitters-sale.example', brand: 'Harborline Outfitters', product: 'Canvas weekender bag', price: 29, benchmark: 84.5, payeeName: 'Quickpay Holdings', payeeId: 'MERCH-QUICKPAY-HOLDINGS', payeeTier: 'Unverified Business', ageDays: 6, records: 0, verdict: 'PAUSE', risk: 87 },
];

const PROVENANCE: Provenance = { signals: 'replay', llm: 'none', memory: 'memory', signalsMode: 'replay' };
const SIMILAR: Record<Verdict, SimilarCase[]> = {
  ALLOW: [],
  WARN: [{ patternSentence: 'A flash-sale store a few weeks old lists premium goods at seventy percent off and has no returns page.', matchType: 'semantic', score: 0.31, decision: 'WARN' }],
  PAUSE: [
    { patternSentence: 'A newly registered lookalike of a known brand claims to be an official outlet and sells far below market price.', matchType: 'semantic', score: 0.42, decision: 'PAUSE' },
    { patternSentence: 'The checkout pays a business that is unrelated to the brand the store advertises.', matchType: 'semantic', score: 0.27, decision: 'PAUSE' },
  ],
};

function profileFor(url: string): Profile {
  const domain = url.trim().replace(/^https?:\/\//, '').split(/[/?#]/)[0].toLowerCase();
  const bare = (d: string) => d.replace(/^www\./, '');
  const k = domain && KNOWN.find(p => bare(p.domain) === bare(domain));
  if (k) return k;
  // Unknown domain: the simulator has no signals for it, so it cannot clear it.
  const brand = (bare(domain).split('.')[0].split('-')[0] || 'Unknown').replace(/^./, c => c.toUpperCase());
  return { domain: domain || 'unknown.example', brand, product: 'Featured item', price: 0, benchmark: 0, payeeName: 'Unknown receiver', payeeId: 'UNKNOWN', payeeTier: 'Unknown', ageDays: 0, records: 0, verdict: 'WARN', risk: 0 };
}

function build(p: Profile, o: { id?: string; orderId?: string; buyerEmail?: string; at?: number } = {}): Investigation {
  const known = Boolean(p.storeId);
  const st: EvidenceStatus[] = p.verdict === 'ALLOW' ? ['PASS', 'PASS', 'PASS', 'PASS'] : p.verdict === 'WARN' ? ['PASS', 'WARN', 'WARN', 'WARN'] : ['FAIL', 'FAIL', 'FAIL', 'FAIL'];
  const bad = p.verdict !== 'ALLOW', dev = p.benchmark ? Math.round((p.price / p.benchmark - 1) * 100) : 0;
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;
  const evidence: Evidence[] = known ? [
    { id: 'e1', node: 'SURFACE', title: 'Surface Storefront Claims', status: st[0], badge: 'INGESTED', confidence: 99, sources: ['rdap', 'tls'], fields: [{ label: 'Presented Domain', value: p.domain }, { label: 'Claimed Brand', value: p.brand }, { label: 'Domain Age', value: `${p.ageDays} days`, flag: p.ageDays < 90 }] },
    { id: 'e2', node: 'MERCHANT', title: 'Merchant Verification', status: st[1], badge: p.records ? 'MATCHED' : 'FAILED (0 MATCH)', confidence: 97, sources: ['registry'], fields: [{ label: 'Corporate Registry', value: `${p.records} Legal Records`, flag: !p.records }] },
    { id: 'e3', node: 'PRICE', title: 'Price Anomaly Model', status: st[2], badge: dev < -20 ? `${dev}% THRESHOLD` : 'IN RANGE', confidence: 96, sources: ['channel3'], fields: [{ label: 'Cart Item', value: p.product }, { label: 'Advertised Price', value: usd(p.price), flag: dev < -20 }, { label: 'Market Benchmark', value: usd(p.benchmark), strike: dev < -20 }] },
    { id: 'e4', node: 'PAYEE', title: 'PayPal Real Recipient', status: st[3], badge: 'DECODED', confidence: 99, sources: ['kernel'], fields: [{ label: 'Actual Receiver', value: p.payeeName }, { label: 'Merchant ID', value: p.payeeId }, { label: 'Account Status', value: p.payeeTier, flag: bad }] },
  ] : (['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'] as const).map((node, i) => ({ id: `e${i + 1}`, node, title: ['Surface Storefront Claims', 'Merchant Verification', 'Price Anomaly Model', 'PayPal Real Recipient'][i], status: 'WARN' as EvidenceStatus, badge: 'SIMULATOR', confidence: 0, fields: [{ label: 'Reason', value: 'The simulated backend has no signals for this domain. Set VITE_API_URL to the live API and scan again for a real investigation.', flag: false }] }));
  const reasons = !known ? ['No live signals were available for this domain, so it could not be cleared. Unknown domains need live signals.']
    : p.verdict === 'PAUSE' ? ['The account receiving the payment is not the merchant the storefront claims. Capture is blocked.', `The price is ${Math.abs(dev)}% below the usual price.`, `The website was registered ${p.ageDays} days ago.`]
    : p.verdict === 'WARN' ? ['The price is far below comparable sellers and the website does not publish its receiving account.', `The price is ${Math.abs(dev)}% below the usual price.`]
    : ['The seller, the website age and the price are consistent. Safe to capture.'];
  const captureState = p.verdict === 'ALLOW' && o.orderId ? 'CAPTURED' : p.verdict === 'ALLOW' ? 'PENDING' : o.orderId ? 'HELD' : 'PENDING';
  const price = known ? p.price : null;
  const benchmark = known ? p.benchmark : null;
  const payeeName = known ? p.payeeName : null;
  const payeeId = known ? p.payeeId : null;
  const payeeTier = known ? p.payeeTier : null;
  const domainAgeDays = known ? p.ageDays : null;
  const registryRecords = known ? p.records : null;
  const confidenceReason = known ? undefined : 'The simulated backend has no signals for this domain.';
  const signalAvailability = known
    ? { page: 'ok' as const, domainAge: 'known' as const, registry: p.records > 0 ? 'found' as const : 'empty' as const, price: 'known' as const, tls: 'valid' as const, payee: 'provided' as const, registrarReputation: 'not_assessed' as const }
    : { page: 'unavailable' as const, domainAge: 'not_checked' as const, registry: 'not_checked' as const, price: 'not_checked' as const, tls: 'not_checked' as const, payee: 'not_provided' as const, registrarReputation: 'not_assessed' as const };
  return { id: o.id ?? `INV-${rid()}`, orderId: o.orderId, storeId: p.storeId, domain: p.domain, claimedBrand: p.brand, productName: p.product, price, benchmark, currency: 'USD', payeeName, payeeId, payeeTier, domainAgeDays, registryRecords, riskScore: p.risk, confidence: p.verdict === 'ALLOW' ? 98.9 : p.verdict === 'WARN' ? 91.4 : 99.8, ...(confidenceReason ? { confidenceReason } : {}), signalAvailability, status: 'COMPLETE', verdict: p.verdict, captureState, captureReason: captureState === 'HELD' ? (p.verdict === 'WARN' ? 'The guardian raised a warning. Capture waits for a person to acknowledge it.' : 'The guardian paused this payment. Capture is blocked.') : captureState === 'CAPTURED' ? 'Simulated capture (no PayPal sandbox credentials).' : undefined, simulated: true, mode: 'simulated', payeeMismatch: p.verdict === 'PAUSE', hardRules: p.verdict === 'PAUSE' ? ['HF1', 'HF2'] : [], provenance: PROVENANCE, similarCases: known ? SIMILAR[p.verdict] : [], reasons, evidence, buyerEmail: o.buyerEmail, createdAt: new Date(o.at ?? Date.now()).toISOString() };
}

// Reveal evidence progressively, like a real async pipeline.
function project(inv: Investigation): Investigation {
  const el = Date.now() - Date.parse(inv.createdAt);
  if (el >= 4 * STEP) return inv;
  const k = Math.min(4, Math.floor(el / STEP) + 1);
  return { ...inv, status: 'RUNNING', verdict: undefined, captureState: inv.orderId ? 'AUTHORIZED' : 'PENDING', evidence: inv.evidence.slice(0, k) };
}

const seed = () => KNOWN.map((p, i) => build(p, { id: `INV-SEED${i}`, at: Date.now() - (i + 1) * 7200e3 }));
let db: Investigation[] = (() => {
  try {
    const r = localStorage.getItem(KEY);
    if (r) return JSON.parse(r) as Investigation[];
  } catch (e) {
    console.warn('The simulated backend could not read its saved state:', e instanceof Error ? e.message : e);
  }
  return seed();
})();
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.warn('The simulated backend could not save its state:', e instanceof Error ? e.message : e);
  }
};
const find = (id: string) => { const i = db.find(x => x.id === id || x.orderId === id); if (!i) throw new Error('Investigation not found'); return i; };

export const mock = {
  async scan(url: string) { await wait(500); const inv = build(profileFor(url)); db.unshift(inv); save(); return project(inv); },
  async createOrder(r: CreateOrderRequest): Promise<CreateOrderResponse> {
    await wait(400); const p = KNOWN.find(k => k.storeId === r.storeId); if (!p) throw new Error('Unknown store');
    const orderId = `ORD-${rid()}`, inv = build(p, { orderId, buyerEmail: r.buyerEmail }); db.unshift(inv); save();
    return { orderId, paypalOrderId: `SIM-ORD-${rid()}`, investigationId: inv.id, simulated: true, mode: 'simulated' };
  },
  async list() { await wait(60); return db.map(project); },
  async get(id: string) { await wait(60); return project(find(id)); },
  async approved(_orderId: string) { await wait(100); },
  async cancel(id: string) {
    await wait(300); const i = find(id);
    if (i.captureState === 'CAPTURED') throw new Error('This payment has already been captured and cannot be voided.');
    i.captureState = 'VOIDED'; i.captureReason = 'Cancelled and voided. (simulated)'; save(); return project(i);
  },
  async acknowledge(id: string) {
    await wait(300); const i = find(id);
    if (i.verdict !== 'WARN') throw new Error('Only a warning can be acknowledged. A paused payment cannot be overridden.');
    i.acknowledged = true; i.captureState = 'CAPTURED'; i.captureReason = 'Warning acknowledged. Simulated capture (no PayPal sandbox credentials).'; save(); return project(i);
  },
  async review(id: string) { await wait(300); const i = find(id); i.reviewRequested = true; save(); return project(i); },
  async report(_r: ReportRequest) { await wait(300); },
  async register(r: MerchantRegistration): Promise<MerchantResult> { await wait(600); return { merchantId: `MCH-${rid()}`, status: r.type === 'INDIVIDUAL' ? 'SUSPECT' : 'VERIFIED' }; },
  async reset() { await wait(100); db = []; save(); },
};
