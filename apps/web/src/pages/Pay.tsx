import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, CreditCard, Info, Loader2, ShieldCheck, XCircle, FileText, Flag, Building2 } from 'lucide-react';
import type { Verdict } from '../types';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useApp } from '../context/OrderStateContext';
import { api } from '../api/apiClient';
import { Empty, Modal, Pill, Skeleton } from '../components/ui';
import { StatusRows } from '../components/StatusRows';
import { ProvenanceChips, SimilarCases } from '../components/Provenance';
import { ageLabel, cn, maskEmail, money } from '../lib/format';
import { displayBrand, VERDICT_WORDS } from '../lib/labels';
import { fundsStatement } from '../lib/payment';

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
  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <Empty icon={<CreditCard />} title="No payments yet">Check out from a demo storefront to see how Guardian handles the payment.<div className="mt-4"><Link to="/stores" className="btn-direct">Open demo storefronts</Link></div></Empty>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  const running = inv.status !== 'COMPLETE', cs = inv.captureState, held = cs === 'HELD';
  const run = async (k: string, fn: () => Promise<unknown>, msg: string) => { setBusy(k); try { await fn(); toast(msg, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(''); } };
  const funds = fundsStatement(cs);
  const discounted = inv.price !== null && inv.benchmark !== null && inv.benchmark > inv.price;
  const deviation =
    inv.price !== null && inv.benchmark !== null && inv.benchmark > 0
      ? Math.round((inv.price / inv.benchmark - 1) * 100)
      : null;
  const signalLines = [
    `Registered business records: ${inv.registryRecords === null ? 'not checked' : `${inv.registryRecords} found`}`,
    `Domain age: ${ageLabel(inv.domainAgeDays)}`,
    `Price vs comparable sellers: ${deviation === null ? 'not available' : `${deviation}%`}`,
  ];
  const submitReport = async (e: FormEvent) => { e.preventDefault(); await run('rep', () => api.reportMerchant({ domain: inv.domain, reason, investigationId: inv.id }), 'Report submitted. Thank you.'); setRep(false); setReason(''); };
  return <>
    <section className="card"><h1 className="text-2xl font-bold">Payment</h1>
      <p className="text-sm text-muted mt-1">{funds.text}</p>
      {inv.simulated && <p className="text-xs mt-2 font-mono uppercase tracking-wide">Simulated payment: no real money moved</p>}
      <div className="grid grid-cols-3 gap-2 mt-4">{(['ALLOW', 'WARN', 'PAUSE'] as Verdict[]).map(v => { const w = VERDICT_WORDS[v]; const on = inv.verdict === v;
        return <div key={v} className={cn('rounded p-2 text-center border', on ? (v === 'ALLOW' ? 'bg-ok text-white border-ok' : v === 'WARN' ? 'bg-warn text-ink border-warn' : 'bg-bad-deep text-white border-bad-deep') : 'bg-canvas text-muted border-ink/10')} aria-current={on ? 'true' : undefined}>
          <div className="text-[12px] font-semibold">{w.word} · {w.subtitle}</div><div className="text-[11px]">{WHAT_HAPPENS[v]}</div></div>; })}</div></section>

    {running
      ? <section className="card flex items-center gap-3" aria-busy="true"><Loader2 className="animate-spin text-electric" /><div><div className="font-semibold">Checking the merchant…</div><div className="text-sm text-muted">No funds are captured until the check ends.</div></div></section>
      : <StatusRows inv={inv} />}

    {(held || running || cs === 'VOIDED') && <section className="card !bg-tint flex gap-3"><Info className="text-electric shrink-0" aria-hidden="true" />
      <div><h2 className="font-semibold">No funds captured</h2><p className="text-sm text-ink/80 mt-1">{cs === 'VOIDED' ? 'The authorization was voided on PayPal. ' : 'The payment is authorized on PayPal but not captured. '}<b>No funds have been transferred</b> to the seller.</p></div></section>}

    <section className="card space-y-4">
      <div className="flex justify-between"><h2 className="font-semibold">Order</h2><span className="font-mono text-xs text-muted">{inv.orderId ?? inv.id}</span></div>
      <div className="rounded-lg bg-tint p-3"><div className="font-semibold">{inv.productName}</div>
        <div className="flex items-baseline gap-2 mt-1"><span className="text-xl font-bold font-mono">{money(inv.price)}</span>{discounted && <><span className="font-mono text-sm line-through text-muted">{money(inv.benchmark)}</span><Pill tone="bad">{deviation}% vs usual</Pill></>}</div></div>
      <div className="grid grid-cols-2 gap-2 text-sm"><div className="rounded-lg bg-tint p-3"><div className="mono-label">Buyer</div><div className="font-semibold mt-1">Provided at checkout</div><div className="font-mono text-xs text-muted">{inv.buyerEmail ? maskEmail(inv.buyerEmail) : 'Not stored'}</div></div>
        <div className="rounded-lg bg-tint p-3"><div className="mono-label">Delivery</div><div className="font-semibold mt-1">Not collected</div><div className="font-mono text-xs text-muted">Handled by the store</div></div></div></section>

    {!running && <section className="card space-y-3">
      <div className="flex justify-between items-center"><h2 className="font-semibold">Claimed vs actual payee</h2><span className="mono-label bg-tint px-2 py-1 rounded">Confidence {inv.confidence}%</span></div>
      <div className="rounded-lg bg-tint p-3"><div className="mono-label">Storefront says</div><div className="text-lg font-bold mt-1">{displayBrand(inv.claimedBrand, inv.domain)}</div><div className="font-mono text-xs text-muted">Domain: {inv.domain}</div></div>
      <div className={cn('rounded-lg p-3', inv.verdict === 'ALLOW' ? 'bg-ok-bg' : 'bg-bad-bg')}><div className={cn('mono-label', inv.verdict !== 'ALLOW' && '!text-bad-deep')}>PayPal pays</div>
        <div className="flex gap-2 items-center mt-1"><Building2 size={20} aria-hidden="true" /><span className="text-lg font-bold break-all">{inv.payeeName ?? 'Not supplied'}</span></div>
        <div className="flex gap-2 flex-wrap mt-2"><span className="font-mono text-xs">ID: {inv.payeeId ?? 'Not supplied'}</span><Pill tone={inv.verdict === 'ALLOW' ? 'ok' : 'bad'}>{inv.payeeTier ?? 'Not checked'}</Pill></div></div>
      <div className="mono-label pt-2">What was found</div>
      {signalLines.map(t => <div key={t} className="bg-tint rounded p-2.5 text-xs font-mono">{t}</div>)}</section>}

    <section className="card !p-0"><button className="w-full p-4 flex justify-between items-center font-semibold" aria-expanded={why} onClick={() => setWhy(!why)}><span className="flex items-center gap-2"><Info size={16} className="text-electric" aria-hidden="true" />Why did Guardian {inv.verdict === 'ALLOW' ? 'allow' : 'hold'} this?</span><ChevronDown className={cn('transition', why && 'rotate-180')} aria-hidden="true" /></button>
      {why && <ul className="px-4 pb-4 space-y-2 text-sm list-disc list-inside text-ink/80">{inv.reasons.map(r => <li key={r}>{r}</li>)}</ul>}</section>

    <ProvenanceChips inv={inv} />
    <SimilarCases cases={inv.similarCases} />

    {held && inv.verdict === 'WARN' && !inv.payeeMismatch && !inv.acknowledged && <button className="btn-primary w-full" disabled={!!busy} onClick={() => run('ack', () => api.acknowledge(inv.id), 'Warning acknowledged.')}>{busy === 'ack' ? <Loader2 className="animate-spin" /> : <ShieldCheck size={18} />}I understand the warning. Release the payment.</button>}
    {held && <button className="btn-danger w-full !h-14 text-base" disabled={!!busy} onClick={() => run('cancel', () => api.cancelOrder(inv.id), 'Order cancelled. PayPal authorization voided.')}>{busy === 'cancel' ? <Loader2 className="animate-spin" /> : <XCircle size={18} />}Cancel order and void the PayPal authorization</button>}
    {held && inv.verdict === 'WARN' && <button className="btn-secondary w-full" disabled={!!busy || inv.reviewRequested} onClick={() => run('rev', () => api.requestReview(inv.id), 'Analyst review requested')}>{inv.reviewRequested ? 'Analyst review requested' : 'Request analyst review'}</button>}
    <div className="grid grid-cols-2 gap-2"><button className="btn-secondary !bg-tint" onClick={() => setLog(true)}><FileText size={16} aria-hidden="true" />View record</button>
      <button className="btn-secondary !bg-tint" onClick={() => setRep(true)}><Flag size={16} aria-hidden="true" />Report merchant</button></div>
    <button className="text-sm text-electric font-semibold block mx-auto" onClick={() => nav(`/engine/${inv.id}`)}>Open the full merchant check</button>
    <p className="text-center text-[11px] text-muted font-mono break-all">{inv.simulated ? 'Simulated payment: no PayPal call was made' : 'PayPal sandbox payment'}</p>

    <Modal open={log} onClose={() => setLog(false)} title="Record"><pre className="text-[11px] font-mono bg-canvas inset rounded p-3 overflow-auto max-h-[50vh]">{JSON.stringify(inv, null, 2)}</pre></Modal>
    <Modal open={rep} onClose={() => setRep(false)} title="Report merchant"><form onSubmit={submitReport} className="space-y-3">
      <p className="text-sm text-muted">Reporting <span className="font-mono">{inv.domain}</span></p>
      <textarea required className="input !h-28 py-2" placeholder="What looked wrong?" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason" />
      <button className="btn-danger w-full" disabled={busy === 'rep'}>Submit report</button></form></Modal>
  </>;
}
