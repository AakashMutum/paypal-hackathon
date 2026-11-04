import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Investigation } from '../types';
import { ChecksStrip, REVEAL_STEP_MS } from './ChecksStrip';
import { ClaimedVsActual } from './ClaimedVsActual';
import { StatusRows } from './StatusRows';
import { Timeline } from './Timeline';
import { HowChecked, SignalChecklist } from './HowChecked';
import { SimilarCases } from './Provenance';
import { Icon, Skeleton } from './ui';

const AFTER_CHECKS = `${4 * REVEAL_STEP_MS}ms`;

/**
 * One investigation, top to bottom: the four checks, the decision, the claimed-vs-actual picture,
 * the evidence in four groups, what was and was not checked, similar past cases and how it was
 * checked. With reveal, the checks appear one after another and then the decision and the picture
 * (about 600 ms in all); the data is already complete, so nothing is invented or delayed beyond that.
 */
export function InvestigationView({ inv, reveal }: { inv: Investigation; reveal?: boolean }) {
  const done = inv.status === 'COMPLETE';
  if (!done) return <div className="space-y-3" aria-busy="true" aria-live="polite">
    <p className="text-sm text-muted">Checking {inv.domain}. {inv.evidence.length} of 4 checks done.</p>
    <Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  const later = reveal ? { className: 'reveal', style: { animationDelay: AFTER_CHECKS } } : {};
  return <div className="space-y-4">
    <ChecksStrip evidence={inv.evidence} reveal={reveal} />
    <div {...later}><StatusRows inv={inv} /></div>
    <div {...later}><ClaimedVsActual inv={inv} /></div>
    <section aria-label="Evidence"><h2 className="font-semibold mb-3">Evidence</h2><Timeline evidence={inv.evidence} /></section>
    <SignalChecklist availability={inv.signalAvailability} reason={inv.confidenceReason} />
    <SimilarCases cases={inv.similarCases} />
    <HowChecked inv={inv} />
    <div className="flex flex-wrap gap-2">
      <Link to={`/engine/${inv.id}`} className="btn-secondary">Open the full check<Icon icon={ArrowRight} size={16} /></Link>
      {inv.orderId && <Link to={`/pay/${inv.id}`} className="btn-primary">View payment<Icon icon={ArrowRight} size={16} /></Link>}
    </div>
  </div>;
}
