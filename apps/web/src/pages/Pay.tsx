import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, CreditCard, Info, Loader2, ShieldAlert, ShieldCheck, XCircle, TerminalSquare, Flag, Building2 } from 'lucide-react';
import type { Verdict } from '../types';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { useApp } from '../context/OrderStateContext';
import { api } from '../api/apiClient';
import { Empty, Modal, Pill } from '../components/ui';
import { ProvenanceChips, SimilarCases } from '../components/Provenance';
import { ageLabel, cn, maskEmail, money } from '../lib/format';

const TILES: { v: Verdict; label: string; sub: string; on: string }[] = [
  { v: 'ALLOW', label: 'LOW RISK', sub: 'Captured automatically', on: 'bg-ok text-white' },
  { v: 'WARN', label: 'MEDIUM RISK', sub: 'Acknowledge to continue', on: 'bg-warn text-ink' },
  { v: 'PAUSE', label: 'HIGH RISK', sub: 'Never captured', on: 'bg-bad-deep text-white' }];
export default function Pay() {
  const { id } = useParams(); const nav = useNavigate(); const { toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? list.find(i => i.orderId)?.id;
  const { inv, refresh } = useOrderPolling(target);
  const [why, setWhy] = useState(false); const [log, setLog] = useState(false); const [rep, setRep] = useState(false);
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState('');
  if (!target) return loading ? null : <Empty icon={<CreditCard />} title="No payments yet">Check out from a demo storefront to see how Guardian handles the payment.<div className="mt-4"><Link to="/stores" className="btn-direct">Open demo storefronts</Link></div></Empty>;
  if (!inv) return <p className="p-4 text-sm text-muted">Loading payment…</p>;
  const running = inv.status !== 'COMPLETE', cs = inv.captureState, held = cs === 'HELD';
  const run = async (k: string, fn: () => Promise<unknown>, msg: string) => { setBusy(k); try { await fn(); toast(msg, 'ok'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(''); } };
  const state = running ? { cls: 'bg-navy text-white', chip: 'VERIFYING', title: 'Verifying merchant…', text: 'Guardian is checking the PayPal recipient. No funds are captured until verification ends.' }
    : cs === 'CAPTURED' ? { cls: 'bg-ok text-white', chip: 'CAPTURED', title: 'Payment Captured', text: 'The recipient matched the storefront. Funds were released to the merchant.' }
    : cs === 'VOIDED' ? { cls: 'bg-ink text-white', chip: 'VOIDED', title: 'Authorization Voided', text: 'The PayPal authorization was voided. No funds were transferred to the seller.' }
    : cs === 'FAILED' ? { cls: 'bg-bad-deep text-white', chip: 'FAILED', title: 'Payment Failed', text: 'PayPal could not complete a step. No funds were captured.' }
    : cs === 'AUTHORIZED' ? { cls: 'bg-navy text-white', chip: 'AUTHORIZED', title: 'Payment Authorized', text: 'The payment is authorized and waiting for the guardian decision. Nothing is captured yet.' }
    : inv.verdict === 'PAUSE' ? { cls: 'bg-bad-deep text-white', chip: 'CAPTURE PAUSED', title: 'Payment Capture Paused', text: 'Capture is blocked. The evidence does not support what the storefront claims about who is paid.' }
    : { cls: 'bg-warn text-ink', chip: 'REVIEW HOLD', title: 'Payment On Hold', text: 'Some claims could not be verified. Capture waits until you acknowledge the warning or cancel the order.' };
  const submitReport = async (e: FormEvent) => { e.preventDefault(); await run('rep', () => api.reportMerchant({ domain: inv.domain, reason, investigationId: inv.id }), 'Report submitted. Thank you.'); setRep(false); setReason(''); };
  return <>
    <section className="rounded-xl bg-navy text-white p-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="w-10 h-10 rounded bg-electric grid place-items-center"><ShieldCheck size={20} /></span><div><div className="font-bold">Gateway Integrity</div><div className="font-mono text-[11px] text-white/60">PRE-CAPTURE PIPELINE</div></div></div>
      {held && <Pill tone="bad" className="!bg-bad !text-white !border-transparent">CAPTURE HELD</Pill>}</section>

    <section className={cn('rounded-lg p-5', state.cls)} role="status">
      <div className="flex gap-3 items-center">{running ? <Loader2 className="animate-spin shrink-0" size={32} /> : <ShieldAlert size={32} className="shrink-0" />}
        <div><span className="inline-block px-2 rounded-full bg-white/20 text-[11px] font-semibold">{state.chip}</span><h1 className="text-2xl font-bold leading-tight">{state.title}</h1></div></div>
      <p className="text-sm mt-3">{state.text}</p>
      {inv.captureReason && <p className="text-sm mt-2 font-mono opacity-90">{inv.captureReason}</p>}
      {inv.simulated && <p className="text-xs mt-2 font-mono uppercase tracking-wide">Simulated payment: no real money moved</p>}
      <div className="grid grid-cols-3 gap-2 mt-4">{TILES.map(t => <div key={t.v} className={cn('rounded p-2 text-center', inv.verdict === t.v ? t.on : 'bg-white/20 text-white/60')}><div className="text-[11px] font-semibold">{t.label}</div><div className="text-[10px] font-mono">{t.sub}</div></div>)}</div></section>

    {(held || running || cs === 'VOIDED') && <section className="card !bg-tint flex gap-3"><Info className="text-electric shrink-0" />
      <div><h2 className="font-semibold">No funds captured yet</h2><p className="text-sm text-ink/80 mt-1">{cs === 'VOIDED' ? 'The authorization was voided on PayPal. ' : 'The payment is authorized on PayPal but not captured. '}<b>No funds have been transferred</b> to the seller.</p></div></section>}

    <section className="card space-y-4">
      <div className="flex justify-between"><h2 className="font-semibold">Order Item Summary</h2><span className="font-mono text-xs text-muted">{inv.orderId ?? inv.id}</span></div>
      <div className="rounded-lg bg-tint p-3"><div className="font-semibold">{inv.productName}</div>
        <div className="flex items-baseline gap-2 mt-1"><span className="text-xl font-bold font-mono">{money(inv.price)}</span>{inv.benchmark > inv.price && <><span className="font-mono text-sm line-through text-muted">{money(inv.benchmark)}</span><Pill tone="bad">{Math.round((inv.price / inv.benchmark - 1) * 100)}% Flag</Pill></>}</div></div>
      <div className="grid grid-cols-2 gap-2 text-sm"><div className="rounded-lg bg-tint p-3"><div className="mono-label">Buyer identity</div><div className="font-semibold mt-1">Alex Walker</div><div className="font-mono text-xs text-muted">{maskEmail(inv.buyerEmail ?? 'alex.walker@mail.example')}</div></div>
        <div className="rounded-lg bg-tint p-3"><div className="mono-label">Delivery zone</div><div className="font-semibold mt-1">San Francisco, CA</div><div className="font-mono text-xs text-muted">Direct Courier</div></div></div></section>

    {!running && <section className="card space-y-3">
      <div className="flex justify-between items-center"><h2 className="font-semibold">Claimed vs actual payee</h2><span className="mono-label bg-tint px-2 py-1 rounded">Confidence {inv.confidence}%</span></div>
      <div className="rounded-lg bg-tint p-3"><div className="mono-label">Storefront promoted entity</div><div className="text-lg font-bold mt-1">{inv.claimedBrand}</div><div className="font-mono text-xs text-muted">Domain: {inv.domain}</div></div>
      <div className={cn('rounded-lg p-3', inv.verdict === 'ALLOW' ? 'bg-ok-bg' : 'bg-bad-bg')}><div className={cn('mono-label', inv.verdict !== 'ALLOW' && '!text-bad-deep')}>Real destination account</div>
        <div className="flex gap-2 items-center mt-1"><Building2 size={20} /><span className="text-lg font-bold break-all">{inv.payeeName}</span></div>
        <div className="flex gap-2 flex-wrap mt-2"><span className="font-mono text-xs">ID: {inv.payeeId}</span><Pill tone={inv.verdict === 'ALLOW' ? 'ok' : 'bad'}>{inv.payeeTier}</Pill></div></div>
      <div className="mono-label pt-2">Signals</div>
      {[`Merchant registry: ${inv.registryRecords} legal records`, `Domain age: ${ageLabel(inv.domainAgeDays)}`, `Pricing deviation: ${Math.round((inv.price / inv.benchmark - 1) * 100)}%`].map(t => <div key={t} className="bg-tint rounded p-2.5 text-xs font-mono">{t}</div>)}</section>}

    <section className="card !p-0"><button className="w-full p-4 flex justify-between items-center font-semibold" aria-expanded={why} onClick={() => setWhy(!why)}><span className="flex items-center gap-2"><Info size={16} className="text-electric" />Why did Guardian {inv.verdict === 'ALLOW' ? 'allow' : 'hold'} this?</span><ChevronDown className={cn('transition', why && 'rotate-180')} /></button>
      {why && <ul className="px-4 pb-4 space-y-2 text-sm list-disc list-inside text-ink/80">{inv.reasons.map(r => <li key={r}>{r}</li>)}</ul>}</section>

    <ProvenanceChips inv={inv} />
    <SimilarCases cases={inv.similarCases} />

    {held && inv.verdict === 'WARN' && !inv.payeeMismatch && !inv.acknowledged && <button className="btn-primary w-full" disabled={!!busy} onClick={() => run('ack', () => api.acknowledge(inv.id), 'Warning acknowledged.')}>{busy === 'ack' ? <Loader2 className="animate-spin" /> : <ShieldCheck size={18} />}I understand the warning. Release the payment.</button>}
    {held && <button className="btn-danger w-full !h-14 text-base" disabled={!!busy} onClick={() => run('cancel', () => api.cancelOrder(inv.id), 'Order cancelled. PayPal authorization voided.')}>{busy === 'cancel' ? <Loader2 className="animate-spin" /> : <XCircle size={18} />}Cancel Order & Void PayPal Authorization</button>}
    {held && inv.verdict === 'WARN' && <button className="btn-secondary w-full" disabled={!!busy || inv.reviewRequested} onClick={() => run('rev', () => api.requestReview(inv.id), 'Analyst review requested')}>{inv.reviewRequested ? 'Analyst review requested' : 'Request analyst review'}</button>}
    <div className="grid grid-cols-2 gap-2"><button className="btn-secondary !bg-tint" onClick={() => setLog(true)}><TerminalSquare size={16} />Inspect Audit Log</button>
      <button className="btn-secondary !bg-tint" onClick={() => setRep(true)}><Flag size={16} />Report Merchant</button></div>
    <button className="text-sm text-electric font-semibold block mx-auto" onClick={() => nav(`/engine/${inv.id}`)}>Open full engine analysis</button>
    <p className="text-center text-[11px] text-muted font-mono break-all">{inv.simulated ? 'Simulated payment: no PayPal call was made' : 'PayPal sandbox payment'}</p>

    <Modal open={log} onClose={() => setLog(false)} title="Audit log"><pre className="text-[11px] font-mono bg-canvas inset rounded p-3 overflow-auto max-h-[50vh]">{JSON.stringify(inv, null, 2)}</pre></Modal>
    <Modal open={rep} onClose={() => setRep(false)} title="Report merchant"><form onSubmit={submitReport} className="space-y-3">
      <p className="text-sm text-muted">Reporting <span className="font-mono">{inv.domain}</span></p>
      <textarea required className="input !h-28 py-2" placeholder="What looked wrong?" value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason" />
      <button className="btn-danger w-full" disabled={busy === 'rep'}>Submit report</button></form></Modal>
  </>;
}
