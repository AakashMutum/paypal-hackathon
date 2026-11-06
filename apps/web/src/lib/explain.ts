// Sentences about what an investigation did and did not establish. No sentence here claims more
// than the investigation's own data says.
import type { Investigation } from '../types';

/**
 * What the "consistency radar" says about a flagged investigation. A payee-mismatch message
 * appears only when the mismatch flag is set; otherwise it says exactly what could not be verified.
 */
export function radarMessage(inv: Pick<Investigation, 'payeeMismatch' | 'signalAvailability' | 'payeeName' | 'reasons' | 'verdict'>): string {
  if (inv.payeeMismatch) return 'The account that receives the payment is not the merchant the storefront claims.';
  const gaps: string[] = [];
  const s = inv.signalAvailability;
  if (s?.page === 'blocked') gaps.push('the merchant page blocked the checker');
  else if (s?.page === 'unavailable' || s?.page === 'empty') gaps.push('the merchant page could not be read');
  if (s?.payee === 'not_provided' || (!s && !inv.payeeName)) gaps.push('no receiving account was supplied');
  if (s?.registry === 'unavailable') gaps.push('the merchant registry could not be reached');
  if (s?.price === 'unavailable') gaps.push('no comparable price was available');
  if (gaps.length > 0) return `Could not verify: ${gaps.join('; ')}.`;
  return inv.reasons[0] ?? 'Some checks did not support the storefront.';
}

/** A one-line description of the merchant check, separate from the payment status. */
export function merchantCheckLine(inv: Pick<Investigation, 'verdict' | 'reasons'>): string {
  return inv.reasons[0] ?? (inv.verdict ? 'The merchant check finished.' : 'The merchant check is running.');
}

export type ClaimMatch = 'MATCH' | 'MISMATCH' | 'NOT_CHECKED';

/**
 * Whether the account that would be paid matches the merchant the storefront claims, from the
 * investigation's own data. MISMATCH needs the mismatch flag or a failed payee check; MATCH needs a
 * passed payee check and a supplied payee; everything else is NOT_CHECKED, never a guess.
 */
export function claimMatch(inv: Pick<Investigation, 'status' | 'payeeMismatch' | 'payeeName' | 'evidence' | 'signalAvailability'>): ClaimMatch {
  if (inv.status !== 'COMPLETE') return 'NOT_CHECKED';
  if (inv.payeeMismatch) return 'MISMATCH';
  const payee = inv.evidence.find((e) => e.node === 'PAYEE');
  const supplied = inv.signalAvailability ? inv.signalAvailability.payee === 'provided' : Boolean(inv.payeeName);
  if (!supplied || !payee) return 'NOT_CHECKED';
  if (payee.status === 'FAIL') return 'MISMATCH';
  if (payee.status === 'PASS') return 'MATCH';
  return 'NOT_CHECKED';
}

export const CLAIM_SENTENCE: Record<ClaimMatch, string> = {
  MATCH: 'The account that would be paid matches the merchant the storefront claims.',
  MISMATCH: 'The account that would be paid is not the merchant the storefront claims.',
  NOT_CHECKED: 'The receiving account could not be confirmed against the storefront.',
};
