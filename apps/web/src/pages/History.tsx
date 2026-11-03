import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Search } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { RiskBadge } from '../components/ui';
import { clock, cn, download } from '../lib/format';
const F = ['ALL', 'ALLOW', 'WARN', 'PAUSE'] as const;
export default function HistoryPage() {
  const { list, loading } = useInvestigations(3000); const nav = useNavigate();
  const [f, setF] = useState<typeof F[number]>('ALL'); const [q, setQ] = useState('');
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && (i.domain + i.claimedBrand + (i.payeeName ?? '')).toLowerCase().includes(q.toLowerCase())), [list, f, q]);
  return <>
    <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">History</h1>
      <button className="btn-secondary !h-9" onClick={() => download('guardian-history.json', rows)}><Download size={14} />Export</button></div>
    <div className="relative"><Search size={16} className="absolute left-3 top-3 text-muted" /><input className="input pl-9" placeholder="Search domain, brand or recipient" value={q} onChange={e => setQ(e.target.value)} aria-label="Search history" /></div>
    <div className="bg-canvas border border-ink/10 p-0.5 rounded-md inline-flex" role="tablist">{F.map(x => <button key={x} role="tab" aria-selected={f === x} onClick={() => setF(x)} className={cn('px-3 py-1.5 rounded text-xs font-semibold', f === x ? 'bg-white shadow-l1 text-ink' : 'text-muted')}>{x}</button>)}</div>
    <div className="card !p-0 divide-y divide-ink/5">
      {loading && <p className="p-5 text-sm text-muted">Loading…</p>}
      {!loading && !rows.length && <p className="p-5 text-sm text-muted">No assessments match. Try another filter or scan a site.</p>}
      {rows.map(i => <button key={i.id} onClick={() => nav(`/engine/${i.id}`)} className="w-full text-left p-4 flex justify-between items-center gap-3 hover:bg-[#F8FAFD]">
        <div className="min-w-0"><div className="font-mono text-sm font-semibold truncate">{i.domain}</div><div className="text-xs text-muted truncate">{i.claimedBrand} → {i.payeeName ?? 'Not supplied'} · <span className="font-mono">{clock(i.createdAt)}</span></div></div><RiskBadge verdict={i.verdict} /></button>)}</div>
  </>;
}
