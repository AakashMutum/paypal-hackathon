import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { RiskBadge, Skeleton, WakeNote } from '../components/ui';
import { cn, download } from '../lib/format';
import { displayBrand, formatDateTime } from '../lib/labels';

const F = ['ALL', 'ALLOW', 'WARN', 'PAUSE'] as const;
export const HISTORY_PAGE_SIZE = 25;

export default function HistoryPage() {
  usePageTitle('History');
  const { list, loading, error } = useInvestigations(3000); const nav = useNavigate();
  const slow = useSlowLoading(loading);
  const [f, setF] = useState<typeof F[number]>('ALL'); const [q, setQ] = useState('');
  const [shown, setShown] = useState(HISTORY_PAGE_SIZE);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && (i.domain + i.claimedBrand + (i.payeeName ?? '')).toLowerCase().includes(q.toLowerCase())), [list, f, q]);
  const visible = rows.slice(0, shown);
  return <>
    <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">History</h1>
      <button className="btn-secondary !h-9" onClick={() => download('guardian-history.json', rows)}><Download size={14} aria-hidden="true" />Export</button></div>
    <div className="relative"><Search size={16} className="absolute left-3 top-3 text-muted" aria-hidden="true" /><input className="input pl-9" placeholder="Search domain, brand or recipient" value={q} onChange={e => { setQ(e.target.value); setShown(HISTORY_PAGE_SIZE); }} aria-label="Search history" /></div>
    <div className="bg-canvas border border-ink/10 p-0.5 rounded-md inline-flex" role="group" aria-label="Filter by decision">{F.map(x => <button key={x} aria-pressed={f === x} onClick={() => { setF(x); setShown(HISTORY_PAGE_SIZE); }} className={cn('px-3 py-1.5 rounded text-xs font-semibold', f === x ? 'bg-white shadow-l1 text-ink' : 'text-muted')}>{x}</button>)}</div>
    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="card text-sm text-bad">Could not load investigations: {error}</p>}
    <div className="card !p-0 divide-y divide-ink/5">
      {loading && <div className="p-4 space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>}
      {!loading && !rows.length && <p className="p-5 text-sm text-muted">No investigations match. Try another filter or scan a site.</p>}
      {visible.map(i => <button key={i.id} onClick={() => nav(`/engine/${i.id}`)} className="w-full text-left p-4 flex justify-between items-center gap-3 hover:bg-tint">
        <div className="min-w-0"><div className="font-mono text-sm font-semibold truncate">{i.domain}</div><div className="text-xs text-muted truncate">{displayBrand(i.claimedBrand, i.domain)} → {i.payeeName ?? 'Not supplied'} · <time dateTime={i.createdAt} className="font-mono">{formatDateTime(i.createdAt)}</time></div></div><RiskBadge verdict={i.verdict} /></button>)}</div>
    {rows.length > visible.length && <button className="btn-secondary w-full" onClick={() => setShown(n => n + HISTORY_PAGE_SIZE)}>Load more ({rows.length - visible.length} more)</button>}
  </>;
}
