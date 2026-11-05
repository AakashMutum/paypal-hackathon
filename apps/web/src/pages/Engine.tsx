import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Download, Loader2, Printer } from 'lucide-react';
import { useApp } from '../context/OrderStateContext';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePanel } from '../hooks/usePanel';
import { api } from '../api/apiClient';
import { Disclosure, Empty, Icon, Modal, Skeleton, Stepper } from '../components/ui';
import { CaseVerdict } from '../components/CaseVerdict';
import { CheckList, REVEAL_STEP_MS } from '../components/CheckList';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { StatusRows } from '../components/StatusRows';
import { SimilarCases } from '../components/Provenance';
import { HowChecked, SignalChecklist } from '../components/HowChecked';
import { decisionSentence } from '../lib/checks';
import { cn, download, softBreak } from '../lib/format';
import { formatDateTime, scoreText } from '../lib/labels';
import { paymentSteps } from '../lib/payment';

/** The case file: who the storefront says it is, who PayPal would pay, and what was checked. */
export default function Engine() {
  const { id } = useParams();
  const fresh = Boolean((useLocation().state as { fresh?: boolean } | null)?.fresh);
  const { latestId, setLatestId, toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? latestId ?? list[0]?.id;
  const { inv, error, refresh } = useOrderPolling(target);
  const side = usePanel('case');
  const [busy, setBusy] = useState(''); const [exp, setExp] = useState(false);
  usePageTitle(inv ? `Case ${inv.id}` : 'Case');
  useEffect(() => { if (id) setLatestId(id); }, [id, setLatestId]);

  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <Empty title="No cases yet">Check a website or buy from a demo store to open the first case.<div className="mt-4 flex gap-4"><Link className="link" to="/">Check a website</Link><Link className="link" to="/stores">Demo stores</Link></div></Empty>;
  if (error && !inv) return <Empty title="Cannot reach the checker"><p>{error}</p><button className="btn-primary mt-4" onClick={refresh}>Retry</button></Empty>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;

  const done = inv.status === 'COMPLETE';
  const voided = inv.captureState === 'VOIDED';
  const evidenceOfFraud = done && (inv.verdict === 'PAUSE' || Boolean(inv.payeeMismatch));
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(''); }
  };
  const later = fresh && done ? { className: 'reveal', style: { animationDelay: `${4 * REVEAL_STEP_MS}ms` } } : {};

  return <div className="space-y-8">
    <header>
      <p className="label"><span className="font-mono">Case {inv.id}</span> · {formatDateTime(inv.createdAt)}</p>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 mt-1">
        <div className="min-w-0">
          <h1 className="font-mono text-xl sm:text-2xl lg:text-[28px] break-words">{softBreak(inv.domain)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"><CaseVerdict inv={inv} />{!done && <span className="inline-flex items-center gap-1.5 text-muted"><Loader2 size={14} className="animate-spin" aria-hidden="true" />{inv.evidence.length} of 4 checks done</span>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <button type="button" className="tbtn" onClick={() => setExp(true)} disabled={!done}><Icon icon={Download} size={16} />Export this record</button>
          {done && inv.orderId && inv.verdict !== 'ALLOW' && <button type="button" className="tbtn" disabled={busy !== '' || voided} onClick={() => run('cancel', () => api.cancelOrder(inv.id), 'Purchase cancelled. The PayPal authorization was voided.')}>{voided ? 'Purchase cancelled' : 'Cancel purchase'}</button>}
          {evidenceOfFraud && <button type="button" className="tbtn" disabled={busy !== ''} onClick={() => run('report', () => api.reportMerchant({ domain: inv.domain, reason: 'Reported from the case file', investigationId: inv.id }), `${inv.domain} reported`)}>Report seller</button>}
          <button type="button" className="tbtn hidden lg:inline-flex" aria-expanded={side.open} aria-controls="case-side" onClick={side.toggle}>{side.open ? 'Hide' : 'Show'} decision panel <kbd className="font-mono text-[11px] border border-line rounded px-1">[</kbd></button>
        </div>
      </div>
    </header>

    <div className="band py-6"><ClaimedVsActual inv={inv} /></div>
    <p {...later} className={cn('text-lg max-w-3xl', later.className)}>{decisionSentence(inv)}</p>

    <div className="grid lg:grid-cols-12 gap-x-10 gap-y-10">
      <div className={cn('min-w-0 space-y-8', side.open ? 'lg:col-span-8' : 'lg:col-span-12')}>
        <section aria-labelledby="checked-h">
          <h2 id="checked-h" className="text-lg font-semibold mb-2">What was checked</h2>
          <CheckList evidence={inv.evidence} availability={inv.signalAvailability} reveal={fresh && done} />
        </section>
        {done && <SimilarCases cases={inv.similarCases} />}
        {done && inv.signalAvailability && <Disclosure title="Signals the checker could and could not use"><SignalChecklist availability={inv.signalAvailability} reason={inv.confidenceReason} /></Disclosure>}
      </div>

      <aside id="case-side" aria-label="Decision and payment" className={cn('min-w-0 lg:col-span-4 lg:sticky lg:top-[72px] self-start', side.open ? 'block' : 'lg:hidden')}>
        <h2 className="text-lg font-semibold mb-1">Decision and payment</h2>
        {done ? <div>
          <div className="py-3 space-y-1 border-t border-line">
            <div className="text-base"><CaseVerdict inv={inv} /></div>
            <p className="text-sm text-muted num">{scoreText(inv.verdict, inv.riskScore)} · confidence {inv.confidence}%</p>
            {inv.confidenceReason && <p className="text-sm text-muted">{inv.confidenceReason}</p>}
          </div>
          {inv.orderId && <div className="py-3 border-t border-line"><Stepper vertical label="Payment progress" steps={paymentSteps(inv)} /></div>}
          <div className="border-t border-line"><StatusRows inv={inv} level={3} /></div>
          {inv.orderId && <div className="py-3 border-t border-line"><Link to={`/pay/${inv.id}`} className="link text-sm">Open the payment</Link></div>}
          <HowChecked inv={inv} />
        </div> : <div className="border-t border-line py-3 text-sm text-muted" aria-busy="true">Collecting signals from {inv.domain}. No funds are captured until the check ends.</div>}
      </aside>
    </div>

    <Modal open={exp} onClose={() => setExp(false)} title="Export this record">
      <p className="text-sm text-muted mb-4">Includes every check, the confidence scores and the final decision.</p>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => { download(`record-${inv.id}.json`, inv); setExp(false); }}><Download size={16} />JSON</button>
        <button className="btn-secondary" onClick={() => { setExp(false); setTimeout(() => window.print(), 100); }}><Printer size={16} />Print or save as PDF</button></div></Modal>
  </div>;
}
