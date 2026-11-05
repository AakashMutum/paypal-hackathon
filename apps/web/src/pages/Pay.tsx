import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, CreditCard, Info, Loader2, ShieldCheck, XCircle, FileText, Flag } from 'lucide-react';
import type { Verdict } from '../types';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApp } from '../context/OrderStateContext';
import { api } from '../api/apiClient';
import { Disclosure, Empty, Modal, Pill, Skeleton, Stepper } from '../components/ui';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { HowChecked } from '../components/HowChecked';
import { StatusRows } from '../components/StatusRows';
import { SimilarCases } from '../components/Provenance';
import { cn, maskEmail, money } from '../lib/format';
import { VERDICT_WORDS } from '../lib/labels';
import { fundsStatement, paymentSteps } from '../lib/payment';

const WHAT_HAPPENS: Record<Verdict, string> = {
  ALLOW: 'Captured automatically',
  WARN: 'Captured after you acknowledge',
  PAUSE: 'Never captured',
};

export default function Pay() {
  usePageTitle('Payment');
  const { id } = useParams(); const nav = useNavigate(); const { toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? list.find(i => i.orderId)?.id;
  const { inv, refresh } = useOrderPolling(target);
  const [why, setWhy] = useState(false); const [log, setLog] = useState(false); const [rep, setRep] = useState(false);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState('');
  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <Empty title="No payments yet">Check out from a demo storefront to see how TrustOra handles the payment.<div className="mt-4"><Link to="/stores" className="link">Open demo storefronts</Link></div></Empty>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  const running = inv.status !== 'COMPLETE', cs = inv.captureState, held = cs === 'HELD';
  const run = async (k: string, fn: () => Promise<unknown>, msg: string) => { setBusy(k); try { await fn(); toast(msg, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(''); } };
  const funds = fundsStatement(cs);
  const discounted = inv.price !== null && inv.benchmark !== null && inv.benchmark > inv.price;
  const deviation =
    inv.price !== null && inv.benchmark !== null && inv.benchmark > 0
      ? Math.round((inv.price / inv.benchmark - 1) * 100)
      : null;
  const submitReport = async (e: FormEvent) => { e.preventDefault(); await run('rep', () => api.reportMerchant({ domain: inv.domain, reason, investigationId: inv.id }), 'Report submitted. Thank you.'); setRep(false); setReason(''); };
  return <>
    <section className="card xl p-6 space-y-3">
      <h1 className="text-[22px] font-bold">Payment</h1>
      <p className="text-sm text-muted">{funds.text}</p>
      {inv.simulated && <p className="text-xs mt-2 font-mono">Simulated payment: no real money moved</p>}
      <div className="grid grid-cols-3 gap-2 mt-4">{(['ALLOW', 'WARN', 'PAUSE'] as Verdict[]).map(v => { const w = VERDICT_WORDS[v]; const on = inv.verdict === v;
        return <div key={v} className={cn('rounded-xl p-2 text-center border', on ? (v === 'ALLOW' ? 'bg-success text-bg border-ok' : v === 'WARN' ? 'bg-warn-bg text-warning border-warning' : 'bg-danger text-bg border-danger') : 'bg-tint text-muted border-line')} aria-current={on ? 'true' : undefined}>
          <div className="text-[12px] font-semibold">{w.word} · {w.subtitle}</div><div className="text-[11px]">{WHAT_HAPPENS[v]}</div></div>; })}</div></section>

    <ClaimedVsActual inv={inv} />
    <Stepper label="Payment progress" steps={paymentSteps(inv)} />

    {running ? <section className="card xl flex items-center gap-3 p-5" aria-busy="true"><Loader2 className="animate-spin text-electric" /><div><div className="font-semibold">Checking the merchant…</div><div className="text-sm text-muted">No funds are captured until the check ends.</div></div></section> : <StatusRows inv={inv} />}

    {(held || running || cs === 'VOIDED') && <section className="card xl !bg-tint flex gap-3 p-4"><Info className="text-electric shrink-0" aria-hidden="true" />
      <div><h2 className="font-semibold">No funds captured</h2><p className="text-sm text-ink/80 mt-1">{cs === 'VOIDED' ? 'The authorization was voided on PayPal. ' : 'The payment is authorized on PayPal but not captured. '}<b>No funds have been transferred</b> to the seller.</p></div></section>}

    <section className="card xl space-y-4 p-5">
      <div className="flex justify-between"><h2 className="font-semibold">Order</h2><span className="font-mono text-xs text-muted">{inv.orderId ?? inv.id}</span></div>
      <div className="rounded-xl bg-tint p-3"><div className="font-semibold">{inv.productName}</div>
        <div className="flex items-baseline gap-2 mt-1"><span className="text-xl font-bold font-mono">{money(inv.price)}</span>{discounted && <><span className="font-mono text-sm line-through text-muted">{money(inv.benchmark)}</span><Pill tone="bad">{deviation}% vs usual</Pill></>}</div></div>
      <div className="grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl bg-tint p-3"><div className="mono-label">Buyer</div><div className="font-semibold mt-1">Provided at checkout</div><div className="font-mono text-xs text-muted">{inv.buyerEmail ? maskEmail(inv.buyerEmail) : 'Not stored'}</div></div>
        <div className="rounded-xl bg-tint p-3"><div className="mono-label">Delivery</div><div className="font-semibold mt-1">Not collected</div><div className="font-mono text-xs text-muted">Handled by the store</div></div></div></section>

    <Disclosure title={<span className="text-xl font-semibold">Why this result</span>}>
  <ul className="px-4 pb-4 space-y-2 text-sm list-disc list-inside text-ink/80">{inv.reasons.map(r => <li key={r}>{r}</li>)}</ul>
</Disclosure>

    <HowChecked inv={inv} />
    <SimilarCases cases={inv.similarCases} />

    {held && inv.verdict === 'WARN' && !inv.payeeMismatch && !inv.acknowledged && <button className="btn-primary w-full" disabled={!!busy} onClick={() => run('ack', () => api.acknowledge(inv.id), 'Warning acknowledged.')}>{busy === 'ack' ? <Loader2 className="animate-spin" /> : <ShieldCheck size={18} />}I understand the warning. Release the payment.</button>}
    {held && <button className="btn-danger w-full !h-14 text-base" disabled={!!busy} onClick={() => run('cancel', () => api.cancelOrder(inv.id), 'Order cancelled. PayPal authorization voided.')}>{busy === 'cancel' ? <Loader2 className="animate-spin" /> : <XCircle size={18} />}Cancel order and void the PayPal authorization</button>}
    {held && inv.verdict === 'WARN' && <button className="btn-secondary w-full" disabled={!!busy || inv.reviewRequested} onClick={() => run('rev', () => api.requestReview(inv.id), 'Analyst review requested')}>{inv.reviewRequested ? 'Analyst review requested' : 'Request analyst review'}</button>}

    <div className="grid grid-cols-2 gap-2"><button className="btn-secondary !bg-tint" onClick={() => setLog(true)}><FileText size={16} aria-hidden="true" />View record</button>
      <button className="btn-secondary !bg-tint" onClick={() => setRep(true)}><Flag size={16} aria-hidden="true" />Report merchant</button></div>
    <button className="text-sm text-electric font-semibold block mx-auto" onClick={() => nav(`/engine/${inv.id}`)}>Open the full merchant check</button>
    <p className="text-center text-[11px] text-muted font-mono break-all">{inv.simulated ? 'Simulated payment: no PayPal call was made' : 'PayPal sandbox payment'}</p>

    <Modal open={log} onClose={() => setLog(false)} title="Record"><pre className="text-[11px] font-mono bg-tint inset rounded p-3 overflow-auto max-h-[50vh]">{JSON.stringify(inv, null, 2)}</pre></Modal>
    <Modal open={rep} onClose={() => setRep(false)} title="Report merchant"><form onSubmit={submitReport} className="space-y-3">
      <p className="text-sm text-muted">Reporting <span className="font-mono">{inv.domain}</span></p>
      <textarea required className="input !h-28 py-2" placeholder="What looked wrong?" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason" />
      <button className="btn-danger w-full" disabled={busy === 'rep'}>Submit report</button></form></Modal>
  </>;
}

function EmptyCard({ icon: IconComp, title, children }: { icon: React.ComponentType<any>; title: string; children: React.ReactNode }) {
  return <div className="text-center py-16"><IconComp className="h-12 w-12 text-muted mb-3" aria-hidden="true" /><h3 className="font-semibold">{title}</h3>{children}</div>;
}
