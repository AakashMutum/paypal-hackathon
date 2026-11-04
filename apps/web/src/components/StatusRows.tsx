import { Banknote, ShieldCheck } from 'lucide-react';
import type { Investigation } from '../types';
import { friendlyPaymentError, captureTone, CAPTURE_WORDS, fundsStatement } from '../lib/payment';
import { merchantCheckLine } from '../lib/explain';
import { scoreText } from '../lib/labels';
import { Pill, RiskBadge } from './ui';

/**
 * The merchant check and the payment status, always as two separate rows. A cleared merchant next
 * to a failed payment is shown as exactly that, never as one green banner.
 */
export function StatusRows({ inv }: { inv: Investigation }) {
  const done = inv.status === 'COMPLETE';
  const hasPayment = Boolean(inv.orderId);
  const funds = fundsStatement(inv.captureState);
  const failure = inv.captureState === 'FAILED' ? friendlyPaymentError(inv.captureReason) : null;
  return <section className="card divide-y divide-ink/10 !p-0" aria-label="Status">
    <div className="p-4 flex gap-3">
      <ShieldCheck size={20} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Merchant check</h2><RiskBadge verdict={done ? inv.verdict : undefined} /></div>
        <p className="text-sm text-ink/80">{done ? merchantCheckLine(inv) : 'Collecting evidence about this merchant…'}</p>
        {done && <p className="font-mono text-xs text-muted">{scoreText(inv.verdict, inv.riskScore)} · confidence {inv.confidence}%</p>}
      </div></div>
    <div className="p-4 flex gap-3">
      <Banknote size={20} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Payment</h2>
          {hasPayment ? <Pill tone={captureTone(inv.captureState)}>{CAPTURE_WORDS[inv.captureState]}</Pill> : <Pill tone="neutral">No payment</Pill>}</div>
        {hasPayment
          ? <p className="text-sm text-ink/80">{failure ? <><b>{failure.title}.</b> {failure.message} </> : null}<b>{funds.text}</b></p>
          : <p className="text-sm text-ink/80">This was a scan only. No payment was started and no funds were captured.</p>}
        {!failure && inv.captureReason && <p className="text-xs text-muted">{inv.captureReason}</p>}
        {failure?.details && <details className="text-xs text-muted"><summary className="cursor-pointer">Details</summary><pre className="whitespace-pre-wrap break-all font-mono mt-1">{failure.details}</pre></details>}
      </div></div>
  </section>;
}
