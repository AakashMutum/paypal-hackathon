// Simulated Person 1 backend so the UI works end-to-end offline. Disable with VITE_USE_MOCK=false.
import type { CreateOrderRequest, CreateOrderResponse, Evidence, EvidenceStatus, Investigation, MerchantRegistration, MerchantResult, ReportRequest, Verdict } from '@checkout-guardian/contracts';
const KEY = 'cg_mock_v1', STEP = 1000;
const wait = (ms = 150) => new Promise(r => setTimeout(r, ms));
const rid = () => Math.random().toString(16).slice(2, 8).toUpperCase();

interface Profile { storeId?: string; domain: string; brand: string; product: string; price: number; benchmark: number; payeeName: string; payeeId: string; payeeTier: string; ageDays: number; records: number; verdict: Verdict; risk: number }
const KNOWN: Profile[] = [
  { storeId: 'acme-audio', domain: 'acme-audio.com', brand: 'Acme Audio', product: 'Acme Audio Pro Headphones', price: 299, benchmark: 299, payeeName: 'Acme Audio Inc.', payeeId: 'PP-MCH-100201', payeeTier: 'Registered Merchant', ageDays: 3650, records: 3, verdict: 'ALLOW', risk: 4 },
  { storeId: 'mega-deals', domain: 'mega-dealsoutlet.net', brand: 'Unbranded', product: 'Unbranded Luxury Watch', price: 19.99, benchmark: 499, payeeName: 'seller-88@gmail.com', payeeId: 'PP-MCH-448812', payeeTier: 'Unverified Individual', ageDays: 41, records: 0, verdict: 'WARN', risk: 58 },
  { storeId: 'gucci-outlet', domain: 'gucci-outletdeals.com', brand: 'Gucci', product: 'Gucci Handbag', price: 149, benchmark: 2500, payeeName: 'personalfake@yahoo.com', payeeId: 'PP-MCH-994103', payeeTier: 'Inactive Individual Tier', ageDays: 4, records: 0, verdict: 'BLOCK', risk: 97 },
  { domain: 'apple-device-sale.online', brand: 'Apple Store', product: 'iPhone 16 Pro', price: 199, benchmark: 999, payeeName: 'personal-email@mail.ru', payeeId: 'PP-MCH-221904', payeeTier: 'Inactive Individual Tier', ageDays: 9, records: 0, verdict: 'BLOCK', risk: 96 },
  { domain: 'nordic-living-studio.com', brand: 'Nordic Living', product: 'Oak Side Table', price: 240, benchmark: 255, payeeName: 'Nordic Retail ApS', payeeId: 'PP-MCH-330117', payeeTier: 'Registered Merchant', ageDays: 2900, records: 2, verdict: 'ALLOW', risk: 6 },
  { domain: 'solarbeats-audio.store', brand: 'Beats Audio', product: 'Studio Headphones', price: 89, benchmark: 349, payeeName: 'Unregistered LLC', payeeId: 'PP-MCH-552078', payeeTier: 'Unverified Business', ageDays: 70, records: 0, verdict: 'WARN', risk: 68 },
];
function profileFor(url: string): Profile {
  const domain = url.trim().replace(/^https?:\/\//, '').split('/')[0].toLowerCase();
  const k = domain && KNOWN.find(p => domain.includes(p.domain) || p.domain.includes(domain));
  if (k) return k;
  const lux = /gucci|nike|apple|hermes|rolex|louis|adidas|prada|chanel/.test(domain), cheap = /outlet|deal|sale|discount|cheap|clearance/.test(domain);
  const verdict: Verdict = lux && cheap ? 'BLOCK' : lux || cheap ? 'WARN' : 'ALLOW';
  const brand = (domain.split('.')[0].split('-')[0] || 'Unknown').replace(/^./, c => c.toUpperCase());
  const ok = verdict === 'ALLOW';
  return { domain: domain || 'unknown.site', brand, product: 'Featured Product', price: ok ? 120 : 39, benchmark: ok ? 125 : 650, payeeName: ok ? `${brand} Ltd.` : 'Anonymous Seller', payeeId: `PP-MCH-${rid()}`, payeeTier: ok ? 'Registered Merchant' : 'Unverified Individual', ageDays: ok ? 2000 : 12, records: ok ? 1 : 0, verdict, risk: ok ? 8 : verdict === 'WARN' ? 55 : 94 };
}
function build(p: Profile, o: { id?: string; orderId?: string; buyerEmail?: string; at?: number } = {}): Investigation {
  const st: EvidenceStatus[] = p.verdict === 'ALLOW' ? ['PASS', 'PASS', 'PASS', 'PASS'] : p.verdict === 'WARN' ? ['PASS', 'WARN', 'WARN', 'WARN'] : ['FAIL', 'FAIL', 'FAIL', 'FAIL'];
  const bad = p.verdict !== 'ALLOW', dev = Math.round((p.price / p.benchmark - 1) * 100), vec = p.risk > 95 ? 98.4 : p.risk;
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })} USD`;
  const evidence: Evidence[] = [
    { id: 'e1', node: 'SURFACE', title: 'Surface Storefront Claims', status: st[0], badge: 'INGESTED', confidence: 99, fields: [{ label: 'Presented Domain', value: p.domain }, { label: 'Claimed Brand', value: p.brand }, { label: 'Theme Signature', value: p.verdict === 'BLOCK' ? 'Stolen Luxury Theme' : bad ? 'Generic Discount Template' : 'Original Theme', flag: bad }] },
    { id: 'e2', node: 'MERCHANT', title: 'Merchant Verification', status: st[1], badge: p.records ? 'MATCHED' : 'FAILED (0 MATCH)', confidence: 97, fields: [{ label: 'Corporate Registry', value: `${p.records} Legal Records`, flag: !p.records }, { label: 'Domain Age', value: `${p.ageDays} Days (WHOIS ${bad ? 'Obfuscated' : 'Public'})`, flag: p.ageDays < 90 }, { label: 'Impersonation Vector', value: `${bad ? vec : 2}%`, flag: bad, meter: bad ? vec : 2 }] },
    { id: 'e3', node: 'PRICE', title: 'Price Anomaly Model', status: st[2], badge: dev < -20 ? `${dev}% THRESHOLD` : 'IN RANGE', confidence: 96, fields: [{ label: 'Cart Item', value: p.product }, { label: 'Advertised Price', value: usd(p.price), flag: dev < -20 }, { label: 'Market Global Benchmark', value: usd(p.benchmark), strike: dev < -20 }] },
    { id: 'e4', node: 'PAYEE', title: 'PayPal Real Recipient', status: st[3], badge: 'DECODED', confidence: 99, fields: [{ label: 'Actual Receiver', value: p.payeeName }, { label: 'PayPal Sandbox ID', value: p.payeeId }, { label: 'Account Status', value: p.payeeTier, flag: bad }] },
  ];
  const reasons = p.verdict === 'BLOCK' ? ['The merchant receiving your funds does not match the brand shown on the storefront. Payment capture was intercepted automatically before authorization completion.', `Advertised price is ${Math.abs(dev)}% below the market benchmark.`, `PayPal receiver was created ${p.ageDays} days ago and is an unverified individual account.`, `Domain matches a known scam template with ${vec}% confidence.`]
    : p.verdict === 'WARN' ? ['Some storefront claims could not be verified against the PayPal recipient. Capture is on hold pending review.', `Advertised price is ${Math.abs(dev)}% below the market benchmark.`, 'No corporate registry record found for the receiving merchant.']
    : ['Storefront claims match the registered PayPal recipient. Safe to capture.'];
  return { id: o.id ?? `INV-${rid()}`, orderId: o.orderId, storeId: p.storeId, domain: p.domain, claimedBrand: p.brand, productName: p.product, price: p.price, benchmark: p.benchmark, currency: 'USD', payeeName: p.payeeName, payeeId: p.payeeId, payeeTier: p.payeeTier, domainAgeDays: p.ageDays, registryRecords: p.records, riskScore: p.risk, confidence: p.verdict === 'ALLOW' ? 98.9 : p.verdict === 'WARN' ? 91.4 : 99.8, status: 'COMPLETE', verdict: p.verdict, captureState: p.verdict === 'ALLOW' && o.orderId ? 'CAPTURED' : p.verdict === 'ALLOW' ? 'PENDING' : 'HELD', reasons, evidence, buyerEmail: o.buyerEmail, createdAt: new Date(o.at ?? Date.now()).toISOString() };
}
// Reveal evidence progressively, like a real async pipeline.
function project(inv: Investigation): Investigation {
  const el = Date.now() - Date.parse(inv.createdAt);
  if (el >= 4 * STEP) return inv;
  const k = Math.min(4, Math.floor(el / STEP) + 1);
  return { ...inv, status: 'RUNNING', verdict: undefined, captureState: inv.orderId ? 'AUTHORIZED' : 'PENDING', evidence: inv.evidence.slice(0, k) };
}
const seed = () => ['apple-device-sale.online', 'nordic-living-studio.com', 'solarbeats-audio.store'].map((d, i) => build(profileFor(d), { id: `INV-SEED${i}`, at: Date.now() - (i + 1) * 7200e3 }));
let db: Investigation[] = (() => { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch { /* ignore */ } return seed(); })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };
const find = (id: string) => { const i = db.find(x => x.id === id); if (!i) throw new Error('Investigation not found'); return i; };

export const mock = {
  async scan(url: string) { await wait(500); const inv = build(profileFor(url)); db.unshift(inv); save(); return project(inv); },
  async createOrder(r: CreateOrderRequest): Promise<CreateOrderResponse> {
    await wait(400); const p = KNOWN.find(k => k.storeId === r.storeId); if (!p) throw new Error('Unknown store');
    const orderId = `ORD-${rid()}`, inv = build(p, { orderId, buyerEmail: r.buyerEmail }); db.unshift(inv); save();
    return { orderId, paypalOrderId: `PAYPAL-${rid()}`, investigationId: inv.id };
  },
  async list() { await wait(60); return db.map(project); },
  async get(id: string) { await wait(60); return project(find(id)); },
  async approved(_orderId: string) { await wait(100); },
  async cancel(id: string) { await wait(300); const i = find(id); if (i.captureState !== 'HELD') throw new Error('Order is not on hold'); i.captureState = 'VOIDED'; save(); return project(i); },
  async review(id: string) { await wait(300); const i = find(id); i.reviewRequested = true; save(); return project(i); },
  async report(_r: ReportRequest) { await wait(300); },
  async register(r: MerchantRegistration): Promise<MerchantResult> { await wait(600); return { merchantId: `MCH-${rid()}`, status: r.type === 'INDIVIDUAL' ? 'SUSPECT' : 'VERIFIED' }; },
  async reset() { await wait(100); db = seed(); save(); },
};
