import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert, Ban, Download, Loader2, Radar, ArrowRight, Printer, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/OrderStateContext';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../api/apiClient';
import { Empty, Modal, Pill, Skeleton } from '../components/ui';
import { StatusRows } from '../components/StatusRows';
import { Timeline } from '../components/Timeline';
import { SimilarCases } from '../components/Provenance';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { HowChecked, SignalChecklist } from '../components/HowChecked';
import { download } from '../lib/format';
import { displayBrand } from '../lib/labels';

export default function Engine() {
  usePageTitle('Investigation');
  const { id } = useParams(); const nav = useNavigate();
  const { latestId, setLatestId, toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? latestId ?? list[0]?.id;
  const { inv, latency, error, refresh } = useOrderPolling(target);
  const [busy, setBusy] = useState(false); const [exp, setExp] = useState(false);
  useEffect(() => { if (id) setLatestId(id); }, [id, setLatestId]);

  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <EmptyCard icon={Radar} title="No investigations yet">Scan a URL or check out from a demo store to start the checker.<div className="mt-4 flex gap-2 justify-center"><Link className="btn-direct" to="/scanner">Scan URL</Link><Link className="btn-secondary" to="/stores">Demo stores</Link></div></EmptyCard>;
  if (error && !inv) return <EmptyCard icon={ShieldAlert} title="Cannot reach the checker"><p>{error}</p><button className="btn-primary mt-4" onClick={refresh}>Retry</button></EmptyCard>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;

  const done = inv.status === 'COMPLETE';
  const act = async () => {
    setBusy(true);
    try {
      if (inv.orderId) { await api.cancelOrder(inv.id); toast('Purchase cancelled. The PayPal authorization was voided.', 'ok'); }
      else { await api.reportMerchant({ domain: inv.domain, reason: 'Reported from the scan screen', investigationId: inv.id }); toast(`${inv.domain} reported`, 'ok'); }
      refresh();
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const voided = inv.captureState === 'VOIDED';

  return <>
    <section className="card xl space-y-4 p-6">
      <div className="flex justify-between gap-2"><Pill tone="info">{done ? 'Check finished' : 'Check running'}</Pill><Pill tone="neutral" className="font-mono">{latency} ms</Pill></div>
      <h1 className="text-[22px] font-bold leading-7">Merchant check</h1>
      <p className="text-sm text-muted">Compares what the website claims with the account that would be paid, using rule-based checks.</p>
      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-tint p-3">
        <div><dt className="mono-label">Checks done</dt><dd className="font-mono font-semibold text-sm mt-1">{inv.evidence.length} of 4</dd></div>
        <div><dt className="mono-label">Confidence</dt><dd className="font-mono font-semibold text-sm mt-1">{done ? `${inv.confidence}%` : '—'}</dd></div>
        <div><dt className="mono-label">Site</dt><dd className="font-mono font-semibold text-sm mt-1 break-all">{displayBrand(inv.claimedBrand, inv.domain)}</dd></div></dl>
    </section>

    <ClaimedVsActual inv={inv} />

    {done ? <StatusRows inv={inv} />
      : <section className="card flex items-center gap-3 p-5" aria-busy="true"><Loader2 className="animate-spin text-electric" /><div><div className="font-semibold">Investigation in progress</div><div className="text-sm text-muted">Collecting signals from {inv.domain}…</div></div></section>}

    <section className="card xl"><div className="flex justify-between items-center mb-4"><h2 className="font-semibold">Checks run</h2><span className="mono-label bg-tint rounded px-2 py-1">{inv.evidence.length} of 4</span></div>
      <Timeline evidence={inv.evidence} /></section>

    {done && <SimilarCases cases={inv.similarCases} />}
    {done && <SignalChecklist availability={inv.signalAvailability} reason={inv.confidenceReason} />}
    {done && <HowChecked inv={inv} />}

    <section className="card xl space-y-3"><h2 className="font-semibold">Actions</h2>
      {done && inv.verdict !== 'ALLOW' && <button className="btn-danger w-full" disabled={busy || voided} onClick={act}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Ban size={16} />}{voided ? 'Purchase cancelled' : inv.orderId ? 'Cancel purchase and report seller' : 'Report seller'}</button>}
      {inv.orderId && <button className="btn-primary w-full" onClick={() => nav(`/pay/${inv.id}`)}>View payment<ArrowRight size={16} /></button>}
      <button className="btn-secondary w-full !bg-tint" onClick={() => setExp(true)} disabled={!done}><Download size={16} />Export this record</button></section>

    <Modal open={exp} onClose={() => setExp(false)} title="Export this record">
      <p className="text-sm text-muted mb-4">Includes every check, the confidence scores and the final decision.</p>
      <div className="grid grid-cols-2 gap-2"><button className="btn-primary" onClick={() => { download(`record-${inv.id}.json`, inv); setExp(false); }}><Download size={16} />JSON</button>
        <button className="btn-secondary" onClick={() => { setExp(false); setTimeout(() => window.print(), 100); }}><Printer size={16} />Print or save as PDF</button></div></Modal>
  </>;
}

function EmptyCard({ icon: IconComp, title, children }: { icon: React.ComponentType<any>; title: string; children: React.ReactNode }) {
  return <div className="text-center py-16"><IconComp className="h-12 w-12 text-muted mb-3" aria-hidden="true" /><h3 className="font-semibold">{title}</h3>{children}</div>;
}
