import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, PanelLeftClose, PanelLeftOpen, RotateCcw, Search } from 'lucide-react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from 'ag-grid-community';
import type { Investigation } from '../types';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { usePanel } from '../hooks/usePanel';
import { SHOW_RESET } from '../lib/env';
import { ResetDialog } from '../components/ResetDialog';
import { CaseVerdict } from '../components/CaseVerdict';
import { Icon } from '../components/ui';
import { useApp } from '../context/OrderStateContext';
import { STORES } from '../data/stores';
import { CAPTURE_LABEL, cn } from '../lib/format';
import { formatDateTime } from '../lib/labels';
import { gridTheme } from '../lib/gridTheme';

ModuleRegistry.registerModules([AllCommunityModule]);

const SEGMENTS = [{ v: 'ALL', l: 'All' }, { v: 'ALLOW', l: 'Cleared' }, { v: 'WARN', l: 'Needs review' }, { v: 'PAUSE', l: 'Held' }] as const;

const provenanceText = (i: Investigation): string =>
  i.provenance ? `signals ${i.provenance.signals} / language model ${i.provenance.llm} / memory ${i.provenance.memory}` : '';

/** A full-bleed table of every case, with a collapsible filter panel. */
export default function AnalystConsole() {
  usePageTitle('Analyst');
  const { list, reload } = useInvestigations(2000); const { toast } = useApp();
  const panel = usePanel('analyst');
  const [f, setF] = useState<typeof SEGMENTS[number]['v']>('ALL'); const [q, setQ] = useState(''); const [min, setMin] = useState(0); const [sel, setSel] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const grid = useRef<AgGridReact<Investigation>>(null);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && i.riskScore >= min && (i.domain + (i.payeeName ?? '') + i.claimedBrand).toLowerCase().includes(q.toLowerCase())), [list, f, q, min]);
  const cur = sel ? list.find(i => i.id === sel) : undefined;

  const columns = useMemo<ColDef<Investigation>[]>(() => [
    { headerName: 'Time', field: 'createdAt', valueFormatter: p => (p.value ? formatDateTime(p.value as string) : ''), sort: 'desc', width: 175, filter: 'agTextColumnFilter' },
    { headerName: 'Domain', field: 'domain', flex: 2, minWidth: 200, filter: 'agTextColumnFilter' },
    { headerName: 'Claimed brand', field: 'claimedBrand', flex: 1, minWidth: 150, filter: 'agTextColumnFilter' },
    { headerName: 'Decision', field: 'verdict', width: 250, filter: 'agTextColumnFilter', cellRenderer: (p: ICellRendererParams<Investigation>) => p.data ? <CaseVerdict inv={p.data} note={false} /> : null },
    { headerName: 'Score', field: 'riskScore', width: 110, filter: 'agNumberColumnFilter', valueFormatter: p => (p.data?.status === 'COMPLETE' ? String(p.value) : '…') },
    { headerName: 'Payment', field: 'captureState', width: 140, filter: 'agTextColumnFilter', valueFormatter: p => CAPTURE_LABEL[p.value as keyof typeof CAPTURE_LABEL] ?? String(p.value) },
    { headerName: 'How it was checked', valueGetter: p => (p.data ? provenanceText(p.data) : ''), flex: 2, minWidth: 260, filter: 'agTextColumnFilter' },
  ], []);

  return <div className="flex flex-col md:flex-row md:h-[calc(100dvh-52px)]">
    {panel.open && <aside id="analyst-filters" aria-label="Filters" className="md:w-64 shrink-0 md:overflow-auto border-b md:border-b-0 md:border-r border-line p-4 space-y-6">
      <div><h2 className="font-semibold">Filters</h2></div>
      <fieldset><legend className="label mb-1">Decision</legend>
        <div className="flex flex-col gap-1">{SEGMENTS.map(s => <button key={s.v} type="button" aria-pressed={f === s.v} onClick={() => setF(s.v)}
          className={cn('text-left px-2 h-8 rounded text-sm', f === s.v ? 'bg-surface-2 font-semibold' : 'text-muted hover:text-content')}>{s.l}</button>)}</div></fieldset>
      <div><label htmlFor="min-risk" className="label block mb-1">Lowest score: <span className="num text-content">{min}</span></label>
        <input id="min-risk" type="range" min={0} max={100} value={min} onChange={e => setMin(+e.target.value)} className="w-full" /></div>
      <div><p className="label mb-1">Demo stores</p><ul className="space-y-1">{STORES.map(s => <li key={s.id}><Link to={`/store/${s.id}`} target="_blank" rel="noreferrer" className="link text-sm">{s.name}<span className="sr-only"> (opens in a new tab)</span></Link></li>)}</ul></div>
    </aside>}

    <section className="flex-1 min-w-0 flex flex-col" aria-label="Cases">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 border-b border-line">
        <h1 className="!text-lg !font-semibold">Analyst console</h1>
        <button type="button" className="tbtn" aria-expanded={panel.open} aria-controls="analyst-filters" onClick={panel.toggle}>
          <Icon icon={panel.open ? PanelLeftClose : PanelLeftOpen} size={16} />{panel.open ? 'Hide' : 'Show'} filters <kbd className="font-mono text-[11px] border border-line rounded px-1">[</kbd></button>
        <div className="relative flex-1 min-w-[180px] max-w-sm"><Icon icon={Search} size={16} className="absolute left-3 top-3 text-muted" />
          <input className="input pl-9" placeholder="Filter domain, brand or payee" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter cases" /></div>
        <span className="label num" aria-live="polite">{rows.length} of {list.length}</span>
        <div className="ml-auto flex items-center gap-4">
          <button type="button" className="tbtn" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: 'trustora-cases.csv' })}><Icon icon={Download} size={16} />Export CSV</button>
          {SHOW_RESET && <button type="button" className="tbtn" onClick={() => setResetting(true)}><Icon icon={RotateCcw} size={16} />Reset demo</button>}
        </div>
      </div>
      {cur && <p className="px-4 py-2 border-b border-line text-sm flex flex-wrap items-center gap-x-4 gap-y-1"><span className="font-mono">{cur.domain}</span><CaseVerdict inv={cur} note={false} />
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
    </section>
    {resetting && <ResetDialog onClose={() => setResetting(false)} onDone={() => { setResetting(false); reload(); setSel(null); toast('Demo data reset', 'ok'); }} />}
  </div>;
}
