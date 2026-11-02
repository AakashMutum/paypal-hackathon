import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ExternalLink, RotateCcw, Search, ShieldHalf } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import { STORES } from '../data/stores';
import { EvidenceCard } from '../components/EvidenceCard';
import { Pill, RiskBadge } from '../components/ui';
import { CAPTURE_LABEL, clock, cn, money } from '../lib/format';
const F = ['ALL', 'ALLOW', 'WARN', 'BLOCK'] as const;
export default function AnalystConsole() {
  const { list, reload } = useInvestigations(2000); const { toast } = useApp();
  const [f, setF] = useState<typeof F[number]>('ALL'); const [q, setQ] = useState(''); const [min, setMin] = useState(0); const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && i.riskScore >= min && (i.domain + i.payeeName).toLowerCase().includes(q.toLowerCase())), [list, f, q, min]);
  const cur = list.find(i => i.id === (sel ?? rows[0]?.id));
  return <div className="min-h-screen bg-canvas">
    <header className="bg-white border-b border-ink/10"><div className="max-w-[1440px] mx-auto px-8 h-14 flex items-center gap-4">
      <Link to="/" className="btn-secondary !h-9"><ArrowLeft size={14} />App</Link>
      <span className="w-8 h-8 rounded bg-navy text-white grid place-items-center"><ShieldHalf size={18} /></span><h1 className="font-bold">Analyst Console</h1>
      <Pill tone="cyan" pulse>LIVE</Pill>
      <button className="btn-secondary !h-9 ml-auto" onClick={async () => { await api.resetDemo(); reload(); setSel(null); toast('Demo data reset', 'ok'); }}><RotateCcw size={14} />Reset demo</button></div></header>
    <main className="max-w-[1440px] mx-auto px-4 md:px-8 py-6 grid lg:grid-cols-12 gap-6">
      <section className="lg:col-span-7 space-y-4">
        <div className="card flex flex-wrap items-center gap-2"><span className="mono-label mr-2">Launch demo</span>
          {STORES.map(s => <Link key={s.id} to={`/store/${s.id}`} target="_blank" className="btn-secondary !h-9 text-xs">{s.name}<ExternalLink size={12} /></Link>)}</div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-canvas border border-ink/10 p-0.5 rounded-md flex">{F.map(x => <button key={x} onClick={() => setF(x)} className={cn('px-3 py-1.5 rounded text-xs font-semibold', f === x ? 'bg-white shadow-l1' : 'text-muted')}>{x}</button>)}</div>
          <div className="relative flex-1 min-w-[160px]"><Search size={14} className="absolute left-3 top-3 text-muted" /><input className="input pl-8" placeholder="Filter domain or payee" value={q} onChange={e => setQ(e.target.value)} aria-label="Filter" /></div>
          <label className="flex items-center gap-2 text-xs font-mono text-muted">MIN RISK {min}<input type="range" min={0} max={100} value={min} onChange={e => setMin(+e.target.value)} /></label></div>
        <div className="card !p-0 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-canvas h-9 text-left">{['TIME', 'DOMAIN', 'PAYEE', 'SCORE', 'VERDICT', 'CAPTURE'].map(h => <th key={h} className="mono-label px-4">{h}</th>)}</tr></thead>
          <tbody>{rows.map(i => <tr key={i.id} onClick={() => setSel(i.id)} className={cn('h-12 border-t border-ink/5 cursor-pointer hover:bg-[#F8FAFD]', cur?.id === i.id && 'bg-tint')}>
            <td className="px-4 font-mono text-xs">{clock(i.createdAt)}</td><td className="px-4 font-mono text-xs font-semibold">{i.domain}</td><td className="px-4 text-xs truncate max-w-[160px]">{i.payeeName}</td>
            <td className="px-4 font-mono font-semibold">{i.status === 'COMPLETE' ? i.riskScore : '…'}</td><td className="px-4"><RiskBadge verdict={i.verdict} /></td><td className="px-4 font-mono text-xs">{CAPTURE_LABEL[i.captureState]}</td></tr>)}
            {!rows.length && <tr><td colSpan={6} className="p-6 text-center text-muted">No rows match these filters.</td></tr>}</tbody></table></div></section>
      <aside className="lg:col-span-5 space-y-3">
        {cur ? <><div className={cn('card', cur.verdict === 'BLOCK' && 'border-l-[3px] !border-l-bad', cur.verdict === 'WARN' && 'border-l-[3px] !border-l-warn')}>
          <div className="flex justify-between"><h2 className="font-semibold text-lg">{cur.domain}</h2><RiskBadge verdict={cur.verdict} /></div>
          <p className="text-sm text-muted mt-1">{cur.productName} · {money(cur.price)} vs {money(cur.benchmark)} · {cur.payeeTier}</p>
          <p className="text-sm mt-2">{cur.reasons[0]}</p>
          <div className="flex gap-2 mt-3"><Link to={`/engine/${cur.id}`} className="btn-primary !h-9 text-xs">Open engine</Link>{cur.orderId && <Link to={`/pay/${cur.id}`} className="btn-secondary !h-9 text-xs">Payment view</Link>}</div></div>
          {cur.evidence.map((e, n) => <EvidenceCard key={e.id} e={e} index={n} />)}</> : <div className="card text-sm text-muted">Select a row to inspect its evidence.</div>}
      </aside></main></div>;
}
