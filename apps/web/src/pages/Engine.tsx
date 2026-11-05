import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Download, Loader2, Printer } from 'lucide-react';
import { useApp } from '../context/OrderStateContext';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../api/apiClient';
import { Disclosure, Empty, Icon, Modal, Skeleton, VerdictMark } from '../components/ui';
import { CheckList } from '../components/CheckList';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { SimilarCases } from '../components/Provenance';
import { HowChecked, SignalChecklist } from '../components/HowChecked';
import { decisionSentence, outcome, topReasons } from '../lib/checks';
import { download, softBreak } from '../lib/format';
import { formatDateTime, VERDICT_WORDS } from '../lib/labels';
import { CAPTURE_WORDS, fundsStatement } from '../lib/payment';

const MARK_COLOR = { ALLOW: 'text-success', WARN: 'text-warning', PAUSE: 'text-danger' } as const;

export default function Engine() {
  const { id } = useParams();
  const fresh = Boolean((useLocation().state as { fresh?: boolean } | null)?.fresh);
  const { latestId, setLatestId, toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? latestId ?? list[0]?.id;
  const { inv, error, refresh } = useOrderPolling(target);
  const [busy, setBusy] = useState(''); const [exp, setExp] = useState(false);
  usePageTitle(inv ? `Case ${inv.id}` : 'Case');
  useEffect(() => { if (id) setLatestId(id); }, [id, setLatestId]);

  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <Empty title="No cases yet">Check a website or buy from a demo store to open the first case.<div className="mt-4 flex gap-4"><Link className="link" to="/check">Check a website</Link><Link className="link" to="/stores">Demo stores</Link></div></Empty>;
  if (error && !inv) return <Empty title="Cannot reach the checker"><p>{error}</p><button className="btn-primary mt-4" onClick={refresh}>Retry</button></Empty>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-32 w-full" /><Skeleton className="h-40 w-full" /></div>;

  const done = inv.status === 'COMPLETE';
  const voided = inv.captureState === 'VOIDED';
  const evidenceOfFraud = done && (inv.verdict === 'PAUSE' || Boolean(inv.payeeMismatch));
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(''); }
  };
  const reasons = done ? topReasons(inv.reasons) : [];
  const headline = done && inv.verdict ? (inv.verdict === 'ALLOW' ? outcome(inv).headline : VERDICT_WORDS[inv.verdict].label) : 'Checking';

  return <div className="space-y-10 max-w-4xl">
    <header>
      <p className="label"><span className="font-mono">Case {inv.id}</span> · {formatDateTime(inv.createdAt)}</p>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 mt-1">
        <h1 className="font-mono text-xl sm:text-2xl lg:text-[28px] break-words min-w-0">{softBreak(inv.domain)}</h1>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <button type="button" className="tbtn" onClick={() => setExp(true)} disabled={!done}><Icon icon={Download} size={16} />Export this record</button>
          {done && inv.orderId && inv.verdict !== 'ALLOW' && <button type="button" className="tbtn" disabled={busy !== '' || voided} onClick={() => run('cancel', () => api.cancelOrder(inv.id), 'Purchase cancelled. The PayPal authorization was voided.')}>{voided ? 'Purchase cancelled' : 'Cancel purchase'}</button>}
          {evidenceOfFraud && <button type="button" className="tbtn" disabled={busy !== ''} onClick={() => run('report', () => api.reportMerchant({ domain: inv.domain, reason: 'Reported from the case page', investigationId: inv.id }), `${inv.domain} reported`)}>Report seller</button>}
        </div>
      </div>
    </header>

    <section aria-label="Decision" className="band py-6">
      <div className="flex items-center gap-3">
        {done && inv.verdict ? <VerdictMark verdict={inv.verdict} size={24} className={MARK_COLOR[inv.verdict]} /> : <Loader2 size={24} className="animate-spin text-muted" aria-hidden="true" />}
        <p className="text-2xl font-semibold tracking-tight">{headline}</p>
      </div>
      <p className="mt-2 text-lg max-w-2xl">{decisionSentence(inv)}</p>
      {!done && <p className="mt-1 text-muted" aria-live="polite">{inv.evidence.length} of 4 checks done. No funds are captured until the check ends.</p>}
    </section>

    <ClaimedVsActual inv={inv} />

    {reasons.length > 0 && <section aria-labelledby="why-h">
      <h2 id="why-h" className="text-xl font-semibold">Why</h2>
      <ul className="mt-2 space-y-2 list-disc pl-5">{reasons.map(r => <li key={r}>{r}</li>)}</ul>
    </section>}

    <section aria-labelledby="pay-h">
      <h2 id="pay-h" className="text-xl font-semibold">Payment</h2>
      <p className="mt-2">{inv.orderId
        ? <>{CAPTURE_WORDS[inv.captureState]}. {fundsStatement(inv.captureState).text} <Link to={`/pay/${inv.id}`} className="link">Open the payment</Link></>
        : 'No payment was started. No funds were captured.'}</p>
    </section>

    <Disclosure title={<span className="text-xl font-semibold">Details</span>}>
      <div className="space-y-8 pt-2">
        <section aria-labelledby="ran-h"><h3 id="ran-h" className="font-semibold mb-2">All checks run</h3>
          <CheckList evidence={inv.evidence} availability={inv.signalAvailability} reveal={fresh && done} /></section>
        {inv.signalAvailability && <section aria-labelledby="could-h"><h3 id="could-h" className="font-semibold mb-2">What we could and could not check</h3>
          <SignalChecklist availability={inv.signalAvailability} /></section>}
        {inv.provenance && <section aria-labelledby="how-h"><h3 id="how-h" className="font-semibold mb-2">How it was checked</h3><HowChecked inv={inv} /></section>}
        {done && <SimilarCases cases={inv.similarCases} />}
        {done && <p className="text-sm"><span className="font-semibold">Confidence {inv.confidence}%.</span> <span className="text-muted">{inv.confidenceReason ?? 'Based on the checks that ran.'}</span></p>}
      </div>
    </Disclosure>

    <Modal open={exp} onClose={() => setExp(false)} title="Export this record">
      <p className="text-sm text-muted mb-4">Includes every check, the confidence scores and the final decision.</p>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" onClick={() => { download(`record-${inv.id}.json`, inv); setExp(false); }}><Download size={16} />JSON</button>
        <button className="btn-secondary" onClick={() => { setExp(false); setTimeout(() => window.print(), 100); }}><Printer size={16} />Print or save as PDF</button></div></Modal>
  </div>;
}
