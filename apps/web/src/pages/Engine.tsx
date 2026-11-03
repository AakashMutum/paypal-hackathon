import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Cpu, ShieldAlert, ShieldCheck, Ban, Download, Loader2, Radar, ArrowRight, Printer } from 'lucide-react';
import { useApp } from '../context/OrderStateContext';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { api } from '../api/apiClient';
import { Empty, Modal, Pill } from '../components/ui';
import { Timeline } from '../components/Timeline';
import { ProvenanceChips, SimilarCases } from '../components/Provenance';
import { ageLabel, CAPTURE_LABEL, cn, download, money, VERDICT } from '../lib/format';

export default function Engine() {
  const { id } = useParams(); const nav = useNavigate();
  const { latestId, setLatestId, toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? latestId ?? list[0]?.id;
  const { inv, latency, error, refresh } = useOrderPolling(target);
  const [busy, setBusy] = useState(false); const [exp, setExp] = useState(false);
  useEffect(() => { if (id) setLatestId(id); }, [id, setLatestId]);

  if (!target) return loading ? null : <Empty icon={<Radar />} title="No investigations yet">Scan a URL or check out from a demo store to start the engine.<div className="mt-4 flex gap-2 justify-center"><Link className="btn-direct" to="/scanner">Scan URL</Link><Link className="btn-secondary" to="/stores">Demo stores</Link></div></Empty>;
  if (error && !inv) return <Empty icon={<ShieldAlert />} title="Can't reach the engine"><p>{error}</p><button className="btn-primary mt-4" onClick={refresh}>Retry</button></Empty>;
  if (!inv) return <p className="text-sm text-muted p-4">Loading investigation…</p>;

  const done = inv.status === 'COMPLETE', v = inv.verdict ? VERDICT[inv.verdict] : null;
  const phaseTone = !done ? 'text-electric' : inv.verdict === 'PAUSE' ? 'text-bad-deep' : inv.verdict === 'WARN' ? 'text-warn' : 'text-ok';
  const act = async () => {
    setBusy(true);
    try { if (inv.orderId) { await api.cancelOrder(inv.id); toast('Purchase aborted. PayPal authorization voided.', 'ok'); } else { await api.reportMerchant({ domain: inv.domain, reason: 'Blocked from scanner', investigationId: inv.id }); toast(`${inv.domain} added to your blocklist`, 'ok'); } refresh(); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const voided = inv.captureState === 'VOIDED';
  const bannerCls = inv.verdict === 'PAUSE' ? 'bg-bad-deep text-white' : inv.verdict === 'WARN' ? 'bg-warn text-ink' : 'bg-ok text-white';
  return <>
    <section className="card space-y-3">
      <div className="flex justify-between gap-2"><Pill tone="info"><Cpu size={12} />ENGINE CORE ACTIVE</Pill><Pill tone="neutral" className="font-mono">LATENCY: {latency}ms</Pill></div>
      <h1 className="text-[22px] font-semibold leading-7">Merchant Identity & Offer Consistency Engine</h1>
      <p className="text-sm text-muted">Deterministic multi-tier verification between website representation and live PayPal ledger capture.</p>
      <div className="grid grid-cols-3 gap-2 rounded-lg bg-tint p-3">
        <div><div className="mono-label">Pipeline phase</div><div className={cn('font-mono font-semibold text-sm mt-1', phaseTone)}>T-{inv.evidence.length} {done ? (inv.verdict === 'PAUSE' ? 'Blocked' : inv.verdict === 'WARN' ? 'Review' : 'Verified') : 'Running'}</div></div>
        <div><div className="mono-label">Confidence</div><div className="font-mono font-semibold text-sm mt-1">{done ? `${inv.confidence}%` : '—'}</div></div>
        <div><div className="mono-label">Capture state</div><div className={cn('font-mono font-semibold text-sm mt-1', phaseTone)}>{inv.orderId ? CAPTURE_LABEL[inv.captureState] : 'No order'}</div></div></div>
    </section>

    {done && v ? <section className={cn('rounded-lg p-5', bannerCls)} role="alert">
      <div className="flex gap-3"><span className="w-12 h-12 rounded bg-white/90 text-current grid place-items-center shrink-0">{inv.verdict === 'ALLOW' ? <ShieldCheck className="text-ok" /> : <ShieldAlert className="text-bad-deep" />}</span>
        <div><h2 className="text-lg font-bold uppercase leading-tight">{v.headline}</h2>
          <span className="inline-block mt-1 px-2 rounded-full bg-white/20 text-[11px] font-semibold tracking-wide">{voided ? 'AUTH VOIDED' : inv.orderId ? (inv.captureState === 'HELD' ? 'AUTH PAUSED' : 'AUTH ' + inv.captureState) : 'SCAN ONLY'}</span></div></div>
      <p className="text-sm mt-3 opacity-95">{inv.reasons[0]}</p></section>
      : <section className="card flex items-center gap-3"><Loader2 className="animate-spin text-electric" /><div><div className="font-semibold">Investigation in progress</div><div className="text-sm text-muted">Collecting signals from {inv.domain}…</div></div></section>}

    <section className="card">
      <div className="flex justify-between items-center mb-4"><h2 className="font-semibold">Inspection Telemetry Pipeline</h2><span className="mono-label bg-tint rounded px-2 py-1">4 checkpoints</span></div>
      <Timeline evidence={inv.evidence} /></section>

    {done && <ProvenanceChips inv={inv} />}
    {done && <SimilarCases cases={inv.similarCases} />}

    {done && <section className="card space-y-3">
      <div className="flex justify-between items-center"><h2 className="font-semibold">Ledger Discrepancy Matrix</h2>{inv.verdict !== 'ALLOW' && <Pill tone="bad">CRITICAL MISMATCH</Pill>}</div>
      {[['Entity discrepancy', 'Storefront promised', inv.claimedBrand, 'PayPal destination', inv.payeeName],
        ['Price verification', 'Retail value', money(inv.benchmark), 'Submitted checkout', money(inv.price)],
        ['Merchant status', 'Registry records', `${inv.registryRecords} found`, 'Receiver registration', `${ageLabel(inv.domainAgeDays)} ago`]].map(([h, a, av, b, bv]) => <div key={h} className="rounded-lg bg-tint p-3">
        <div className="mono-label mb-2">{h}</div><div className="grid grid-cols-2 gap-2"><div className="bg-white rounded p-2"><div className="mono-label">{a}</div><div className="text-sm font-semibold break-words">{av}</div></div>
          <div className={cn('rounded p-2', inv.verdict === 'ALLOW' ? 'bg-ok-bg' : 'bg-bad-bg')}><div className={cn('mono-label', inv.verdict !== 'ALLOW' && '!text-bad-deep')}>{b}</div><div className="text-sm font-semibold break-words">{bv}</div></div></div></div>)}</section>}

    <section className="card space-y-3"><h2 className="font-semibold">Forensic Mitigation Controls</h2>
      {done && inv.verdict !== 'ALLOW' && <button className="btn-danger w-full" disabled={busy || voided} onClick={act}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Ban size={16} />}{voided ? 'Purchase Aborted' : inv.orderId ? 'Abort Purchase & Block Seller' : 'Block Seller'}</button>}
      {inv.orderId && <button className="btn-primary w-full" onClick={() => nav(`/pay/${inv.id}`)}>View payment outcome<ArrowRight size={16} /></button>}
      <button className="btn-secondary w-full !bg-tint" onClick={() => setExp(true)} disabled={!done}><Download size={16} />Export Forensic Audit Log (JSON / PDF)</button></section>

    <Modal open={exp} onClose={() => setExp(false)} title="Export audit log">
      <p className="text-sm text-muted mb-4">Includes all evidence nodes, confidence scores and the final verdict.</p>
      <div className="grid grid-cols-2 gap-2"><button className="btn-primary" onClick={() => { download(`audit-${inv.id}.json`, inv); setExp(false); }}><Download size={16} />JSON</button>
        <button className="btn-secondary" onClick={() => { setExp(false); setTimeout(() => window.print(), 100); }}><Printer size={16} />PDF (print)</button></div></Modal>
  </>;
}
