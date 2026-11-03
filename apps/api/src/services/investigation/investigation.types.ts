export type UiVerdict = 'ALLOW' | 'WARN' | 'PAUSE';
export type CaptureState = 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'HELD' | 'VOIDED' | 'FAILED';
export type PaymentMode = 'sandbox' | 'simulated';

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
  /** Where the evidence came from, for example "rdap" or "kernel". */
  sources?: string[];
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
  verdict?: UiVerdict;
  captureState: CaptureState;
  /** Plain-language reason for the current capture state, never containing secrets. */
  captureReason?: string;
  simulated?: boolean;
  mode?: PaymentMode;
  authorizationId?: string;
  captureId?: string;
  /** True once a person has acknowledged a WARN. */
  acknowledged?: boolean;
  /** True when the payee is not the merchant the storefront claims. Nothing can override it. */
  payeeMismatch?: boolean;
  /** Ids of the hard rules that fired, for example HF1. */
  hardRules?: string[];
  /** The sandbox payee email the PayPal order was created for, when the store uses one. */
  expectedPayeeEmail?: string;
  /** SHA-256 of the order token returned once when the order was created. */
  orderTokenHash?: string;
  reasons: string[];
  evidence: FrontendEvidence[];
  trace?: unknown[];
  provenance?: Provenance;
  /** Up to three similar past cases retrieved from memory. Display only: they never change a decision. */
  similarCases?: SimilarCase[];
  patternSentence?: string;
  buyerEmail?: string;
  reviewRequested?: boolean;
  createdAt: string;
}

export interface SimilarCase {
  patternSentence: string;
  matchType: 'exact_payee' | 'exact_domain' | 'semantic';
  score: number;
  decision: UiVerdict;
}

export interface Provenance {
  /** What actually produced the signals for this investigation. */
  signals: 'replay' | 'live';
  llm: 'live' | 'replay' | 'record' | 'none';
  memory: 'elastic' | 'memory';
  /** The configured SIGNALS_MODE (replay, live or auto). */
  signalsMode: 'replay' | 'live' | 'auto';
}

export interface PaymentEvent {
  investigationId: string;
  fromState?: CaptureState;
  toState: CaptureState;
  detail?: Record<string, unknown>;
  simulated: boolean;
}
