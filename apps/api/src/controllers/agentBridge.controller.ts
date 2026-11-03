import type { NextFunction, Request, Response } from 'express';
import type { AgentResult, InvestigationRequest } from '@checkout-guardian/agent';
import { runAgent } from '../services/agent/agentRunner.service.js';
import { checkoutStore, type AgentCheckoutRecord } from '../services/investigation/checkoutStore.service.js';
import { checkSpendPolicy, policyStore } from '../services/persistence/policyStore.service.js';
import {
  authorizeApproved,
  captureIfAllowed,
  createAuthorizeOrder,
  currentState,
  recordTransition,
  voidAuthorization,
} from '../services/payments/paymentFlow.service.js';
import { loadStoreCatalog } from '../config/storeCatalog.js';
import { sendError } from '../middleware/errors.js';
import { checkoutBody, finalizeBody, investigationBody, parseBody, policyBody } from '../validation/schemas.js';

const toUrl = (value: string): string => (/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
const hostOf = (value: string): string => {
  try {
    return new URL(toUrl(value)).hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
};

const param = (req: Request, name: string): string => {
  const raw = req.params[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
};

const hardBlock = (result: AgentResult): boolean => result.hardRulesTriggered.some((r) => r.rule === 'HF1' || r.rule === 'HF2');

/** POST /api/v1/investigations: the MCP client's request, with the older `domain` field still accepted. */
export async function investigateMerchant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseBody(investigationBody, req, res);
    if (!body) return;

    const merchantUrl = toUrl(body.merchantUrl ?? body.domain ?? '');
    const amount = body.transactionAmount ?? body.amount;
    const request: InvestigationRequest = {
      orderId: body.orderId ?? `INV-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
      merchantUrl,
      ...(body.claimedBrand ? { claimedBrand: body.claimedBrand } : {}),
      ...(amount !== undefined ? { transactionAmount: amount } : {}),
      currency: body.currency ?? 'USD',
      ...(body.payee ? { payee: body.payee } : {}),
      ...(body.agentId ? { agentId: body.agentId } : {}),
      ...(body.items ? { items: body.items } : {}),
    };

    const run = await runAgent(request);
    res.status(200).json({
      success: true,
      data: run.result.verdict,
      meta: { provenance: run.provenance, similarCases: run.similarCases, hardRules: run.result.hardRulesTriggered.map((r) => r.rule) },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /api/v1/checkout/orders: holds an order. Nothing is captured here. */
export async function createAgentCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseBody(checkoutBody, req, res);
    if (!body) return;

    const merchantUrl = toUrl(body.merchantUrl ?? body.domain ?? body.merchant?.domain ?? '');
    const domain = hostOf(merchantUrl);
    const policy = await checkSpendPolicy(body.agentId, body.amount, body.currency);
    if (!policy.allowed) {
      sendError(res, 403, 'POLICY_VIOLATION', policy.message ?? 'This purchase is outside the agent spending policy.', { cap: policy.cap });
      return;
    }

    const checkoutId = `CHK-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    let created;
    try {
      created = await createAuthorizeOrder({
        amount: body.amount,
        currency: body.currency,
        description: `Agent checkout - ${domain}`,
        referenceId: checkoutId,
      });
    } catch (error) {
      console.error(`[payment] creating the PayPal order failed for ${checkoutId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      sendError(res, 502, 'PAYPAL_ERROR', 'PayPal could not create the order.');
      return;
    }

    const payee = body.payee ?? (body.merchantId ? { merchantId: body.merchantId, ...(body.payeeEmail ? { email: body.payeeEmail } : {}) } : undefined);
    const record: AgentCheckoutRecord = {
      id: checkoutId,
      checkoutId,
      ...(body.agentId ? { agentId: body.agentId } : {}),
      paypalOrderId: created.paypalOrderId,
      merchantUrl,
      domain,
      claimedBrand: body.claimedBrand ?? body.merchant?.brand,
      ...(payee ? { payee } : { payee: { merchantId: 'UNKNOWN' } }),
      ...(body.items ? { items: body.items } : {}),
      amount: body.amount,
      currency: body.currency,
      status: 'AWAITING_APPROVAL',
      captureState: 'PENDING',
      simulated: created.simulated,
      mode: created.mode,
      createdAt: new Date().toISOString(),
    };
    await checkoutStore.save(record);
    await recordTransition(record, 'PENDING', 'Checkout created. Waiting for approval.', { paypalOrderId: created.paypalOrderId });
    await checkoutStore.save(record);

    res.status(200).json({
      success: true,
      data: {
        checkoutId,
        approvalUrl: created.approvalUrl,
        status: 'AWAITING_APPROVAL',
        simulated: created.simulated,
        mode: created.mode,
      },
    });
  } catch (err) {
    next(err);
  }
}

const summary = (record: AgentCheckoutRecord, extra: Record<string, unknown> = {}) => ({
  checkoutId: record.checkoutId,
  status: record.status,
  decision: record.verdict,
  captureState: record.captureState,
  captureReason: record.captureReason,
  simulated: record.simulated,
  mode: record.mode,
  ...extra,
});

/** POST /api/v1/checkout/orders/:checkoutId/finalize: authorize, investigate, then capture, hold or void. */
export async function finalizeAgentCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const checkoutId = param(req, 'checkoutId');
    const body = parseBody(finalizeBody, req, res);
    if (!body) return;

    const record = await checkoutStore.get(checkoutId);
    if (!record) {
      sendError(res, 404, 'ORDER_NOT_FOUND', `Checkout session "${checkoutId}" not found`);
      return;
    }
    // A finished checkout is never acted on twice.
    if (['CAPTURED', 'PAUSED', 'ABORTED', 'FAILED'].includes(record.status)) {
      res.status(200).json({ success: true, data: summary(record) });
      return;
    }

    if (body.humanDecision === 'abort') {
      await voidAuthorization(record, 'Aborted by a person.');
      record.status = currentState(record) === 'FAILED' ? 'FAILED' : 'ABORTED';
      await checkoutStore.save(record);
      res.status(200).json({ success: true, data: summary(record) });
      return;
    }

    if (record.captureState === 'PENDING') {
      await authorizeApproved(record);
      if (currentState(record) === 'FAILED') {
        record.status = 'FAILED';
        await checkoutStore.save(record);
        sendError(res, 502, 'UPSTREAM_ERROR', record.captureReason ?? 'PayPal could not authorize the payment.');
        return;
      }
    }

    const request: InvestigationRequest = {
      orderId: record.checkoutId,
      merchantUrl: record.merchantUrl,
      transactionAmount: record.amount,
      currency: record.currency,
      ...(record.claimedBrand ? { claimedBrand: record.claimedBrand } : {}),
      payee: record.payee,
      ...(record.agentId ? { agentId: record.agentId } : {}),
      ...(record.items ? { items: record.items } : {}),
    };
    const run = await runAgent(request);
    const result = run.result;
    const decision = result.verdict.decision;

    record.verdict = decision;
    record.payeeMismatch = hardBlock(result);
    record.acknowledged = decision === 'WARN' && body.humanDecision === 'proceed';

    if (decision === 'PAUSE' || record.payeeMismatch) {
      record.verdict = 'PAUSE';
      await voidAuthorization(record, 'The guardian paused this payment.');
      record.status = 'PAUSED';
      await checkoutStore.save(record);
      res.status(200).json({ success: true, data: summary(record, { verdict: result.verdict }) });
      return;
    }

    await captureIfAllowed(record);
    if (currentState(record) === 'CAPTURED') {
      record.status = 'CAPTURED';
    } else if (currentState(record) === 'FAILED') {
      record.status = 'FAILED';
    } else {
      record.status = 'NEEDS_HUMAN_DECISION';
    }
    await checkoutStore.save(record);

    if (record.status === 'FAILED') {
      sendError(res, 502, 'UPSTREAM_ERROR', record.captureReason ?? 'PayPal could not capture the payment.');
      return;
    }
    res.status(200).json({ success: true, data: summary(record, { verdict: result.verdict }) });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/v1/policies/:agentId */
export async function setSpendPolicy(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const agentId = param(req, 'agentId');
    const body = parseBody(policyBody, req, res);
    if (!body) return;
    await policyStore.set({ agentId, ...body });
    res.status(200).json({ success: true, data: { agentId, policy: body } });
  } catch (err) {
    next(err);
  }
}

export async function getMarketplaceListings(_req: Request, res: Response): Promise<void> {
  res.status(200).json({
    success: true,
    data: loadStoreCatalog().map((s) => ({
      id: s.storeId,
      title: s.product,
      domain: s.domain,
      price: s.price,
      currency: s.currency,
    })),
  });
}

