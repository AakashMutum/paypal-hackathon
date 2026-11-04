import type { Investigation, Verdict } from '../types';
import type { Tone } from './labels';
export type { Tone } from './labels';
export const TONE: Record<Tone, string> = {
  ok: 'text-ok bg-ok-bg border-ok/25', warn: 'text-warn bg-warn-bg border-warn/30', bad: 'text-bad bg-bad-bg border-bad/30',
  info: 'text-electric bg-tint border-electric/25', cyan: 'text-accent bg-accent/10 border-accent/30', neutral: 'text-muted bg-canvas border-ink/10',
};
export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
export const money = (n: number | null | undefined, c = 'USD') =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
export const VERDICT: Record<Verdict, { tone: Tone; state: string; headline: string }> = {
  ALLOW: { tone: 'ok', state: 'Cleared', headline: 'No problems found' },
  WARN: { tone: 'warn', state: 'Needs review', headline: 'Some claims could not be confirmed' },
  PAUSE: { tone: 'bad', state: 'Held', headline: 'The payee does not match the storefront' },
};
export const CAPTURE_LABEL = { PENDING: 'Not started', AUTHORIZED: 'Authorized', CAPTURED: 'Captured', HELD: 'Held', VOIDED: 'Voided', FAILED: 'Failed' } as const;
export function ageLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return 'Unknown';
  return days >= 365 ? `${Math.round(days / 365)} Years` : `${days} Days`;
}
export function maskEmail(e = '') { const [l, d] = e.split('@'); return l ? `${l.slice(0, 4)}***@${d ?? ''}` : '—'; }
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export function telemetry(list: Investigation[]) {
  return list.filter(i => i.status === 'COMPLETE').slice(0, 3).map(i => ({
    id: i.id, time: clock(i.createdAt),
    tone: (i.verdict === 'PAUSE' ? 'bad' : i.verdict === 'WARN' ? 'warn' : 'info') as Tone,
    title: i.verdict === 'PAUSE' ? 'Capture blocked' : i.verdict === 'WARN' ? 'Needs review' : 'Checkout cleared',
    text: i.verdict === 'ALLOW' ? `No problems found for ${i.domain} (confidence ${i.confidence}%).` : `${i.verdict === 'PAUSE' ? 'Blocked capture for' : 'Held a checkout from'} ${i.domain}.`,
  }));
}
