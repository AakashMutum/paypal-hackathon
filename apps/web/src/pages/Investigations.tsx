import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, ListChecks, Search, RotateCcw } from 'lucide-react';
import { useInvestigations, useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { InvestigationView } from '../components/InvestigationView';
import { Icon, Skeleton, VerdictBadge } from '../components/ui';
import { cn, download } from '../lib/format';
import { displayBrand, formatDateTime, payeeDisplay, VERDICT_WORDS } from '../lib/labels';

const FILTERS = ['ALL', 'ALLOW', 'WARN', 'PAUSE'] as const;
export const PAGE_SIZE = 25;

function Detail({ id }: { id: string }) {
  const { inv, error, refresh } = useOrderPolling(id);
  if (error && !inv) return <InvestigationError error={error} onRetry={refresh} />;
  if (!inv) return <div className="space-y-3" aria-busy="true"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-40 w-full" /></div>;
  return <div className="space-y-4">
    <div className="card xl flex flex-wrap items-center justify-between gap-4 p-6">
      <div className="min-w-0"><h2 className="font-bold break-all font-mono text-base">{inv.domain}</h2>
        <p className="text-sm text-muted">{formatDateTime(inv.createdAt)}{inv.verdict ? ` · ${VERDICT_WORDS[inv.verdict].meaning}` : ''}</p></div>
      {inv.status === 'COMPLETE' && <VerdictBadge verdict={inv.verdict} />}</div>
    <InvestigationView inv={inv} />
  </div>;
}

function InvestigationError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const [busy, setBusy] = useState(false);
  const retry = async () => { setBusy(true); try { await onRetry(); } catch { /* handled by useOrderPolling */ } finally { setBusy(false); } };
  return (
    <div className="card xl text-center p-12 border-danger border">
      <div className="flex flex-col items-center gap-3">
        <RotateCcw className="h-16 w-16 text-danger animate-spin" aria-hidden="true" />
        <h3 className="font-semibold">Could not load this investigation</h3>
        <p className="text-sm text-muted">{error}</p>
        <button className="btn-primary" disabled={busy} onClick={retry}>
          {busy ? <span>Retry</span> : <span>Retry</span>}
        </button>
      </div>
    </div>
  );
}

export default function Investigations() {
  usePageTitle('Investigations');
  const { id } = useParams();
  const nav = useNavigate();
  const { list, loading, error } = useInvestigations(3000);
  const slow = useSlowLoading(loading);
  const [f, setF] = useState<typeof FILTERS[number]>('ALL');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const rows = useMemo(() => list.filter(i => (f === 'ALL' || i.verdict === f) && (i.domain + i.claimedBrand + (i.payeeName ?? '')).toLowerCase().includes(q.toLowerCase())), [list, f, q]);
  const visible = rows.slice(0, shown);
  const selected = id ?? (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1024px)').matches ? rows[0]?.id : undefined);

  return <div className="space-y-6"><h1 className="sr-only">Investigations</h1>
  <div className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_1fr] items-start">
    {/* List pane */}
    <div className={cn('space-y-4 min-w-0', id && 'hidden lg:block')}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">All investigations</h2>
        <button className="btn-secondary !h-9" onClick={() => download('trustora-investigations.json', rows)}><Icon icon={Download} size={16} className="mr-2" />Export</button>
      </div>
      <div className="relative"><Icon icon={Search} size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="input pl-9" placeholder="Search domain, brand or recipient" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE_SIZE); }} aria-label="Search investigations" />
      </div>
      <div className="inline-flex rounded-md border border-line-strong p-0.5 bg-surface" role="group" aria-label="Filter by decision">{FILTERS.map(x =>
        <button key={x} aria-pressed={f === x} onClick={() => { setF(x); setShown(PAGE_SIZE); }} className={cn('px-3 py-1.5 rounded text-xs font-semibold', f === x ? 'bg-action text-action-on' : 'text-muted hover:text-content')}>{x}</button>)}</div>
      <WakeNoteInline show={slow} />
      {error && !loading && <p role="alert" className="card text-sm text-danger border-danger border p-4">Could not load investigations: {error}</p>}
      <div className="card !p-0 divide-y divide-line">
        {loading && <div className="p-4 space-y-3" aria-busy="true"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>}
        {!loading && !rows.length && <div className="p-8 text-center"><ListChecks className="h-10 w-10 text-muted mb-3" aria-hidden="true" /><h3 className="font-semibold">No investigations match</h3><p className="text-sm text-muted">Try another filter, or scan a site.</p><Link className="mt-3 inline-flex items-center gap-1 text-sm text-action font-semibold" to="/scanner">Scan a site<Icon icon={ArrowRight} size={16} /></Link></div>}
        {visible.map(i => <button key={i.id} aria-current={selected === i.id ? 'true' : undefined} onClick={() => nav(`/engine/${i.id}`)}
          className={cn('w-full text-left p-4 flex justify-between items-center gap-3 hover:bg-surface-2', selected === i.id && 'bg-surface-2')}>
          <div className="min-w-0"><div className="font-mono text-sm font-semibold truncate">{i.domain}</div>
            <div className="text-xs text-muted truncate">{displayBrand(i.claimedBrand, i.domain)} → {payeeDisplay(i.payeeName)}</div>
            <time dateTime={i.createdAt} className="text-xs text-muted font-mono">{formatDateTime(i.createdAt)}</time></div>
          <VerdictBadge verdict={i.verdict} /></button>)}</div>
      {rows.length > visible.length && <button className="btn-secondary w-full mt-3" onClick={() => setShown(n => n + PAGE_SIZE)}>Load more ({rows.length - visible.length} more)</button>}
    </div>

    {/* Detail pane */}
    <div className={cn('min-w-0', !id && 'hidden lg:block')}>
      {id && <Link to="/investigations" className="lg:hidden inline-flex items-center gap-1 text-sm text-action mb-4"><Icon icon={ArrowLeft} size={16} />All investigations</Link>}
      {selected ? <Detail key={selected} id={selected} /> : <EmptyInvestigations />}
    </div>
  </div></div>;
}

function WakeNoteInline({ show }: { show: boolean }) {
  return show ? <div className="card text-sm text-muted p-4" role="status">The server may be waking up after being asleep. Please wait a moment.</div> : null;
}

function EmptyInvestigations() {
  return <div className="card xl flex flex-col items-center justify-center p-12 text-center" role="status">
    <ListChecks className="h-12 w-12 text-muted mb-3" aria-hidden="true" />
    <h3 className="font-semibold">No investigations yet</h3>
    <p className="text-sm text-muted">Choose one from the list to see its decision and evidence. Run a scan or check out from a demo store to create one.</p>
    <Link className="mt-4 inline-flex items-center gap-1 text-sm text-action font-semibold" to="/scanner">Scan a site<Icon icon={ArrowRight} size={16} /></Link>
  </div>;
}
