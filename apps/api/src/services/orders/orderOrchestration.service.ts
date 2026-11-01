import { randomUUID } from 'node:crypto';
import {
  DecisionTypes,
  SessionStatus,
  ActionTaken,
  type CreateOrderRequest,
  type CreateOrderResponse,
  type CaptureOrderRequest,
  type CaptureOrderResponse,
  type OrderDecisionResponse,
  type DecisionType,
  type SessionStatusType,
  type ActionTakenType,
} from '@checkout-guardian/contracts';
import { query, getPool } from '../../database/connection.js';
import {
  createPayPalOrder,
  getPayPalOrder,
  capturePayPalOrder,
  type PayPalOrderResponse,
} from '../paypal/paypalOrders.service.js';
import {
  verifyMerchantIdentity,
  type ExpectedMerchant,
  type VerificationResult,
} from '../verification/merchantVerification.service.js';
import { evaluateRisk, type RiskEvaluationResult } from '../risk/riskEngine.service.js';

export class OrchestrationError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, code: string, status: number = 400, details?: unknown) {
    super(message);
    this.name = 'OrchestrationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Extracts a normalized domain hostname from a URL string.
 */
export function extractDomain(urlStr: string): string {
  try {
    const url = new URL(urlStr.startsWith('http') ? urlStr : `https://${urlStr}`);
    return url.hostname.toLowerCase();
  } catch {
    return urlStr.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  }
}

/**
 * Looks up or initializes a merchant record for the given domain.
 */
export async function getOrCreateMerchant(params: {
  domain: string;
  claimedName?: string;
  merchantId?: string;
  payeeEmail?: string;
}): Promise<ExpectedMerchant | null> {
  const pool = getPool();
  if (!pool) return null;

  const domain = params.domain.toLowerCase().trim();

  // Try finding existing merchant by domain or merchant_id
  const existing = await query<ExpectedMerchant>(
    `SELECT id, merchant_id, domain, claimed_name, payee_email, verification_status, reputation_score
     FROM merchant_records
     WHERE domain = $1
        OR (merchant_id IS NOT NULL AND merchant_id = $2)
     LIMIT 1`,
    [domain, params.merchantId || null]
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  // Create initial merchant record
  const claimedName = params.claimedName || domain;
  const insertResult = await query<ExpectedMerchant>(
    `INSERT INTO merchant_records (
       domain, claimed_name, merchant_id, payee_email, verification_status, reputation_score
     ) VALUES ($1, $2, $3, $4, 'UNVERIFIED', 50.00)
     RETURNING id, merchant_id, domain, claimed_name, payee_email, verification_status, reputation_score`,
    [domain, claimedName, params.merchantId || null, params.payeeEmail || null]
  );

  return insertResult.rows[0];
}

/**
 * Creates a checkout session in the database and creates an order in PayPal Sandbox.
 */
export async function createCheckoutOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
  if (!req.storefrontUrl || typeof req.storefrontUrl !== 'string') {
    throw new OrchestrationError('storefrontUrl is required and must be a valid URL string', 'INVALID_STOREFRONT_URL', 400);
  }

  if (typeof req.amount !== 'number' || req.amount <= 0 || isNaN(req.amount)) {
    throw new OrchestrationError('amount must be a positive number greater than 0', 'INVALID_AMOUNT', 400);
  }

  const currency = (req.currency || 'USD').toUpperCase().trim();
  if (currency.length !== 3) {
    throw new OrchestrationError('currency must be a valid 3-letter ISO code', 'INVALID_CURRENCY', 400);
  }

  const domain = extractDomain(req.storefrontUrl);
  const sessionId = `cs_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  // Find or create merchant
  const merchant = await getOrCreateMerchant({
    domain,
    claimedName: req.claimedMerchantName,
    merchantId: req.merchantId,
    payeeEmail: req.payeeEmail,
  });

  const pool = getPool();
  if (pool) {
    await query(
      `INSERT INTO checkout_sessions (
         id, merchant_id, storefront_url, domain, amount, currency, status, buyer_reference, order_items, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        sessionId,
        merchant?.id || null,
        req.storefrontUrl,
        domain,
        req.amount,
        currency,
        SessionStatus.CREATED,
        req.buyerReference || null,
        JSON.stringify(req.orderItems || []),
        JSON.stringify(req.metadata || {}),
      ]
    );
  }

  // Create order in PayPal
  const paypalOrder = await createPayPalOrder({
    amount: req.amount,
    currency,
    referenceId: sessionId,
    requestId: sessionId,
    payeeEmail: merchant?.payee_email || req.payeeEmail,
    payeeMerchantId: merchant?.merchant_id || req.merchantId,
  });

  if (pool) {
    await query(
      `UPDATE checkout_sessions
       SET paypal_order_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [paypalOrder.id, sessionId]
    );
  }

  const approveLink = paypalOrder.links?.find((l) => l.rel === 'approve')?.href;

  return {
    sessionId,
    orderId: paypalOrder.id,
    status: paypalOrder.status,
    amount: req.amount.toFixed(2),
    currency,
    approvalUrl: approveLink,
  };
}

/**
 * Finds checkout session by either Checkout Guardian sessionId or PayPal orderId.
 */
export async function findCheckoutSession(orderOrSessionId: string): Promise<Record<string, any> | null> {
  const pool = getPool();
  if (!pool) return null;

  const result = await query(
    `SELECT cs.*, mr.domain as merchant_domain, mr.claimed_name, mr.payee_email as merchant_payee_email,
            mr.merchant_id as merchant_registered_id, mr.verification_status as merchant_status,
            mr.reputation_score as merchant_reputation
     FROM checkout_sessions cs
     LEFT JOIN merchant_records mr ON cs.merchant_id = mr.id
     WHERE cs.id = $1 OR cs.paypal_order_id = $1
     LIMIT 1`,
    [orderOrSessionId]
  );

  return result.rows[0] || null;
}

/**
 * Evaluates the risk of a PayPal order, performs merchant payee verification,
 * records the decision in the database, and returns the full risk assessment report.
 */
export async function evaluateOrderRisk(orderOrSessionId: string): Promise<OrderDecisionResponse> {
  const session = await findCheckoutSession(orderOrSessionId);
  const paypalOrderId = session?.paypal_order_id || orderOrSessionId;

  // Fetch PayPal order
  const paypalOrder = await getPayPalOrder(paypalOrderId);

  // Retrieve expected merchant
  let expectedMerchant: ExpectedMerchant | null = null;
  if (session) {
    expectedMerchant = {
      id: session.merchant_id,
      domain: session.domain || session.merchant_domain,
      claimed_name: session.claimed_name || session.domain,
      merchant_id: session.merchant_registered_id,
      payee_email: session.merchant_payee_email,
      verification_status: session.merchant_status,
    };
  }

  // Step 1: Merchant Identity Verification
  const verification: VerificationResult = verifyMerchantIdentity(paypalOrder, expectedMerchant);

  // In our risk scoring: higher score = higher risk.
  // In merchant_records: reputation_score 100 = best, 0 = worst.
  // Default is 50.00 for unverified/new merchants.
  const reputation = session?.merchant_reputation !== undefined
    ? Number(session.merchant_reputation)
    : 50.00;
  const domainRiskScore = Math.max(0, Math.min(100, 100 - reputation));

  // Step 2: Risk Scoring & Decision
  const riskResult: RiskEvaluationResult = evaluateRisk(verification, {
    domainReputation: domainRiskScore,
  });

  const sessionId = session?.id || `cs_${Date.now()}`;
  const pool = getPool();

  if (pool && session) {
    // Persist risk assessment
    const insertRisk = await query<{ id: string }>(
      `INSERT INTO risk_assessments (
         session_id, merchant_id, overall_score, domain_reputation_score,
         merchant_consistency_score, pricing_anomaly_score, ssl_technical_score,
         weights_applied, evidence
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        session.id,
        session.merchant_id,
        riskResult.overallScore,
        riskResult.scores.domainReputation,
        riskResult.scores.merchantConsistency,
        riskResult.scores.pricingAnomaly,
        riskResult.scores.sslTechnical,
        JSON.stringify(riskResult.weights),
        JSON.stringify(riskResult.evidence),
      ]
    );

    const riskAssessmentId = insertRisk.rows[0]?.id;

    // Persist payment decision
    let sessionStatus: SessionStatusType = SessionStatus.CREATED;
    let actionTaken: ActionTakenType = ActionTaken.EVALUATED;

    if (riskResult.decision === DecisionTypes.ALLOW) {
      sessionStatus = SessionStatus.ALLOWED;
      actionTaken = ActionTaken.PROCEED;
    } else if (riskResult.decision === DecisionTypes.WARN) {
      sessionStatus = SessionStatus.WARNED;
      actionTaken = ActionTaken.WARN_DISPLAYED;
    } else {
      sessionStatus = SessionStatus.PAUSED;
      actionTaken = ActionTaken.CAPTURE_PAUSED;
    }

    await query(
      `INSERT INTO payment_decisions (
         session_id, risk_assessment_id, decision, action_taken, reasons, intervention_triggered
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        riskAssessmentId || null,
        riskResult.decision,
        actionTaken,
        JSON.stringify(riskResult.reasons),
        riskResult.decision !== DecisionTypes.ALLOW,
      ]
    );

    // Update checkout session status
    await query(
      `UPDATE checkout_sessions
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [sessionStatus, session.id]
    );
  }

  let finalSessionStatus: SessionStatusType = SessionStatus.CREATED;
  if (riskResult.decision === DecisionTypes.ALLOW) finalSessionStatus = SessionStatus.ALLOWED;
  else if (riskResult.decision === DecisionTypes.WARN) finalSessionStatus = SessionStatus.WARNED;
  else finalSessionStatus = SessionStatus.PAUSED;

  return {
    sessionId,
    orderId: paypalOrder.id,
    sessionStatus: finalSessionStatus,
    decision: riskResult.decision,
    actionTaken:
      riskResult.decision === DecisionTypes.ALLOW
        ? ActionTaken.PROCEED
        : riskResult.decision === DecisionTypes.WARN
        ? ActionTaken.WARN_DISPLAYED
        : ActionTaken.CAPTURE_PAUSED,
    overallScore: riskResult.overallScore,
    scores: riskResult.scores,
    weights: riskResult.weights,
    evidence: riskResult.evidence,
    reasons: riskResult.reasons,
    merchantVerification: verification.summary,
    captureEligible: riskResult.captureEligible,
  };
}

/**
 * Executes payment capture for a PayPal order with backend risk decision enforcement.
 * Enforces:
 * - ALLOW: Captured after payee verification.
 * - WARN: Requires explicit user acknowledgement (userAcknowledged: true).
 * - PAUSE: Unconditionally rejected. Mismatch cannot be bypassed.
 */
export async function captureCheckoutOrder(
  orderOrSessionId: string,
  options: CaptureOrderRequest = {}
): Promise<CaptureOrderResponse> {
  const session = await findCheckoutSession(orderOrSessionId);
  const paypalOrderId = session?.paypal_order_id || orderOrSessionId;

  // Check if session is already completed (idempotency)
  if (session && session.status === SessionStatus.COMPLETED) {
    const existingCaptureId = session.metadata?.capture_id || 'ALREADY_COMPLETED';
    return {
      sessionId: session.id,
      orderId: paypalOrderId,
      captureId: existingCaptureId,
      status: 'COMPLETED',
      paymentState: 'COMPLETED',
      decision: DecisionTypes.ALLOW,
      actionTaken: ActionTaken.PROCEED,
    };
  }

  // Check if session is already paused
  if (session && session.status === SessionStatus.PAUSED) {
    throw new OrchestrationError(
      'Payment capture is paused for this transaction due to high-risk triggers. Capture cannot proceed.',
      'CAPTURE_PAUSED',
      403,
      { orderId: paypalOrderId, decision: DecisionTypes.PAUSE }
    );
  }

  // Run or verify risk evaluation
  const evaluation = await evaluateOrderRisk(paypalOrderId);

  // Enforce decision
  if (evaluation.decision === DecisionTypes.PAUSE) {
    throw new OrchestrationError(
      'Payment capture is blocked: critical risk anomalies or payee mismatch detected',
      'CAPTURE_PAUSED',
      403,
      {
        orderId: paypalOrderId,
        decision: evaluation.decision,
        reasons: evaluation.reasons,
        overallScore: evaluation.overallScore,
        merchantVerification: evaluation.merchantVerification,
      }
    );
  }

  if (evaluation.decision === DecisionTypes.WARN) {
    if (!options.userAcknowledged) {
      throw new OrchestrationError(
        'Warning acknowledgement required: transaction carries elevated risk. Explicit user acknowledgement is required before capture.',
        'WARNING_ACKNOWLEDGEMENT_REQUIRED',
        409,
        {
          orderId: paypalOrderId,
          decision: evaluation.decision,
          reasons: evaluation.reasons,
          overallScore: evaluation.overallScore,
          requiresAcknowledgement: true,
        }
      );
    }
  }

  // Safe to capture!
  const captureResult = await capturePayPalOrder(paypalOrderId, session?.id);
  const purchaseUnit = captureResult.purchase_units?.[0];
  const captureDetails = purchaseUnit?.payments?.captures?.[0];
  const captureId = captureDetails?.id;

  const actionTaken: ActionTakenType = options.userAcknowledged
    ? ActionTaken.USER_OVERRIDE
    : ActionTaken.PROCEED;

  const pool = getPool();
  if (pool && session) {
    const updatedMetadata = {
      ...(session.metadata || {}),
      capture_id: captureId,
      capture_status: captureDetails?.status || 'COMPLETED',
      captured_at: new Date().toISOString(),
      user_override_reason: options.overrideReason || null,
    };

    await query(
      `UPDATE checkout_sessions
       SET status = $1, metadata = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [SessionStatus.COMPLETED, JSON.stringify(updatedMetadata), session.id]
    );

    await query(
      `INSERT INTO payment_decisions (
         session_id, decision, action_taken, reasons, intervention_triggered, override_details
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        evaluation.decision,
        actionTaken,
        JSON.stringify(evaluation.reasons),
        options.userAcknowledged || false,
        options.userAcknowledged
          ? JSON.stringify({ acknowledged: true, reason: options.overrideReason })
          : null,
      ]
    );
  }

  return {
    sessionId: session?.id || evaluation.sessionId,
    orderId: paypalOrderId,
    captureId,
    status: captureResult.status,
    paymentState: 'COMPLETED',
    decision: evaluation.decision,
    actionTaken,
  };
}
