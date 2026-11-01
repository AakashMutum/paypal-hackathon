export function successResponse(data, meta = {}) {
  return { success: true, data, meta };
}

export function errorResponse(code, message, details = undefined) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { success: false, error };
}

export const RiskWeights = {
  DOMAIN: 0.30,
  MERCHANT_CONSISTENCY: 0.40,
  PRICING: 0.20,
  SSL_TECHNICAL: 0.10,
};

export const DecisionTypes = {
  ALLOW: 'ALLOW',
  WARN: 'WARN',
  PAUSE: 'PAUSE',
};

export const DecisionThresholds = {
  ALLOW_MAX: 39,
  WARN_MIN: 40,
  WARN_MAX: 74,
  PAUSE_MIN: 75,
};

export const SessionStatus = {
  CREATED: 'CREATED',
  EVALUATING: 'EVALUATING',
  PENDING_REVIEW: 'PENDING_REVIEW',
  ALLOWED: 'ALLOWED',
  WARNED: 'WARNED',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export const MerchantStatus = {
  UNVERIFIED: 'UNVERIFIED',
  VERIFIED_GENUINE: 'VERIFIED_GENUINE',
  FLAGGED_SUSPICIOUS: 'FLAGGED_SUSPICIOUS',
  CONFIRMED_FRAUD: 'CONFIRMED_FRAUD',
};
