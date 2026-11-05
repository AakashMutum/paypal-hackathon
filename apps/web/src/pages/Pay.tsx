import { FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { Verdict } from '../types';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApp } from '../context/OrderStateContext';
import { api } from '../api/apiClient';
import { Disclosure, Empty, Modal, Skeleton, Stepper } from '../components/ui';
import { CaseVerdict } from '../components/CaseVerdict';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { HowChecked } from '../components/HowChecked';
import { StatusRows } from '../components/StatusRows';
import { SimilarCases } from '../components/Provenance';
import { maskEmail, money } from '../lib/format';
import { fundsStatement, paymentSteps } from '../lib/payment';

const WHAT_HAPPENS: Record<Verdict, string> = {
  ALLOW: 'The payment is captured automatically.',
  WARN: 'The payment is captured only after you acknowledge the warning.',
  PAUSE: 'The payment is never captured.',
};

export default function Pay() {
  const { id } = useParams(); const { toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? list.find(i => i.orderId)?.id;
  const { inv, refresh } = useOrderPolling(target);
  usePageTitle(inv ? `Payment ${inv.id}` : 'Payment');
  const [log, setLog] = useState(false); const [rep, setRep] = useState(false);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState('');
  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <Empty title="No payments yet">Check out from a demo store to see how TrustOra handles the payment.<div className="mt-4"><Link to="/stores" className="link">Open the demo stores</Link></div></Empty>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  const running = inv.status !== 'COMPLETE', cs = inv.captureState, held = cs === 'HELD';
  const run = async (k: string, fn: () => Promise<unknown>, msg: string) => { setBusy(k); try { await fn(); toast(msg, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(''); } };
  const funds = fundsStatement(cs);
  const discounted = inv.price !== null && inv.benchmark !== null && inv.benchmark > inv.price;
  const deviation = inv.price !== null && inv.benchmark !== null && inv.benchmark > 0 ? Math.round((inv.price / inv.benchmark - 1) * 100) : null;
  const submitReport = async (e: FormEvent) => { e.preventDefault(); await run('rep', () => api.reportMerchant({ domain: inv.domain, reason, investigationId: inv.id }), 'Report submitted. Thank you.'); setRep(false); setReason(''); };
  const row = 'grid grid-cols-[8rem_1fr] gap-x-4 py-2';
  return <div className="max-w-3xl space-y-8">
    <header>
      <p className="label"><span className="font-mono">Case {inv.id}</span>{inv.orderId && <> · order <span className="font-mono">{inv.orderId}</span></>}</p>
      <h1 className="mt-1">Payment</h1>
      <p className="text-lg mt-2">{funds.text}</p>
      <p className="text-sm text-muted mt-1">{inv.simulated ? 'Simulated payment: no PayPal call was made and no real money moved.' : 'PayPal sandbox payment: test money only.'}</p>
      {!running && inv.verdict && <p className="text-sm mt-3 flex flex-wrap items-center gap-x-3"><CaseVerdict inv={inv} note={false} /><span className="text-muted">{WHAT_HAPPENS[inv.verdict]}</span></p>}
    </header>

    <Stepper label="Payment progress" steps={paymentSteps(inv)} />
    <div className="band py-6"><ClaimedVsActual inv={inv} /></div>

    {running
      ? <p className="flex items-center gap-2 text-muted" aria-busy="true"><Loader2 size={16} className="animate-spin" aria-hidden="true" />Checking the merchant. No funds are captured until the check ends.</p>
      : <StatusRows inv={inv} />}

    <section aria-labelledby="order-h">
      <h2 id="order-h" className="text-lg font-semibold mb-1">Order</h2>
      <dl className="ruled border-y border-line">
        <div className={row}><dt className="text-muted">Item</dt><dd>{inv.productName}</dd></div>
        <div className={row}><dt className="text-muted">Price</dt><dd className="num"><span className="font-mono">{money(inv.price)}</span>{discounted && <span className="text-muted"> · usual {money(inv.benchmark)} ({deviation}%)</span>}</dd></div>
        <div className={row}><dt className="text-muted">Buyer</dt><dd>Provided at checkout <span className="font-mono text-xs text-muted">{inv.buyerEmail ? maskEmail(inv.buyerEmail) : 'not stored'}</span></dd></div>
        <div className={row}><dt className="text-muted">Delivery</dt><dd>Not collected here. Handled by the store.</dd></div>
      </dl>
    </section>

    {inv.reasons.length > 0 && <Disclosure title={`Why did TrustOra ${inv.verdict === 'ALLOW' ? 'allow' : 'hold'} this?`}><ul className="space-y-1.5 text-sm list-disc pl-5">{inv.reasons.map(r => <li key={r}>{r}</li>)}</ul></Disclosure>}
    <HowChecked inv={inv} />
    <SimilarCases cases={inv.similarCases} />

    {held && <div className="flex flex-wrap gap-3">
      {inv.verdict === 'WARN' && !inv.payeeMismatch && !inv.acknowledged && <button className="btn-primary" disabled={!!busy} onClick={() => run('ack', () => api.acknowledge(inv.id), 'Warning acknowledged.')}>{busy === 'ack' && <Loader2 className="animate-spin" size={16} />}I understand the warning. Release the payment.</button>}
      <button className="btn-danger" disabled={!!busy} onClick={() => run('cancel', () => api.cancelOrder(inv.id), 'Order cancelled. PayPal authorization voided.')}>{busy === 'cancel' && <Loader2 className="animate-spin" size={16} />}Cancel order and void the authorization</button>
      {inv.verdict === 'WARN' && <button className="btn-secondary" disabled={!!busy || inv.reviewRequested} onClick={() => run('rev', () => api.requestReview(inv.id), 'Analyst review requested')}>{inv.reviewRequested ? 'Analyst review requested' : 'Request analyst review'}</button>}
    </div>}
    <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-line pt-4">
      <Link to={`/engine/${inv.id}`} className="tbtn">Open the full case</Link>
      <button type="button" className="tbtn" onClick={() => setLog(true)}>View record</button>
      <button type="button" className="tbtn" onClick={() => setRep(true)}>Report merchant</button>
    </div>

    <Modal open={log} onClose={() => setLog(false)} title="Record"><pre className="text-[11px] font-mono bg-surface-2 rounded p-3 overflow-auto max-h-[50vh]">{JSON.stringify(inv, null, 2)}</pre></Modal>
    <Modal open={rep} onClose={() => setRep(false)} title="Report merchant"><form onSubmit={submitReport} className="space-y-3">
      <p className="text-sm text-muted">Reporting <span className="font-mono">{inv.domain}</span></p>
      <textarea required className="input !h-28 py-2" placeholder="What looked wrong?" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason" />
      <button className="btn-danger" disabled={busy === 'rep'}>Submit report</button></form></Modal>
  </div>;
}
