import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RotateCcw, Search } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import type { Investigation } from '../types';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { SHOW_RESET } from '../lib/env';
import { ResetDialog } from '../components/ResetDialog';
import { Icon, VerdictText } from '../components/ui';
import { useApp } from '../context/OrderStateContext';
import { CAPTURE_LABEL, cn } from '../lib/format';
import { formatDateTime } from '../lib/labels';
import { gridTheme } from '../lib/gridTheme';

ModuleRegistry.registerModules([AllCommunityModule]);

// The analyst table is the one place the API's own words (ALLOW, WARN, PAUSE) are shown.
const SEGMENTS = ['ALL', 'ALLOW', 'WARN', 'PAUSE'] as const;

const provenanceText = (i: Investigation): string =>
  i.provenance ? `signals ${i.provenance.signals} / language model ${i.provenance.llm} / memory ${i.provenance.memory}` : '';

/** A full-width table of every case with a normal filter row, CSV export and the themed grid. */
export default function AnalystConsole() {
  usePageTitle('Analyst');
  const { list, reload } = useInvestigations(2000); const { toast } = useApp();
  const [f, setF] = useState<typeof SEGMENTS[number]>('ALL'); const [q, setQ] = useState(''); const [min, setMin] = useState(0); const [sel, setSel] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const grid = useRef<AgGridReact<Investigation>>(null);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && i.riskScore >= min && (i.domain + (i.payeeName ?? '') + i.claimedBrand).toLowerCase().includes(q.toLowerCase())), [list, f, q, min]);
  const cur = sel ? list.find(i => i.id === sel) : undefined;

  const columns = useMemo<ColDef<Investigation>[]>(() => [
    { headerName: 'Time', field: 'createdAt', valueFormatter: p => (p.value ? formatDateTime(p.value as string) : ''), sort: 'desc', width: 175, filter: 'agTextColumnFilter' },
    { headerName: 'Domain', field: 'domain', flex: 2, minWidth: 200, filter: 'agTextColumnFilter' },
    { headerName: 'Claimed brand', field: 'claimedBrand', flex: 1, minWidth: 150, filter: 'agTextColumnFilter' },
    { headerName: 'Verdict', field: 'verdict', width: 150, filter: 'agTextColumnFilter', cellRenderer: (p: ICellRendererParams<Investigation>) => p.data ? <VerdictText verdict={p.data.status === 'COMPLETE' ? p.data.verdict : undefined} code /> : null },
    { headerName: 'Score', field: 'riskScore', width: 110, filter: 'agNumberColumnFilter', valueFormatter: p => (p.data?.status === 'COMPLETE' ? String(p.value) : '…') },
    { headerName: 'Payment', field: 'captureState', width: 140, filter: 'agTextColumnFilter', valueFormatter: p => CAPTURE_LABEL[p.value as keyof typeof CAPTURE_LABEL] ?? String(p.value) },
    { headerName: 'How it was checked', valueGetter: p => (p.data ? provenanceText(p.data) : ''), flex: 2, minWidth: 260, filter: 'agTextColumnFilter' },
  ], []);

  return <div className="flex flex-col md:h-[calc(100dvh-52px)]">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 sm:px-6 py-4 border-b border-line">
      <h1 className="!text-xl">Analyst console</h1>
      <div className="inline-flex rounded-full border border-line-strong p-0.5" role="group" aria-label="Filter by verdict">{SEGMENTS.map(s =>
        <button key={s} type="button" aria-pressed={f === s} onClick={() => setF(s)} className={cn('px-4 h-9 rounded-full text-sm font-medium', f === s ? 'bg-action text-action-on' : 'text-muted hover:text-content')}>{s === 'ALL' ? 'All' : s}</button>)}</div>
      <div className="relative flex-1 min-w-[180px] max-w-sm"><Icon icon={Search} size={16} className="absolute left-3.5 top-3.5 text-muted" />
        <input className="input pl-10" placeholder="Filter domain, brand or payee" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter cases" /></div>
      <label className="flex items-center gap-2 text-sm text-muted" htmlFor="min-risk">Lowest score <span className="num text-content w-6">{min}</span>
        <input id="min-risk" type="range" min={0} max={100} value={min} onChange={e => setMin(+e.target.value)} className="w-28" /></label>
      <span className="label num" aria-live="polite">{rows.length} of {list.length}</span>
      <div className="ml-auto flex items-center gap-4">
        <button type="button" className="tbtn" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: 'trustora-cases.csv' })}><Icon icon={Download} size={16} />Export CSV</button>
        {SHOW_RESET && <button type="button" className="tbtn" onClick={() => setResetting(true)}><Icon icon={RotateCcw} size={16} />Reset demo</button>}
      </div>
    </div>
    {cur && <p className="px-4 sm:px-6 py-2 border-b border-line text-sm flex flex-wrap items-center gap-x-4 gap-y-1"><span className="font-mono">{cur.domain}</span><VerdictText verdict={cur.verdict} code />
      <Link className="link" to={`/engine/${cur.id}`}>Open case</Link>{cur.orderId && <Link className="link" to={`/pay/${cur.id}`}>Open payment</Link>}</p>}
    <div className="flex-1 min-h-[420px]" role="region" aria-label="Cases table">
      <AgGridReact<Investigation>
        ref={grid}
        theme={gridTheme}
        rowData={rows}
        columnDefs={columns}
        defaultColDef={{ sortable: true, filter: true, resizable: true, floatingFilter: true }}
        getRowId={p => p.data.id}
        rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
        onRowClicked={e => e.data && setSel(e.data.id)}
        overlayNoRowsTemplate="No rows match these filters."
      /></div>
    {resetting && <ResetDialog onClose={() => setResetting(false)} onDone={() => { setResetting(false); reload(); setSel(null); toast('Demo data reset', 'ok'); }} />}
  </div>;
}
