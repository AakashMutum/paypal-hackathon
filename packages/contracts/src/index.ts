export interface ApiSuccessResponse<T, M = Record<string, unknown>> {
  success: true;
  data: T;
  meta: M;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorDetail;
}

export type ApiResponse<T, M = Record<string, unknown>> = ApiSuccessResponse<T, M> | ApiErrorResponse;

export function successResponse<T, M = Record<string, unknown>>(
  data: T,
  meta: M = {} as M
): ApiSuccessResponse<T, M> {
  return { success: true, data, meta };
}

export function errorResponse(
  code: string,
  message: string,
  details: unknown = undefined
): ApiErrorResponse {
  const error: ApiErrorDetail = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return { success: false, error };
}

export const RiskWeights = {
  DOMAIN: 0.30,
  MERCHANT_CONSISTENCY: 0.40,
  PRICING: 0.20,
  SSL_TECHNICAL: 0.10,
} as const;

export type RiskWeightsType = typeof RiskWeights;

export const DecisionTypes = {
  ALLOW: 'ALLOW',
  WARN: 'WARN',
  PAUSE: 'PAUSE',
} as const;

export type DecisionType = typeof DecisionTypes[keyof typeof DecisionTypes];

export const DecisionThresholds = {
  ALLOW_MAX: 39,
  WARN_MIN: 40,
  WARN_MAX: 74,
  PAUSE_MIN: 75,
} as const;

export type DecisionThresholdsType = typeof DecisionThresholds;

export const SessionStatus = {
  CREATED: 'CREATED',
  EVALUATING: 'EVALUATING',
  PENDING_REVIEW: 'PENDING_REVIEW',
  ALLOWED: 'ALLOWED',
  WARNED: 'WARNED',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

export type SessionStatusType = typeof SessionStatus[keyof typeof SessionStatus];

export const MerchantStatus = {
  UNVERIFIED: 'UNVERIFIED',
  VERIFIED_GENUINE: 'VERIFIED_GENUINE',
  FLAGGED_SUSPICIOUS: 'FLAGGED_SUSPICIOUS',
  CONFIRMED_FRAUD: 'CONFIRMED_FRAUD',
} as const;

export type MerchantStatusType = typeof MerchantStatus[keyof typeof MerchantStatus];

export const ActionTaken = {
  EVALUATED: 'EVALUATED',
  PROCEED: 'PROCEED',
  WARN_DISPLAYED: 'WARN_DISPLAYED',
  CAPTURE_PAUSED: 'CAPTURE_PAUSED',
  USER_OVERRIDE: 'USER_OVERRIDE',
  USER_ABANDONED: 'USER_ABANDONED',
} as const;

export type ActionTakenType = typeof ActionTaken[keyof typeof ActionTaken];

export type DatabaseHealthStatus = 'healthy' | 'unhealthy' | 'not_configured';

export interface DatabaseHealthInfo {
  status: DatabaseHealthStatus;
  error?: string;
}

export interface HealthData {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  database: DatabaseHealthInfo;
  /** Which parts run for real and which are simulated or replayed. Additive. */
  modes?: Record<string, unknown>;
}

export interface HealthMeta {
  timestamp: string;
  [key: string]: unknown;
}

export interface OrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateOrderRequest {
  storefrontUrl: string;
  amount: number;
  currency?: string;
  merchantId?: string;
  claimedMerchantName?: string;
  payeeEmail?: string;
  orderItems?: OrderItem[];
  buyerReference?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateOrderResponse {
  sessionId: string;
  orderId: string;
  status: string;
  amount: string;
  currency: string;
  approvalUrl?: string;
}

export interface CaptureOrderRequest {
  userAcknowledged?: boolean;
  overrideReason?: string;
}

export interface CaptureOrderResponse {
  sessionId: string;
  orderId: string;
  captureId?: string;
  status: string;
  paymentState: 'COMPLETED' | 'PAUSED' | 'FAILED';
  decision: DecisionType;
  actionTaken: ActionTakenType;
}

export interface MerchantVerificationSummary {
  isMatch: boolean;
  matchStatus: 'MATCH' | 'MISMATCH' | 'MISSING_PAYEE' | 'UNVERIFIED_MERCHANT';
  expectedMerchantId?: string;
  expectedPayeeEmail?: string;
  expectedClaimedName?: string;
  observedMerchantId?: string;
  observedPayeeEmail?: string;
  reasons: string[];
}

export interface RiskScores {
  domainReputation: number;
  merchantConsistency: number;
  pricingAnomaly: number;
  sslTechnical: number;
}

export interface RiskWeightsApplied {
  domain: number;
  merchantConsistency: number;
  pricing: number;
  ssl: number;
}

export interface OrderDecisionResponse {
  sessionId: string;
  orderId: string;
  sessionStatus: SessionStatusType;
  decision: DecisionType;
  actionTaken: ActionTakenType;
  overallScore: number;
  scores: RiskScores;
  weights: RiskWeightsApplied;
  evidence: Record<string, unknown>;
  reasons: string[];
  merchantVerification: MerchantVerificationSummary;
  captureEligible: boolean;
}
