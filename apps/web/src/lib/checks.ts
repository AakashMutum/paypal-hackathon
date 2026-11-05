// What each check did and did not establish. A check that did not run is "Not checked" in a neutral
// style; it is never a pass. Pure functions, no browser APIs, so the tests can run them.
import type { Evidence, EvidenceField, Investigation, NodeId, SignalAvailability } from '../types';
import { evidenceKey } from './labels';

/** pass, warn, fail, none (did not run) and info (a plain finding in a group that is not clean). */
export type MarkState = 'pass' | 'warn' | 'fail' | 'none' | 'info';

export const MARK_WORD: Record<MarkState, string> = {
  pass: 'Passed', warn: 'Needs attention', fail: 'Failed', none: 'Not checked', info: 'Noted',
};

/** Findings that say a check could not run, whatever status the group carries. */
const NOT_RUN = new Set([
  'PRICE_UNKNOWN', 'PAYEE_UNKNOWN', 'IDENTITY_UNVERIFIABLE', 'TOOL_UNAVAILABLE',
  'PRODUCT_DATA_UNAVAILABLE', 'PAGE_UNAVAILABLE', 'PAGE_EMPTY', 'PAGE_BLOCKED',
]);

/** False when the signal behind a group never ran (no price comparison, no payee supplied). */
export function groupRan(node: NodeId, av?: SignalAvailability): boolean {
  if (!av) return true;
  if (node === 'PRICE') return av.price === 'known';
  if (node === 'PAYEE') return av.payee === 'provided';
  return true;
}

export function groupState(e: Evidence, av?: SignalAvailability): MarkState {
  if (!groupRan(e.node, av) || /^not checked$/i.test(e.badge.trim())) return 'none';
  return e.status === 'PASS' ? 'pass' : e.status === 'WARN' ? 'warn' : 'fail';
}

export function fieldState(f: EvidenceField, group: MarkState): MarkState {
  if (NOT_RUN.has(evidenceKey(f.label))) return 'none';
  if (group === 'none') return 'none';
  if (f.flag) return group === 'fail' ? 'fail' : 'warn';
  return group === 'pass' ? 'pass' : 'info';
}

/** "about 24 years", "about 5 months", "12 days". */
export function humanAge(days: number | null | undefined): string {
  if (days === null || days === undefined || Number.isNaN(days)) return 'Unknown';
  if (days < 1) return 'under a day';
  if (days < 45) return `${Math.round(days)} ${Math.round(days) === 1 ? 'day' : 'days'}`;
  if (days < 365) { const m = Math.max(2, Math.round(days / 30.4)); return `about ${m} months`; }
  const y = Math.round(days / 365.25);
  return `about ${y} ${y === 1 ? 'year' : 'years'}`;
}

/** A finding value in plain words. Domain ages that arrive as days become years or months. */
export function findingText(f: EvidenceField): { text: string; detail?: string } {
  if (evidenceKey(f.label) === 'DOMAIN_AGE') {
    const m = /(\d[\d,]*)\s*days?/i.exec(f.value);
    if (m) {
      const days = Number(m[1].replace(/,/g, ''));
      return { text: humanAge(days), ...(days >= 45 ? { detail: `${days.toLocaleString('en-US')} days` } : {}) };
    }
  }
  return { text: f.value };
}

/** True for a scan that had no payee: nothing was compared against the receiving account. */
export function payeeNotChecked(inv: Pick<Investigation, 'signalAvailability' | 'payeeName' | 'orderId'>): boolean {
  return inv.signalAvailability ? inv.signalAvailability.payee !== 'provided' : !inv.payeeName;
}

export interface Outcome { headline: string; note?: string }

/**
 * The plain headline over a finished case. The API verdict is never changed; a clean ALLOW with no
 * payee supplied is worded as "No red flags found" and says that the receiving account was not checked.
 */
export function outcome(inv: Pick<Investigation, 'status' | 'verdict' | 'signalAvailability' | 'payeeName' | 'orderId'>): Outcome {
  if (inv.status !== 'COMPLETE' || !inv.verdict) return { headline: 'Checking' };
  if (inv.verdict === 'ALLOW') {
    return payeeNotChecked(inv)
      ? { headline: 'No red flags found', note: 'The receiving account was not checked.' }
      : { headline: 'Allowed' };
  }
  return { headline: inv.verdict === 'WARN' ? 'Needs review' : 'Held' };
}

/**
 * Counts for the one-line summary under the check form. A clean verdict with no payee supplied is
 * counted apart (noFlags), because nothing was compared with the receiving account.
 */
export function summaryCounts(list: Array<Pick<Investigation, 'status' | 'verdict' | 'signalAvailability' | 'payeeName' | 'orderId'>>): { total: number; cleared: number; noFlags: number; review: number; held: number } {
  const done = list.filter((i) => i.status === 'COMPLETE');
  const allow = done.filter((i) => i.verdict === 'ALLOW');
  const noFlags = allow.filter((i) => payeeNotChecked(i)).length;
  return {
    total: done.length,
    cleared: allow.length - noFlags,
    noFlags,
    review: done.filter((i) => i.verdict === 'WARN').length,
    held: done.filter((i) => i.verdict === 'PAUSE').length,
  };
}

/** The one plain sentence in the decision band. The reasons are listed separately, under "Why". */
export function decisionSentence(inv: Pick<Investigation, 'status' | 'verdict' | 'signalAvailability' | 'payeeName' | 'orderId'>): string {
  if (inv.status !== 'COMPLETE' || !inv.verdict) return 'Collecting evidence about this merchant…';
  if (inv.verdict === 'ALLOW') {
    return payeeNotChecked(inv)
      ? 'The receiving account was not checked, so this is not a clearance to pay.'
      : 'No problems were found. The payment can be captured.';
  }
  return inv.verdict === 'WARN'
    ? 'Something could not be verified. A person must confirm before the payment is captured.'
    : 'The evidence does not support the storefront. The payment is never captured.';
}

/** At most three reasons, most important first (the API already orders them). */
export const topReasons = (reasons: readonly string[] | undefined): string[] => (reasons ?? []).filter(Boolean).slice(0, 3);
