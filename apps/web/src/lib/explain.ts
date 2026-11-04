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
