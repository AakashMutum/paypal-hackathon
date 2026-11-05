import type { Investigation } from '../types';
import { friendlyPaymentError, CAPTURE_WORDS, fundsStatement } from '../lib/payment';
import { merchantCheckLine } from '../lib/explain';
import { scoreText } from '../lib/labels';
import { CaseVerdict } from './CaseVerdict';

/**
 * The merchant check and the payment status, always as two separate rows. A cleared merchant next
 * to a failed payment is shown as exactly that, never as one green banner.
 */
export function StatusRows({ inv, level = 2 }: { inv: Investigation; level?: 2 | 3 }) {
  const H = level === 2 ? 'h2' : 'h3';
  const done = inv.status === 'COMPLETE';
  const hasPayment = Boolean(inv.orderId);
  const funds = fundsStatement(inv.captureState);
  const failure = inv.captureState === 'FAILED' ? friendlyPaymentError(inv.captureReason) : null;
  return <div className="ruled" aria-label="Status" role="group">
    <div className="py-3 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2"><H className="font-medium">Merchant check</H><CaseVerdict inv={inv} note={false} /></div>
      <p className="text-sm text-muted">{done ? merchantCheckLine(inv) : 'Collecting evidence about this merchant…'}</p>
      {done && <p className="text-xs text-muted num">{scoreText(inv.verdict, inv.riskScore)} · confidence {inv.confidence}%</p>}
    </div>
    <div className="py-3 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2"><H className="font-medium">Payment</H>
        <span className="text-sm">{hasPayment ? CAPTURE_WORDS[inv.captureState] : 'No payment'}</span></div>
      {hasPayment
        ? <p className="text-sm">{failure ? <>{failure.title}. {failure.message} </> : null}<b className="font-medium">{funds.text}</b></p>
        : <p className="text-sm">This was a check only. No payment was started and no funds were captured.</p>}
      {!failure && inv.captureReason && <p className="text-xs text-muted">{inv.captureReason}</p>}
      {failure?.details && <details className="text-xs text-muted"><summary className="cursor-pointer">Details</summary><pre className="whitespace-pre-wrap break-all font-mono mt-1">{failure.details}</pre></details>}
    </div>
  </div>;
}
