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
export interface SimilarCase {
  caseId?: string; patternSentence: string; matchType: 'exact_payee' | 'exact_domain' | 'semantic';
  score: number; decision: Verdict; retrieval?: string; relevance?: string;
}
export interface Provenance {
  signals: 'replay' | 'live';
  llm: 'live' | 'replay' | 'record' | 'none';
  llmProvider?: string; llmModel?: string; llmModels?: { fast: string[]; strong: string[] };
  llmKeySource?: 'LLM_API_KEY' | 'GEMINI_API_KEY' | 'none'; llmError?: string;
  memory: 'elastic' | 'file' | 'memory'; memoryPersistent?: boolean; embeddings?: string;
  signalsMode: 'replay' | 'live' | 'auto';
}
export interface SignalAvailability {
  page: 'ok' | 'blocked' | 'empty' | 'unavailable' | 'not_checked';
  domainAge: 'known' | 'unavailable' | 'not_checked';
  registry: 'found' | 'empty' | 'unavailable' | 'not_checked';
  price: 'known' | 'unavailable' | 'not_checked';
  tls: 'valid' | 'invalid' | 'unavailable' | 'not_checked';
  payee: 'provided' | 'not_provided';
}
export interface TraceStep { step: number; tool: string; why: string; input: string; result: string; ok: boolean; ms: number }
export interface Investigation {
  id: string; orderId?: string; storeId?: string;
  domain: string; claimedBrand: string; productName: string;
  price: number | null; benchmark: number | null; currency: string;
  payeeName: string | null; payeeId: string | null; payeeTier: string | null;
  domainAgeDays: number | null; registryRecords: number | null;
  riskScore: number; confidence: number; confidenceReason?: string;
  signalAvailability?: SignalAvailability;
  status: InvestigationStatus; verdict?: Verdict; captureState: CaptureState;
  reasons: string[]; evidence: Evidence[];
  buyerEmail?: string; reviewRequested?: boolean; createdAt: string;
  captureReason?: string; simulated?: boolean; mode?: string; acknowledged?: boolean; payeeMismatch?: boolean; hardRules?: string[];
  trace?: TraceStep[]; provenance?: Provenance; similarCases?: SimilarCase[]; patternSentence?: string;
}
export interface HealthModes {
  paypal: string; store: string; signals: string; llm: string; memory: string;
  llmProvider?: string; llmModel?: string; llmModels?: { fast: string[]; strong: string[] };
  llmKeySource?: string; llmError?: string; memoryPersistent?: boolean; embeddings?: string;
  memorySize?: number; memoryLocation?: string;
  auditEncryption?: 'enabled' | 'disabled' | 'invalid';
  registry?: 'corporate+local' | 'local';
}
export interface Health { status: string; database: { status: string }; modes?: HealthModes }
export interface CartItem { sku: string; name: string; price: number; qty: number }
export interface CreateOrderRequest { storeId: string; items: CartItem[]; buyerEmail: string }
export interface CreateOrderResponse { orderId: string; paypalOrderId: string; investigationId: string; orderToken?: string; simulated?: boolean; mode?: string }
export interface ScanRequest { url: string }
export interface MerchantRegistration { legalName: string; domain: string; paypalEmail: string; type: 'REGISTERED' | 'INDIVIDUAL'; country: string }
export interface MerchantResult { merchantId: string; status: 'VERIFIED' | 'SUSPECT' }
export interface ReportRequest { domain: string; reason: string; investigationId?: string }
