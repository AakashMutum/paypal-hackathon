import type { NextFunction, Request, Response } from 'express';
import { executeMerchantInvestigation, findProfileForUrlOrStore } from '../services/agent/agentRunner.service.js';
import { investigationStore } from '../services/investigation/investigationStore.service.js';
import type { FrontendInvestigation } from '../services/investigation/investigation.types.js';
import {
  authorizeApproved,
  captureIfAllowed,
  createAuthorizeOrder,
  currentState,
  isSimulated,
  paymentMode,
  payeeDiffers,
  recordTransition,
  voidAuthorization,
} from '../services/payments/paymentFlow.service.js';
import { hashToken, mayActOnOrder, newOrderToken } from '../middleware/auth.js';
import { sendError } from '../middleware/errors.js';
import {
  acknowledgeBody,
  createOrderBody,
  merchantBody,
  parseBody,
  reportBody,
  scanBody,
} from '../validation/schemas.js';
import { registryAddMerchant } from '../services/registry/registry.service.js';
import { normalizeMerchantUrl } from '../validation/url.js';
import { hashPayeeEmail } from '../services/persistence/auditPrivacy.js';

const param = (req: Request, name: string): string => {
  const raw = req.params[name];
  return (Array.isArray(raw) ? raw[0] : raw) ?? '';
};

/** What the browser sees: everything except the order token hash. */
export function publicView(inv: FrontendInvestigation): Omit<FrontendInvestigation, 'orderTokenHash'> {
  const copy: FrontendInvestigation = { ...inv };
  delete copy.orderTokenHash;
  delete copy.expectedPayeeEmailHash;
  return copy;
}

const notFound = (res: Response, what: string, id: string): void => sendError(res, 404, 'NOT_FOUND', `${what} "${id}" not found`);
const forbidden = (res: Response): void =>
  sendError(res, 403, 'FORBIDDEN', 'A valid x-order-token header for this order is required.');

export async function scanUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseBody(scanBody, req, res);
    if (!body) return;

    const url = normalizeMerchantUrl(body.url);
    if (!url) {
      sendError(
        res,
        400,
        'INVALID_URL',
        'Enter a valid website address, for example https://store-name.example/product/123 or store-name.example.',
      );
      return;
    }

    const scanStart = Date.now();
    const investigation = await executeMerchantInvestigation({ url });
    investigation.simulated = isSimulated();
    investigation.mode = paymentMode();
    investigation.latencyMs = Date.now() - scanStart;
    await investigationStore.add(investigation);
    res.status(200).json(publicView(investigation));
  } catch (err) {
    next(err);
  }
}

export async function createOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseBody(createOrderBody, req, res);
    if (!body) return;

    const profile = findProfileForUrlOrStore(body.storeId ?? body.url ?? '');
    let totalAmount = 0;
    let productName = profile.product;
    if (body.items && body.items.length > 0) {
      totalAmount = body.items.reduce((sum, item) => sum + item.price * item.qty, 0);
      productName = body.items[0].name || profile.product;
    } else if (body.amount !== undefined) {
      totalAmount = body.amount;
    } else {
      totalAmount = profile.price;
    }
    if (!(totalAmount > 0)) {
      sendError(res, 400, 'VALIDATION_ERROR', 'The order total must be greater than zero.');
      return;
    }

    const orderId = `ORD-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
    let created;
    try {
      created = await createAuthorizeOrder({
        amount: totalAmount,
        currency: 'USD',
        description: `TrustOra - ${profile.brand} (${productName})`,
        referenceId: orderId,
        // Only a store pointed at a sandbox business account has a payee PayPal knows.
        ...(profile.sandboxPayee && profile.payeeEmail ? { payeeEmail: profile.payeeEmail } : {}),
      });
    } catch (error) {
      console.error(`[payment] creating the PayPal order failed for ${orderId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      sendError(res, 502, 'PAYPAL_ERROR', `PayPal could not create the order. ${error instanceof Error ? error.message : ''}`.trim());
      return;
    }

    const investigation = await executeMerchantInvestigation({
      orderId,
      paypalOrderId: created.paypalOrderId,
      storeId: profile.storeId,
      url: profile.domain,
      amount: totalAmount,
      benchmark: profile.benchmark,
      currency: 'USD',
      claimedBrand: profile.brand,
      buyerEmail: body.buyerEmail,
      productName,
      payeeEmail: profile.payeeEmail,
      payeeMerchantId: profile.payeeId,
    });

    const orderToken = newOrderToken();
    investigation.orderTokenHash = hashToken(orderToken);
    if (profile.sandboxPayee && profile.payeeEmail) {
      investigation.expectedPayeeEmailHash = hashPayeeEmail(profile.payeeEmail);
    }
    investigation.simulated = created.simulated;
    investigation.mode = created.mode;
    investigation.captureState = 'PENDING';
    investigation.captureReason = 'Waiting for the buyer to approve the payment.';
    await investigationStore.add(investigation);
    await recordTransition(investigation, 'PENDING', 'Order created.', { paypalOrderId: created.paypalOrderId });
    await investigationStore.add(investigation);

    res.status(200).json({
      orderId,
      paypalOrderId: created.paypalOrderId,
      investigationId: investigation.id,
      orderToken,
      approvalUrl: created.approvalUrl,
      simulated: created.simulated,
      mode: created.mode,
    });
  } catch (err) {
    next(err);
  }
}

export async function notifyApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = param(req, 'orderId');
    const inv = await investigationStore.get(orderId);
    if (!inv) return notFound(res, 'Order', orderId);
    if (!mayActOnOrder(req, inv.orderTokenHash)) return forbidden(res);

    // Approving twice must not authorize or capture twice.
    if (inv.captureState === 'PENDING') {
      try {
        if (await payeeDiffers(inv, { emailHash: inv.expectedPayeeEmailHash })) {
          inv.payeeMismatch = true;
        }
      } catch (error) {
        console.error(`[payment] could not read the PayPal order ${inv.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
        await recordTransition(inv, 'FAILED', 'The PayPal order could not be read, so the payee could not be checked.');
      }
      if (currentState(inv) === 'PENDING') {
        await authorizeApproved(inv);
        if (currentState(inv) === 'AUTHORIZED') await captureIfAllowed(inv);
      }
      inv.status = 'COMPLETE';
      await investigationStore.add(inv);
    }

    res.status(200).json({
      status: 'ok',
      decision: inv.verdict,
      captureState: inv.captureState,
      captureReason: inv.captureReason,
      investigationId: inv.id,
      simulated: inv.simulated,
      mode: inv.mode,
    });
  } catch (err) {
    next(err);
  }
}

export async function acknowledgeWarning(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = param(req, 'id');
    if (!parseBody(acknowledgeBody, req, res)) return;
    const inv = await investigationStore.get(id);
    if (!inv) return notFound(res, 'Investigation', id);
    if (!mayActOnOrder(req, inv.orderTokenHash)) return forbidden(res);

    if (inv.verdict !== 'WARN' || inv.payeeMismatch) {
      sendError(res, 409, 'NOT_A_WARNING', 'Only a warning can be acknowledged. A paused payment cannot be overridden.');
      return;
    }
    if (inv.captureState === 'CAPTURED' || inv.captureState === 'VOIDED') {
      sendError(res, 409, 'ALREADY_FINAL', `This payment is already ${inv.captureState}.`);
      return;
    }

    inv.acknowledged = true;
    // If the buyer already approved, the held authorization can be captured now.
    if (inv.authorizationId && (inv.captureState === 'HELD' || inv.captureState === 'AUTHORIZED')) {
      await captureIfAllowed(inv);
    } else {
      inv.captureReason = 'Warning acknowledged. The payment will be captured once the buyer approves it.';
    }
    await investigationStore.add(inv);
    res.status(200).json(publicView(inv));
  } catch (err) {
    next(err);
  }
}

export async function listInvestigations(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json((await investigationStore.list()).map(publicView));
  } catch (err) {
    next(err);
  }
}

export async function getInvestigation(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = param(req, 'id');
    const inv = await investigationStore.get(id);
    if (!inv) return notFound(res, 'Investigation', id);
    res.status(200).json(publicView(inv));
  } catch (err) {
    next(err);
  }
}

export async function cancelOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = param(req, 'id');
    const inv = await investigationStore.get(id);
    if (!inv) return notFound(res, 'Investigation', id);
    if (!mayActOnOrder(req, inv.orderTokenHash)) return forbidden(res);

    const result = await voidAuthorization(inv, 'Cancelled by the buyer.');
    await investigationStore.add(inv);
    if (result.conflict) {
      sendError(res, 409, 'ALREADY_CAPTURED', 'This payment has already been captured and cannot be voided.');
      return;
    }
    if (!result.ok) {
      sendError(res, 502, 'PAYPAL_ERROR', inv.captureReason ?? 'PayPal could not void the authorization.');
      return;
    }
    res.status(200).json(publicView(inv));
  } catch (err) {
    next(err);
  }
}

export async function requestReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = param(req, 'id');
    const inv = await investigationStore.get(id);
    if (!inv) return notFound(res, 'Investigation', id);
    if (!mayActOnOrder(req, inv.orderTokenHash)) return forbidden(res);

    inv.reviewRequested = true;
    await investigationStore.add(inv);
    res.status(200).json(publicView(inv));
  } catch (err) {
    next(err);
  }
}

export async function reportMerchant(req: Request, res: Response): Promise<void> {
  const body = parseBody(reportBody, req, res);
  if (!body) return;
  console.info(`[report] merchant report received for ${body.domain}`);
  res.status(200).json({ success: true, message: 'Merchant report registered' });
}

export async function registerMerchant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = parseBody(merchantBody, req, res);
    if (!body) return;
    const merchantId = await registryAddMerchant(body);
    res.status(200).json({ merchantId, status: body.type === 'INDIVIDUAL' ? 'SUSPECT' : 'VERIFIED' });
  } catch (err) {
    next(err);
  }
}

export async function resetDemo(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await investigationStore.reset();
    res.status(200).json({ success: true, message: 'Demo data reset' });
  } catch (err) {
    next(err);
  }
}
