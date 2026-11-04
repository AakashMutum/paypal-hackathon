import { usePageTitle } from '../hooks/usePageTitle';
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Download, ExternalLink, RotateCcw, Search, ShieldHalf } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import type { Investigation } from '../types';
import { useInvestigations } from '../hooks/useOrderPolling';
import { USE_MOCK } from '../api/apiClient';
import { SHOW_RESET } from '../lib/env';
import { ResetDialog } from '../components/ResetDialog';
import { useApp } from '../context/OrderStateContext';
import { STORES } from '../data/stores';
import { EvidenceCard } from '../components/EvidenceCard';
import { ProvenanceChips, SimilarCases } from '../components/Provenance';
import { Pill, RiskBadge } from '../components/ui';
import { CAPTURE_LABEL, cn, money } from '../lib/format';
import { formatDateTime } from '../lib/labels';

ModuleRegistry.registerModules([AllCommunityModule]);

const F = ['ALL', 'ALLOW', 'WARN', 'PAUSE'] as const;

const provenanceText = (i: Investigation): string =>
  i.provenance ? `signals ${i.provenance.signals} / llm ${i.provenance.llm} / memory ${i.provenance.memory}` : '';

export default function AnalystConsole() {
  usePageTitle('Analyst');
  const { list, reload } = useInvestigations(2000); const { toast } = useApp();
  const [f, setF] = useState<typeof F[number]>('ALL'); const [q, setQ] = useState(''); const [min, setMin] = useState(0); const [sel, setSel] = useState<string | null>(null);
  const grid = useRef<AgGridReact<Investigation>>(null);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && i.riskScore >= min && (i.domain + (i.payeeName ?? '') + i.claimedBrand).toLowerCase().includes(q.toLowerCase())), [list, f, q, min]);
  const cur = list.find(i => i.id === (sel ?? rows[0]?.id));

  const columns = useMemo<ColDef<Investigation>[]>(() => [
    { headerName: 'Time', field: 'createdAt', valueFormatter: p => (p.value ? formatDateTime(p.value as string) : ''), sort: 'desc', width: 170 },
    { headerName: 'Domain', field: 'domain', flex: 2, minWidth: 180, filter: 'agTextColumnFilter' },
    { headerName: 'Claimed brand', field: 'claimedBrand', flex: 1, minWidth: 140, filter: 'agTextColumnFilter' },
    { headerName: 'Verdict', field: 'verdict', width: 130, filter: 'agTextColumnFilter', cellRenderer: (p: ICellRendererParams<Investigation>) => <RiskBadge verdict={p.data?.verdict} /> },
    { headerName: 'Score', field: 'riskScore', width: 120, filter: 'agNumberColumnFilter', valueFormatter: p => (p.data?.status === 'COMPLETE' ? String(p.value) : '…') },
    { headerName: 'Capture state', field: 'captureState', width: 140, filter: 'agTextColumnFilter', valueFormatter: p => CAPTURE_LABEL[p.value as keyof typeof CAPTURE_LABEL] ?? String(p.value) },
    { headerName: 'Provenance', valueGetter: p => (p.data ? provenanceText(p.data) : ''), flex: 2, minWidth: 220, filter: 'agTextColumnFilter' },
  ], []);

  const [resetting, setResetting] = useState(false);

  return <div className="min-h-screen bg-canvas">
    <header className="bg-white border-b border-ink/10"><div className="max-w-[1440px] mx-auto px-8 h-14 flex items-center gap-4">
      <Link to="/" className="btn-secondary !h-9"><ArrowLeft size={14} />App</Link>
      <span className="w-8 h-8 rounded bg-navy text-white grid place-items-center"><ShieldHalf size={18} /></span><h1 className="font-bold">Analyst Console</h1>
      <Pill tone={USE_MOCK ? 'warn' : 'cyan'} pulse>{USE_MOCK ? 'SIMULATED' : 'LIVE'}</Pill>
      {SHOW_RESET && <button className="btn-secondary !h-9 ml-auto" onClick={() => setResetting(true)}><RotateCcw size={14} />Reset demo</button>}</div></header>
    {resetting && <ResetDialog onClose={() => setResetting(false)} onDone={() => { setResetting(false); reload(); setSel(null); toast('Demo data reset', 'ok'); }} />}
    <main className="max-w-[1440px] mx-auto px-4 md:px-8 py-6 grid lg:grid-cols-12 gap-6">
      <section className="lg:col-span-7 space-y-4">
        <div className="card flex flex-wrap items-center gap-2"><span className="mono-label mr-2">Launch demo</span>
          {STORES.map(s => <Link key={s.id} to={`/store/${s.id}`} target="_blank" className="btn-secondary !h-9 text-xs">{s.name}<ExternalLink size={12} /></Link>)}</div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-canvas border border-ink/10 p-0.5 rounded-md flex">{F.map(x => <button key={x} onClick={() => setF(x)} className={cn('px-3 py-1.5 rounded text-xs font-semibold', f === x ? 'bg-white shadow-l1' : 'text-muted')}>{x}</button>)}</div>
          <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-3 top-3 text-muted" /><input className="input pl-8" placeholder="Filter domain, brand or payee" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter" /></div>
          <label className="flex items-center gap-2 text-xs font-mono text-muted">MIN RISK {min}<input type="range" min={0} max={100} value={min} onChange={e => setMin(+e.target.value)} /></label>
          <button className="btn-secondary !h-9 text-xs" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: 'trustora-investigations.csv' })}><Download size={14} />Export CSV</button></div>
        <div className="card !p-0 overflow-hidden" style={{ height: 460 }} role="region" aria-label="Investigations">
          <AgGridReact<Investigation>
            ref={grid}
            rowData={rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, filter: true, resizable: true, floatingFilter: true }}
            getRowId={p => p.data.id}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            onRowClicked={e => e.data && setSel(e.data.id)}
            overlayNoRowsTemplate="No rows match these filters."
          /></div></section>
      <aside className="lg:col-span-5 space-y-3">
        {cur ? <><div className={cn('card', cur.verdict === 'PAUSE' && 'border-l-[3px] !border-l-bad', cur.verdict === 'WARN' && 'border-l-[3px] !border-l-warn')}>
          <div className="flex justify-between"><h2 className="font-semibold text-lg">{cur.domain}</h2><RiskBadge verdict={cur.verdict} /></div>
          <p className="text-sm text-muted mt-1">{cur.productName} · {money(cur.price)} vs {money(cur.benchmark)} · {cur.payeeTier ?? 'Payee not supplied'}</p>
          <p className="text-sm mt-2">{cur.reasons[0]}</p>
          {cur.confidenceReason && <p className="text-xs text-muted mt-1">{cur.confidenceReason}</p>}
          {cur.captureReason && <p className="text-xs font-mono text-muted mt-2">{CAPTURE_LABEL[cur.captureState]}: {cur.captureReason}</p>}
          <div className="mt-3"><ProvenanceChips inv={cur} /></div>
          <div className="flex gap-2 mt-3"><Link to={`/engine/${cur.id}`} className="btn-primary !h-9 text-xs">Open engine</Link>{cur.orderId && <Link to={`/pay/${cur.id}`} className="btn-secondary !h-9 text-xs">Payment view</Link>}</div></div>
          {cur.evidence.map((e, n) => <EvidenceCard key={e.id} e={e} index={n} />)}
          <SimilarCases cases={cur.similarCases} />
          {cur.trace && cur.trace.length > 0 && <section className="card" aria-label="Investigation trace">
            <h2 className="font-semibold mb-2">Trace</h2>
            <ol className="space-y-1 text-xs font-mono">{cur.trace.map(t => <li key={t.step} className="flex gap-2"><span className="text-muted">{t.step}.</span><span className={cn('font-semibold', !t.ok && 'text-bad')}>{t.tool}</span><span className="text-ink/70 break-all">{t.result} ({Math.round(t.ms)} ms)</span></li>)}</ol></section>}
        </> : <div className="card text-sm text-muted">Select a row to inspect its evidence.</div>}
      </aside></main></div>;
}
