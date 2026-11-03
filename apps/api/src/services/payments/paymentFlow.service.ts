import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import {
  authorizePayPalOrder,
  capturePayPalAuthorization,
  createPayPalOrder,
  extractAuthorizationId,
  getPayPalOrder,
  PayPalOrderError,
  voidPayPalAuthorization,
} from '../paypal/paypalOrders.service.js';
import { getBackend } from '../persistence/recordStore.js';
import type { CaptureState, PaymentEvent, PaymentMode, UiVerdict } from '../investigation/investigation.types.js';

/**
 * The PayPal AUTHORIZE flow, with an explicit simulation mode when no sandbox credentials exist.
 *
 *   create order (intent AUTHORIZE) -> buyer approval -> authorize the order -> keep the
 *   authorization id -> capture the authorization, or void it.
 *
 * Every step records an audit event. Failures become the FAILED state with a reason that
 * contains no secrets. Nothing here swallows an error.
 */

export function paymentMode(): PaymentMode {
  return env.paypalClientId && env.paypalClientSecret ? 'sandbox' : 'simulated';
}

export const isSimulated = (): boolean => paymentMode() === 'simulated';

/** Ids made in simulation always start with SIM- so they cannot be mistaken for PayPal ids. */
export function simulatedId(kind: 'ORD' | 'AUTH' | 'CAP'): string {
  return `SIM-${kind}-${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** The slice of a record the payment steps read and write. */
export interface PayableRecord {
  id: string;
  paypalOrderId?: string;
  authorizationId?: string;
  captureId?: string;
  captureState: CaptureState;
  captureReason?: string;
  simulated?: boolean;
  mode?: PaymentMode;
  verdict?: UiVerdict;
  acknowledged?: boolean;
  payeeMismatch?: boolean;
}

/** The state right now. Use it after a step that changes it, so the compiler does not assume it is unchanged. */
export const currentState = (record: { captureState: CaptureState }): CaptureState => record.captureState;

export async function recordTransition(
  record: PayableRecord,
  to: CaptureState,
  reason: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const from = record.captureState;
  record.captureState = to;
  record.captureReason = reason;
  const event: PaymentEvent = {
    investigationId: record.id,
    fromState: from,
    toState: to,
    detail: { reason, ...detail },
    simulated: record.simulated ?? isSimulated(),
  };
  console.info(`[payment] ${record.id} ${from} -> ${to}: ${reason}`);
  await (await getBackend()).addEvent(event);
}

const failureText = (error: unknown): string => {
  if (error instanceof PayPalOrderError) return `PayPal ${error.code}${error.status ? ` (${error.status})` : ''}: ${error.message}`;
  return error instanceof Error ? error.message : 'Unknown error';
};

export interface CreatedPayPalOrder {
  paypalOrderId: string;
  approvalUrl: string;
  simulated: boolean;
  mode: PaymentMode;
}

/** Creates the PayPal order (intent AUTHORIZE). Throws on failure: no fake id is invented. */
export async function createAuthorizeOrder(input: {
  amount: number;
  currency: string;
  description: string;
  referenceId: string;
  payeeEmail?: string;
}): Promise<CreatedPayPalOrder> {
  if (isSimulated()) {
    const id = simulatedId('ORD');
    return {
      paypalOrderId: id,
      approvalUrl: `https://sandbox.paypal.example/simulated-approval?token=${id}`,
      simulated: true,
      mode: 'simulated',
    };
  }
  const order = await createPayPalOrder({
    amount: input.amount,
    currency: input.currency,
    intent: 'AUTHORIZE',
    description: input.description,
    referenceId: input.referenceId,
    requestId: `create-${input.referenceId}`,
    ...(input.payeeEmail ? { payeeEmail: input.payeeEmail } : {}),
  });
  const approve = order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  return {
    paypalOrderId: order.id,
    approvalUrl: approve ?? `https://www.sandbox.paypal.com/checkoutnow?token=${order.id}`,
    simulated: false,
    mode: 'sandbox',
  };
}

/** True when the real PayPal order pays someone other than the expected sandbox payee. */
export async function payeeDiffers(record: PayableRecord, expected: { email?: string; merchantId?: string }): Promise<boolean> {
  if (isSimulated() || !record.paypalOrderId || (!expected.email && !expected.merchantId)) return false;
  const order = await getPayPalOrder(record.paypalOrderId);
  const payee = order.purchase_units?.[0]?.payee;
  if (!payee) return false;
  if (expected.email && payee.email_address && payee.email_address.toLowerCase() !== expected.email.toLowerCase()) return true;
  if (expected.merchantId && payee.merchant_id && payee.merchant_id !== expected.merchantId) return true;
  return false;
}

/** Authorizes the approved order and stores the authorization id. Sets AUTHORIZED or FAILED. */
export async function authorizeApproved(record: PayableRecord): Promise<void> {
  if (record.authorizationId) return;
  if (record.simulated ?? isSimulated()) {
    record.authorizationId = simulatedId('AUTH');
    await recordTransition(record, 'AUTHORIZED', 'Simulated authorization (no PayPal sandbox credentials).', { authorizationId: record.authorizationId });
    return;
  }
  if (!record.paypalOrderId) {
    await recordTransition(record, 'FAILED', 'There is no PayPal order to authorize.');
    return;
  }
  try {
    const order = await authorizePayPalOrder(record.paypalOrderId, `authorize-${record.id}`);
    const authorizationId = extractAuthorizationId(order);
    if (!authorizationId) {
      await recordTransition(record, 'FAILED', 'PayPal did not return an authorization id.');
      return;
    }
    record.authorizationId = authorizationId;
    await recordTransition(record, 'AUTHORIZED', 'PayPal authorized the payment.', { authorizationId });
  } catch (error) {
    await recordTransition(record, 'FAILED', `Authorization failed. ${failureText(error)}`);
  }
}

export interface CaptureGuard {
  allowed: boolean;
  reason?: string;
}

/**
 * Decides whether this record may be captured. A payee mismatch and a PAUSE decision are
 * absolute. A WARN needs a person's acknowledgement. Only an ALLOW, or an acknowledged WARN,
 * passes.
 */
export function captureGuard(record: PayableRecord): CaptureGuard {
  if (record.payeeMismatch) {
    return { allowed: false, reason: 'The account receiving the payment is not the merchant the storefront claims. Capture is blocked.' };
  }
  if (record.verdict === 'PAUSE') return { allowed: false, reason: 'The guardian paused this payment. Capture is blocked.' };
  if (record.verdict === 'WARN' && !record.acknowledged) {
    return { allowed: false, reason: 'The guardian raised a warning. Capture waits for a person to acknowledge it.' };
  }
  if (record.verdict === 'ALLOW' || (record.verdict === 'WARN' && record.acknowledged)) return { allowed: true };
  return { allowed: false, reason: 'There is no decision for this payment yet.' };
}

/** Captures the authorization if the guard allows it. Sets CAPTURED, HELD or FAILED. */
export async function captureIfAllowed(record: PayableRecord): Promise<void> {
  const guard = captureGuard(record);
  if (!guard.allowed) {
    await recordTransition(record, 'HELD', guard.reason ?? 'Capture is not allowed.');
    return;
  }
  if (!record.authorizationId) {
    await recordTransition(record, 'FAILED', 'There is no authorization to capture.');
    return;
  }
  if (record.simulated ?? isSimulated()) {
    record.captureId = simulatedId('CAP');
    await recordTransition(record, 'CAPTURED', 'Simulated capture (no PayPal sandbox credentials).', { captureId: record.captureId });
    return;
  }
  try {
    const capture = await capturePayPalAuthorization(record.authorizationId, `capture-${record.id}`);
    if (capture.status !== 'COMPLETED' && capture.status !== 'PENDING') {
      await recordTransition(record, 'FAILED', `PayPal returned capture status ${capture.status}.`);
      return;
    }
    record.captureId = capture.id;
    await recordTransition(record, 'CAPTURED', 'PayPal captured the authorized payment.', { captureId: capture.id, paypalStatus: capture.status });
  } catch (error) {
    await recordTransition(record, 'FAILED', `Capture failed. ${failureText(error)}`);
  }
}

export interface VoidResult {
  ok: boolean;
  /** HTTP-style hint when not ok. */
  conflict?: boolean;
}

/** Voids the authorization. A captured payment cannot be voided. Sets VOIDED or FAILED. */
export async function voidAuthorization(record: PayableRecord, reason = 'Cancelled and voided.'): Promise<VoidResult> {
  if (record.captureState === 'CAPTURED') return { ok: false, conflict: true };
  if (record.captureState === 'VOIDED') return { ok: true };
  if (!record.authorizationId) {
    await recordTransition(record, 'VOIDED', `${reason} Nothing had been authorized.`);
    return { ok: true };
  }
  if (record.simulated ?? isSimulated()) {
    await recordTransition(record, 'VOIDED', `${reason} (simulated)`);
    return { ok: true };
  }
  try {
    await voidPayPalAuthorization(record.authorizationId, `void-${record.id}`);
    await recordTransition(record, 'VOIDED', `${reason} PayPal voided the authorization.`);
    return { ok: true };
  } catch (error) {
    await recordTransition(record, 'FAILED', `Void failed. ${failureText(error)}`);
    return { ok: false };
  }
}
