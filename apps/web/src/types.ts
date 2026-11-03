// Frontend-specific types used by apps/web.
// Shared backend/API types live in packages/contracts/src/index.ts, imported as @checkout-guardian/contracts.

export type Verdict = 'ALLOW' | 'WARN' | 'PAUSE';
export type InvestigationStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type NodeId = 'SURFACE' | 'MERCHANT' | 'PRICE' | 'PAYEE';
export type EvidenceStatus = 'PASS' | 'WARN' | 'FAIL';
export type CaptureState = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'HELD' | 'VOIDED' | 'FAILED';

export interface EvidenceField { label: string; value: string; flag?: boolean; strike?: boolean; meter?: number }
export interface Evidence {
  id: string; node: NodeId; title: string; status: EvidenceStatus;
  badge: string; confidence: number; fields: EvidenceField[];
  /** Where the evidence came from, for example rdap or kernel. */
  sources?: string[];
}
export interface SimilarCase { patternSentence: string; matchType: 'exact_payee' | 'exact_domain' | 'semantic'; score: number; decision: Verdict }
export interface Provenance { signals: 'replay' | 'live'; llm: 'live' | 'replay' | 'record' | 'none'; memory: 'elastic' | 'memory'; signalsMode: 'replay' | 'live' | 'auto' }
export interface TraceStep { step: number; tool: string; why: string; input: string; result: string; ok: boolean; ms: number }
export interface Investigation {
  id: string; orderId?: string; storeId?: string;
  domain: string; claimedBrand: string; productName: string;
  price: number; benchmark: number; currency: string;
  payeeName: string; payeeId: string; payeeTier: string; domainAgeDays: number; registryRecords: number;
  riskScore: number; confidence: number;
  status: InvestigationStatus; verdict?: Verdict; captureState: CaptureState;
  reasons: string[]; evidence: Evidence[];
  buyerEmail?: string; reviewRequested?: boolean; createdAt: string;
  captureReason?: string; simulated?: boolean; mode?: string; acknowledged?: boolean; payeeMismatch?: boolean; hardRules?: string[];
  trace?: TraceStep[]; provenance?: Provenance; similarCases?: SimilarCase[]; patternSentence?: string;
}
export interface HealthModes { paypal: string; store: string; signals: string; llm: string; memory: string }
export interface Health { status: string; database: { status: string }; modes?: HealthModes }
export interface CartItem { sku: string; name: string; price: number; qty: number }
export interface CreateOrderRequest { storeId: string; items: CartItem[]; buyerEmail: string }
export interface CreateOrderResponse { orderId: string; paypalOrderId: string; investigationId: string; orderToken?: string; simulated?: boolean; mode?: string }
export interface ScanRequest { url: string }
export interface MerchantRegistration { legalName: string; domain: string; paypalEmail: string; type: 'REGISTERED' | 'INDIVIDUAL'; country: string }
export interface MerchantResult { merchantId: string; status: 'VERIFIED' | 'SUSPECT' }
export interface ReportRequest { domain: string; reason: string; investigationId?: string }
