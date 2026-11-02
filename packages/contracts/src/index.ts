// Shared contracts. Person 1 (backend) and Person 4 (frontend) both import from here.
export type Verdict = 'ALLOW' | 'WARN' | 'BLOCK';
export type InvestigationStatus = 'QUEUED' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type NodeId = 'SURFACE' | 'MERCHANT' | 'PRICE' | 'PAYEE';
export type EvidenceStatus = 'PASS' | 'WARN' | 'FAIL';
export type CaptureState = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'HELD' | 'VOIDED';

export interface EvidenceField { label: string; value: string; flag?: boolean; strike?: boolean; meter?: number }
export interface Evidence {
  id: string; node: NodeId; title: string; status: EvidenceStatus;
  badge: string; confidence: number; fields: EvidenceField[];
}
export interface Investigation {
  id: string; orderId?: string; storeId?: string;
  domain: string; claimedBrand: string; productName: string;
  price: number; benchmark: number; currency: string;
  payeeName: string; payeeId: string; payeeTier: string; domainAgeDays: number; registryRecords: number;
  riskScore: number; confidence: number;
  status: InvestigationStatus; verdict?: Verdict; captureState: CaptureState;
  reasons: string[]; evidence: Evidence[];
  buyerEmail?: string; reviewRequested?: boolean; createdAt: string;
}
export interface CartItem { sku: string; name: string; price: number; qty: number }
export interface CreateOrderRequest { storeId: string; items: CartItem[]; buyerEmail: string }
export interface CreateOrderResponse { orderId: string; paypalOrderId: string; investigationId: string }
export interface ScanRequest { url: string }
export interface MerchantRegistration { legalName: string; domain: string; paypalEmail: string; type: 'REGISTERED' | 'INDIVIDUAL'; country: string }
export interface MerchantResult { merchantId: string; status: 'VERIFIED' | 'SUSPECT' }
export interface ReportRequest { domain: string; reason: string; investigationId?: string }
