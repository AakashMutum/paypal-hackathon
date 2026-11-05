import type { Investigation } from '../types';
import { outcome, payeeNotChecked } from '../lib/checks';
import { VerdictMark } from './ui';
import { VerdictText } from './ui';

/**
 * The decision in a list or table. A clean result with no payee supplied reads "No red flags found"
 * and says the receiving account was not checked; the API verdict itself is unchanged.
 */
export function CaseVerdict({ inv, note = true }: { inv: Pick<Investigation, 'status' | 'verdict' | 'signalAvailability' | 'payeeName' | 'orderId'>; note?: boolean }) {
  if (inv.status === 'COMPLETE' && inv.verdict === 'ALLOW' && payeeNotChecked(inv)) {
    return <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1.5 font-medium whitespace-nowrap"><VerdictMark verdict="ALLOW" size={16} className="text-success" />{outcome(inv).headline}</span>
      {note && <span className="label pl-[22px]">Receiving account not checked</span>}
    </span>;
  }
  return <VerdictText verdict={inv.status === 'COMPLETE' ? inv.verdict : undefined} />;
}
