import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert, Ban, Download, Loader2, Radar, ArrowRight, Printer } from 'lucide-react';
import { useApp } from '../context/OrderStateContext';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { api } from '../api/apiClient';
import { Empty, Modal, Pill, Skeleton } from '../components/ui';
import { StatusRows } from '../components/StatusRows';
import { Timeline } from '../components/Timeline';
import { ProvenanceChips, SimilarCases } from '../components/Provenance';
import { ageLabel, download, money, type Tone } from '../lib/format';
import { displayBrand } from '../lib/labels';

const SIGNAL_LABEL: Record<string, string> = {
  page: 'Merchant page',
  domainAge: 'Domain age',
  registry: 'Merchant registry',
  price: 'Price comparison',
  tls: 'Security certificate',
  payee: 'Receiving account',
  registrarReputation: 'Registrar reputation',
};
const SIGNAL_VALUE: Record<string, string> = {
  ok: 'read', blocked: 'blocked the checker', empty: 'no readable content', unavailable: 'could not be checked', not_checked: 'not checked',
  known: 'known', found: 'found', valid: 'valid', invalid: 'problem found', provided: 'supplied', not_provided: 'not supplied', not_assessed: 'not assessed',
};

const signalTone = (value: string): Tone =>
  value === 'blocked' || value === 'invalid'
    ? 'bad'
    : value === 'unavailable' || value === 'not_checked' || value === 'not_assessed' || value === 'empty' || value === 'not_provided'
      ? 'warn'
      : 'ok';

export default function Engine() {
  usePageTitle('Investigation');
  const { id } = useParams(); const nav = useNavigate();
  const { latestId, setLatestId, toast } = useApp();
  const { list, loading } = useInvestigations();
  const target = id ?? latestId ?? list[0]?.id;
  const { inv, latency, error, refresh } = useOrderPolling(target);
  const [busy, setBusy] = useState(false); const [exp, setExp] = useState(false);
  useEffect(() => { if (id) setLatestId(id); }, [id, setLatestId]);

  if (!target) return loading ? <Skeleton className="h-40 w-full" /> : <Empty icon={<Radar />} title="No investigations yet">Scan a URL or check out from a demo store to start the checker.<div className="mt-4 flex gap-2 justify-center"><Link className="btn-direct" to="/scanner">Scan URL</Link><Link className="btn-secondary" to="/stores">Demo stores</Link></div></Empty>;
  if (error && !inv) return <Empty icon={<ShieldAlert />} title="Cannot reach the checker"><p>{error}</p><button className="btn-primary mt-4" onClick={refresh}>Retry</button></Empty>;
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
    <section className="card space-y-3">
      <div className="flex justify-between gap-2"><Pill tone="info">{done ? 'Check finished' : 'Check running'}</Pill><Pill tone="neutral" className="font-mono">{latency} ms</Pill></div>
      <h1 className="text-[22px] font-semibold leading-7">Merchant check</h1>
      <p className="text-sm text-muted">Compares what the website claims with the account that would be paid, using rule-based checks.</p>
      <dl className="grid grid-cols-3 gap-2 rounded-lg bg-tint p-3">
        <div><dt className="mono-label">Checks done</dt><dd className="font-mono font-semibold text-sm mt-1">{inv.evidence.length} of 4</dd></div>
        <div><dt className="mono-label">Confidence</dt><dd className="font-mono font-semibold text-sm mt-1">{done ? `${inv.confidence}%` : '—'}</dd></div>
        <div><dt className="mono-label">Site</dt><dd className="font-mono font-semibold text-sm mt-1 break-all">{displayBrand(inv.claimedBrand, inv.domain)}</dd></div></dl>
    </section>

    {done ? <StatusRows inv={inv} />
      : <section className="card flex items-center gap-3" aria-busy="true"><Loader2 className="animate-spin text-electric" /><div><div className="font-semibold">Investigation in progress</div><div className="text-sm text-muted">Collecting signals from {inv.domain}…</div></div></section>}

    <section className="card">
      <div className="flex justify-between items-center mb-4"><h2 className="font-semibold">Checks run</h2><span className="mono-label bg-tint rounded px-2 py-1">{inv.evidence.length} of 4</span></div>
      <Timeline evidence={inv.evidence} /></section>

    {done && <ProvenanceChips inv={inv} />}
    {done && <SimilarCases cases={inv.similarCases} />}

    {done && inv.signalAvailability && <section className="card space-y-3" aria-label="What was checked">
      <div className="flex justify-between items-center"><h2 className="font-semibold">What was checked</h2></div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">{Object.entries(inv.signalAvailability).map(([key, value]) => <div key={key} className="rounded-lg bg-tint p-2">
        <div className="mono-label">{SIGNAL_LABEL[key] ?? key}</div>
        <div className="mt-1"><Pill tone={signalTone(value)}>{SIGNAL_VALUE[value] ?? value.replace(/_/g, ' ')}</Pill></div></div>)}</div>
      {inv.confidenceReason && <p className="text-xs text-muted">{inv.confidenceReason}</p>}
    </section>}

    {done && <section className="card space-y-3">
      <div className="flex justify-between items-center"><h2 className="font-semibold">Claimed vs actual</h2>{inv.verdict !== 'ALLOW' && <Pill tone="bad">Not cleared</Pill>}</div>
      {[['Who is paid', 'Storefront says', displayBrand(inv.claimedBrand, inv.domain), 'PayPal pays', inv.payeeName ?? 'Not supplied'],
        ['Price', 'Comparable price', inv.benchmark === null ? 'Not available' : money(inv.benchmark), 'Checkout price', inv.price === null ? 'Not provided' : money(inv.price)],
        ['Merchant', 'Registered business records', inv.registryRecords === null ? 'Not checked' : `${inv.registryRecords} found`, 'Domain age', ageLabel(inv.domainAgeDays)]].map(([h, a, av, b, bv]) => <div key={h} className="rounded-lg bg-tint p-3">
        <div className="mono-label mb-2">{h}</div><div className="grid grid-cols-2 gap-2"><div className="bg-surface rounded p-2"><div className="mono-label">{a}</div><div className="text-sm font-semibold break-words">{av}</div></div>
          <div className={inv.verdict === 'ALLOW' ? 'rounded p-2 bg-ok-bg' : 'rounded p-2 bg-bad-bg'}><div className={inv.verdict === 'ALLOW' ? 'mono-label' : 'mono-label !text-bad-deep'}>{b}</div><div className="text-sm font-semibold break-words">{bv}</div></div></div></div>)}</section>}

    <section className="card space-y-3"><h2 className="font-semibold">Actions</h2>
      {done && inv.verdict !== 'ALLOW' && <button className="btn-danger w-full" disabled={busy || voided} onClick={act}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Ban size={16} />}{voided ? 'Purchase cancelled' : inv.orderId ? 'Cancel purchase and report seller' : 'Report seller'}</button>}
      {inv.orderId && <button className="btn-primary w-full" onClick={() => nav(`/pay/${inv.id}`)}>View payment<ArrowRight size={16} /></button>}
      <button className="btn-secondary w-full !bg-tint" onClick={() => setExp(true)} disabled={!done}><Download size={16} />Export this record</button></section>

    <Modal open={exp} onClose={() => setExp(false)} title="Export this record">
      <p className="text-sm text-muted mb-4">Includes every check, the confidence scores and the final decision.</p>
      <div className="grid grid-cols-2 gap-2"><button className="btn-primary" onClick={() => { download(`record-${inv.id}.json`, inv); setExp(false); }}><Download size={16} />JSON</button>
        <button className="btn-secondary" onClick={() => { setExp(false); setTimeout(() => window.print(), 100); }}><Printer size={16} />Print or save as PDF</button></div></Modal>
  </>;
}
