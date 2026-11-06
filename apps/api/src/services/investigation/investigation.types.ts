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
  status: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN' | 'NOT_CHECKED' | 'ERROR';
  badge: string;
  confidence: number;
  fields: FrontendEvidenceField[];
  /** Where the evidence came from, for example "rdap" or "kernel". */
  sources?: string[];
}

export interface SignalAvailability {
  page: 'ok' | 'blocked' | 'empty' | 'unavailable' | 'not_checked';
  domainAge: 'known' | 'unavailable' | 'not_checked';
  registry: 'found' | 'empty' | 'unavailable' | 'not_checked';
  price: 'known' | 'unavailable' | 'not_checked';
  tls: 'valid' | 'invalid' | 'unavailable' | 'not_checked';
  payee: 'provided' | 'not_provided';
  /**
   * Registrar reputation is never assessed: no reputation source exists, so the registrar name is
   * shown as a fact and never changes the score.
   */
  registrarReputation: 'not_assessed';
}

export interface FrontendInvestigation {
  id: string;
  orderId?: string;
  paypalOrderId?: string;
  storeId?: string;
  domain: string;
  claimedBrand: string;
  productName: string;
  /** null means no checkout amount was supplied or found; it is not zero. */
  price: number | null;
  /** null means no comparable price was available. */
  benchmark: number | null;
  currency: string;
  payeeName: string | null;
  payeeId: string | null;
  payeeTier: string | null;
  /** null means domain age could not be established; it is not zero days. */
  domainAgeDays: number | null;
  /** null means the registry was not checked; 0 means checked with no records. */
  registryRecords: number | null;
  riskScore: number;
  confidence: number;
  /** Elapsed milliseconds for the live scan, when available. */
  latencyMs?: number;
  /** Why confidence was capped or reduced, when that happened. */
  confidenceReason?: string;
  /** Which signals were available, unavailable, or not applicable. */
  signalAvailability?: SignalAvailability;
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
  /**
   * One-way fingerprint of the sandbox payee email the PayPal order was created for.
   * The raw address is never persisted; approval compares the observed payee email to this.
   */
  expectedPayeeEmailHash?: string;
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
  /** Stable id of the retrieved memory case. */
  caseId?: string;
  patternSentence: string;
  matchType: 'exact_payee' | 'exact_domain' | 'semantic';
  score: number;
  decision: UiVerdict;
  /** How the case was retrieved, for example embedding or lexical. */
  retrieval?: string;
  /** Optional model-written explanation of why this case is relevant. */
  relevance?: string;
}

export interface Provenance {
  /** What actually produced the signals for this investigation. */
  signals: 'replay' | 'live';
  llm: 'live' | 'replay' | 'record' | 'none';
  /** The configured model provider, for example gemini. */
  llmProvider?: string;
  /** The first model configured for the fast tier. */
  llmModel?: string;
  /** The ordered model fallback lists. */
  llmModels?: { fast: string[]; strong: string[] };
  llmKeySource?: 'LLM_API_KEY' | 'GEMINI_API_KEY' | 'none';
  llmError?: string;
  memory: 'elastic' | 'file' | 'memory';
  /** True when memory survives a restart. */
  memoryPersistent?: boolean;
  /** Embedding provider used for retrieval, for example gemini:text-embedding-004. */
  embeddings?: string;
  /** The configured SIGNALS_MODE (replay, live or auto). */
  signalsMode: 'replay' | 'live' | 'auto';
  /**
   * Set when a model time budget applied. exhausted means remaining model steps were skipped and
   * deterministic output was used (AGENT_MODEL_BUDGET_MS).
   */
  modelBudget?: { limitMs: number; usedMs: number; exhausted: boolean; skippedCalls: number };
}

export interface PaymentEvent {
  investigationId: string;
  fromState?: CaptureState;
  toState: CaptureState;
  detail?: Record<string, unknown>;
  simulated: boolean;
}
