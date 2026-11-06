// Payment-side decisions that do not depend on React, so they can be tested on their own.
import type { CaptureState } from '../types';

export type PaymentButtonMode = 'simulated' | 'sdk' | 'unconfigured' | 'loading' | 'unknown';

export interface PaymentButtonInput {
  /** True when the app uses its built-in simulated backend. */
  useMock: boolean;
  /** The API's PayPal mode from GET /health, once known. */
  apiPaypal: string | undefined;
  /** True while GET /health has not answered yet. */
  healthPending: boolean;
  /** True when GET /health failed. */
  healthFailed: boolean;
  /** VITE_PAYPAL_CLIENT_ID. */
  clientId: string | undefined;
}

/**
 * Which payment button to show.
 * - built-in simulated backend, or an API in simulated mode: the simulated button, labelled so;
 * - API in sandbox mode with a client id: PayPal's own button from its SDK;
 * - API in sandbox mode without a client id: no simulated button (it would skip the buyer's
 *   approval and PayPal would answer 422); a clear disabled state instead.
 */
export function paymentButtonMode(i: PaymentButtonInput): PaymentButtonMode {
  if (i.useMock) return 'simulated';
  if (i.healthFailed) return 'unknown';
  if (i.healthPending || !i.apiPaypal) return 'loading';
  if (i.apiPaypal === 'sandbox') return i.clientId?.trim() ? 'sdk' : 'unconfigured';
  return 'simulated';
}

export interface FriendlyError {
  title: string;
  message: string;
  /** The original text, for a collapsed Details section. */
  details: string;
}

const RULES: Array<{ test: RegExp; title: string; message: string }> = [
  { test: /ORDER_NOT_APPROVED|not approved|payer.*action|PAYER_ACTION_REQUIRED/i, title: 'The PayPal order was not approved', message: 'The buyer has not approved this order on PayPal yet, so PayPal cannot authorize it.' },
  { test: /UNPROCESSABLE_ENTITY|\b422\b/i, title: 'PayPal could not process the order', message: 'PayPal refused the request. This usually means the order was not approved by the buyer first.' },
  { test: /INSTRUMENT_DECLINED|declined/i, title: 'The payment method was declined', message: 'PayPal or the buyer\'s payment method declined the payment.' },
  { test: /PAYEE_ACCOUNT|PAYEE_NOT_ENABLED|payee.*(restricted|invalid)/i, title: 'The receiving account cannot accept payments', message: 'The PayPal account that should receive the money is restricted or not set up for this payment.' },
  { test: /AUTHORIZATION_VOIDED|already voided/i, title: 'The authorization was already voided', message: 'This PayPal authorization was cancelled earlier.' },
  { test: /AUTHORIZATION_ALREADY_CAPTURED|already captured/i, title: 'The payment was already captured', message: 'This payment had already been captured, so it cannot be voided or captured again.' },
  { test: /invalid_client|AUTHENTICATION_FAILURE|\b401\b|credentials/i, title: 'PayPal rejected the server\'s credentials', message: 'The PayPal sandbox credentials configured on the server were not accepted. This is a deployment setting, not something the buyer did.' },
  { test: /\b403\b|FORBIDDEN|x-demo-token/i, title: 'Not allowed', message: 'This action needs permission that was not provided.' },
  { test: /\b429\b|rate limit|too many/i, title: 'Too many requests', message: 'Please wait a moment and try again.' },
  { test: /Failed to fetch|NetworkError|network|ECONN|timed? ?out|timeout|\b50[234]\b/i, title: 'Could not reach the server', message: 'The request did not reach the server or took too long. If the server was asleep, try again in a few seconds.' },
];

/** Maps a PayPal or API error to plain words and keeps the raw text for Details. */
export function friendlyPaymentError(raw: string | undefined | null): FriendlyError {
  const details = (raw ?? '').trim();
  for (const rule of RULES) {
    if (rule.test.test(details)) return { title: rule.title, message: rule.message, details };
  }
  return { title: 'The payment step did not complete', message: 'PayPal or the server could not finish this step.', details };
}

/** Whether any money moved, stated for every capture state. */
export function fundsStatement(state: CaptureState): { captured: boolean; text: string } {
  switch (state) {
    case 'CAPTURED':
      return { captured: true, text: 'Funds were captured.' };
    case 'VOIDED':
      return { captured: false, text: 'No funds were captured. The authorization was voided.' };
    case 'FAILED':
      return { captured: false, text: 'No funds were captured.' };
    case 'HELD':
      return { captured: false, text: 'No funds have been captured. The payment is held.' };
    case 'AUTHORIZED':
      return { captured: false, text: 'No funds have been captured yet. The payment is authorized and waiting for the decision.' };
    default:
      return { captured: false, text: 'No funds have been captured.' };
  }
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

/** The tone of the payment status, independent of the merchant check. */
export function captureTone(state: CaptureState): StatusTone {
  switch (state) {
    case 'CAPTURED':
      return 'ok';
    case 'FAILED':
      return 'bad';
    case 'HELD':
      return 'warn';
    case 'VOIDED':
      return 'neutral';
    default:
      return 'info';
  }
}

export const CAPTURE_WORDS: Record<CaptureState, string> = {
  PENDING: 'Not started',
  AUTHORIZED: 'Authorized, not captured',
  CAPTURED: 'Captured',
  HELD: 'Held, not captured',
  VOIDED: 'Voided',
  FAILED: 'Failed',
};

export type StepState = 'done' | 'current' | 'todo' | 'failed' | 'held';
export interface PaymentStep { label: string; detail: string; state: StepState }

/**
 * The four steps of a payment: Authorized, Reviewed, Decision, Outcome. Written from the
 * investigation's own state; a step is only "done" when the data says it happened.
 */
export function paymentSteps(inv: { status: string; verdict?: string; captureState: CaptureState; acknowledged?: boolean }): PaymentStep[] {
  const complete = inv.status === 'COMPLETE';
  const cs = inv.captureState;
  const authorized = cs === 'AUTHORIZED' || cs === 'HELD' || cs === 'CAPTURED' || cs === 'VOIDED' || (cs === 'FAILED' && complete);
  const decision: PaymentStep = !complete || !inv.verdict
    ? { label: 'Decision', detail: 'Waiting for the merchant check', state: 'todo' }
    : inv.verdict === 'ALLOW'
      ? { label: 'Decision', detail: 'Allowed', state: 'done' }
      : inv.verdict === 'WARN'
        ? { label: 'Decision', detail: inv.acknowledged ? 'Needs review; you acknowledged it' : 'Needs review', state: inv.acknowledged ? 'done' : 'held' }
        : { label: 'Decision', detail: 'The payee does not match; nothing will be captured', state: 'held' };
  const outcome: PaymentStep =
    cs === 'CAPTURED' ? { label: 'Captured', detail: 'The money was released to the merchant', state: 'done' }
    : cs === 'VOIDED' ? { label: 'Voided', detail: 'The authorization was cancelled; nothing was taken', state: 'done' }
    : cs === 'FAILED' ? { label: 'Failed', detail: 'A payment step failed; nothing was captured', state: 'failed' }
    : cs === 'HELD' ? { label: 'Held', detail: inv.verdict === 'PAUSE' ? 'Nothing was captured and it never will be' : 'Waiting for you to acknowledge or cancel', state: 'held' }
    : { label: 'Outcome', detail: 'Not decided yet', state: 'todo' };
  return [
    { label: 'Authorized', detail: authorized ? 'The payment is reserved on PayPal; nothing is taken yet' : 'Not authorized yet', state: authorized ? 'done' : 'current' },
    { label: 'Reviewed', detail: complete ? 'The merchant check finished' : 'The merchant check is running', state: complete ? 'done' : authorized ? 'current' : 'todo' },
    decision,
    outcome,
  ];
}
