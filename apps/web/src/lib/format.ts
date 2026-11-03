import type { Investigation, Verdict } from '../types';
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'cyan' | 'neutral';
export const TONE: Record<Tone, string> = {
  ok: 'text-ok bg-ok-bg border-ok/25', warn: 'text-warn bg-warn-bg border-warn/30', bad: 'text-bad bg-bad-bg border-bad/30',
  info: 'text-electric bg-tint border-electric/25', cyan: 'text-accent bg-accent/10 border-accent/30', neutral: 'text-muted bg-canvas border-ink/10',
};
export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
export const money = (n: number, c = 'USD') => new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(n);
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
export const VERDICT: Record<Verdict, { risk: string; tone: Tone; state: string; headline: string }> = {
  ALLOW: { risk: 'LOW RISK', tone: 'ok', state: 'ALLOWED', headline: 'Merchant verified' },
  WARN: { risk: 'MEDIUM RISK', tone: 'warn', state: 'REVIEW HOLD', headline: 'Inconsistencies detected' },
  PAUSE: { risk: 'HIGH RISK', tone: 'bad', state: 'CAPTURE PAUSED', headline: 'High-risk mismatch detected' },
};
export const CAPTURE_LABEL = { PENDING: 'Pending', AUTHORIZED: 'Authorizing', CAPTURED: 'Captured', HELD: 'Paused', VOIDED: 'Voided', FAILED: 'Failed' } as const;
export function ageLabel(days: number) { return days >= 365 ? `${Math.round(days / 365)} Years` : `${days} Days`; }
export function maskEmail(e = '') { const [l, d] = e.split('@'); return l ? `${l.slice(0, 4)}***@${d ?? ''}` : '—'; }
export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export function telemetry(list: Investigation[]) {
  const ev = list.filter(i => i.status === 'COMPLETE').slice(0, 3).map(i => ({
    id: i.id, time: clock(i.createdAt),
    tone: (i.verdict === 'PAUSE' ? 'bad' : i.verdict === 'WARN' ? 'warn' : 'info') as Tone,
    title: i.verdict === 'PAUSE' ? 'Pre-Auth Block Dispatched' : i.verdict === 'WARN' ? 'Review Hold Placed' : 'PayPal Token Handshake Validated',
    text: i.verdict === 'ALLOW' ? `Recipient profile for ${i.domain} matched with ${i.confidence}% confidence.` : `Intercepted ${i.verdict === 'PAUSE' ? 'fraudulent' : 'suspicious'} checkout from ${i.domain}.`,
  }));
  ev.push({ id: 'model', time: '11:12:49', tone: 'neutral', title: 'Sentinel Neural Model Reloaded', text: 'Risk patterns updated against global fraud database (v4.18.2).' });
  return ev;
}
