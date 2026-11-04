import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, ListChecks, Search } from 'lucide-react';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { InvestigationView } from '../components/InvestigationView';
import { EmptyState, Icon, Skeleton, VerdictBadge, WakeNote } from '../components/ui';
import { cn, download } from '../lib/format';
import { displayBrand, formatDateTime, VERDICT_WORDS } from '../lib/labels';

const FILTERS = ['ALL', 'ALLOW', 'WARN', 'PAUSE'] as const;
export const PAGE_SIZE = 25;

function Detail({ id }: { id: string }) {
  const { inv, error } = useOrderPolling(id);
  if (error && !inv) return <p role="alert" className="card text-sm text-danger">Could not load this investigation: {error}</p>;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>;
  return <div className="space-y-4">
    <div className="card flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="font-semibold break-all font-mono text-base">{inv.domain}</h2>
        <p className="text-sm text-muted">{formatDateTime(inv.createdAt)}{inv.verdict ? ` · ${VERDICT_WORDS[inv.verdict].meaning}` : ''}</p></div>
      {inv.status === 'COMPLETE' && <VerdictBadge verdict={inv.verdict} />}</div>
    <InvestigationView inv={inv} />
  </div>;
}

/** List on the left, detail on the right (one column below 1024 px: the list, then the detail). */
export default function Investigations() {
  usePageTitle('Investigations');
  const { id } = useParams();
  const nav = useNavigate();
  const { list, loading, error } = useInvestigations(3000);
  const slow = useSlowLoading(loading);
  const [f, setF] = useState<typeof FILTERS[number]>('ALL'); const [q, setQ] = useState(''); const [shown, setShown] = useState(PAGE_SIZE);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && (i.domain + i.claimedBrand + (i.payeeName ?? '')).toLowerCase().includes(q.toLowerCase())), [list, f, q]);
  const visible = rows.slice(0, shown);
  const selected = id ?? (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? rows[0]?.id : undefined);

  const listPane = <div className={cn('space-y-3 min-w-0', id && 'hidden lg:block')}>
    <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-semibold">All investigations</h2>
      <button className="btn-secondary !h-9" onClick={() => download('trustora-investigations.json', rows)}><Icon icon={Download} size={16} />Export</button></div>
    <div className="relative"><Icon icon={Search} size={16} className="absolute left-3 top-3 text-muted" /><input className="input pl-9" placeholder="Search domain, brand or recipient" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE_SIZE); }} aria-label="Search investigations" /></div>
    <div className="inline-flex rounded-md border border-line-strong p-0.5 bg-surface" role="group" aria-label="Filter by decision">{FILTERS.map(x =>
      <button key={x} aria-pressed={f === x} onClick={() => { setF(x); setShown(PAGE_SIZE); }} className={cn('px-3 py-1.5 rounded text-xs font-semibold', f === x ? 'bg-action text-action-on' : 'text-muted hover:text-content')}>{x}</button>)}</div>
    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="card text-sm text-danger">Could not load investigations: {error}</p>}
    <div className="card !p-0 divide-y divide-line">
      {loading && <div className="p-4 space-y-3" aria-busy="true"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
      {!loading && !rows.length && <div className="p-4"><EmptyState icon={<ListChecks size={24} strokeWidth={1.5} />} title="No investigations match">Try another filter, or <Link className="text-action underline" to="/scanner">scan a site</Link>.</EmptyState></div>}
      {visible.map(i => <button key={i.id} aria-current={selected === i.id ? 'true' : undefined} onClick={() => nav(`/investigations/${i.id}`)}
        className={cn('w-full text-left p-4 flex justify-between items-center gap-3 hover:bg-surface-2', selected === i.id && 'bg-surface-2')}>
        <div className="min-w-0"><div className="font-mono text-sm font-semibold truncate">{i.domain}</div>
          <div className="text-xs text-muted truncate">{displayBrand(i.claimedBrand, i.domain)} → {i.payeeName ?? 'Not supplied'}</div>
          <time dateTime={i.createdAt} className="text-xs text-muted font-mono">{formatDateTime(i.createdAt)}</time></div>
        <VerdictBadge verdict={i.verdict} /></button>)}</div>
    {rows.length > visible.length && <button className="btn-secondary w-full" onClick={() => setShown(n => n + PAGE_SIZE)}>Load more ({rows.length - visible.length} more)</button>}
  </div>;

  return <div className="space-y-4"><h1 className="sr-only">Investigations</h1>
  <div className="grid gap-6 lg:grid-cols-[minmax(320px,400px)_1fr] items-start">
    {listPane}
    <div className={cn('min-w-0', !id && 'hidden lg:block')}>
      {id && <Link to="/investigations" className="lg:hidden inline-flex items-center gap-1 text-sm text-action mb-3"><Icon icon={ArrowLeft} size={16} />All investigations</Link>}
      {selected ? <Detail key={selected} id={selected} /> : <EmptyState icon={<ListChecks size={24} strokeWidth={1.5} />} title="Pick an investigation">Choose one from the list to see its decision and evidence.</EmptyState>}
    </div>
  </div></div>;
}
