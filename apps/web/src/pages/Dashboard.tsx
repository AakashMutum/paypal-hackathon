import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, ListChecks, ScanLine } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { Badge, EmptyState, Icon, Skeleton, Stat, VerdictBadge, WakeNote } from '../components/ui';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { cn, money, telemetry } from '../lib/format';
import { dashboardMetrics } from '../lib/metrics';
import { radarMessage } from '../lib/explain';
import { displayBrand, formatDateTime, scoreText, VERDICT_WORDS } from '../lib/labels';
import { STORES } from '../data/stores';

export default function Dashboard() {
  usePageTitle('Overview');
  const { list, loading, error } = useInvestigations(3000);
  const slow = useSlowLoading(loading);
  const nav = useNavigate();
  const metrics = dashboardMetrics(list);
  const done = list.filter(i => i.status === 'COMPLETE');
  const flagged = done.filter(i => i.verdict === 'WARN' || i.verdict === 'PAUSE');
  const latest = flagged[0];
  const warnCount = done.filter(i => i.verdict === 'WARN').length;
  const activity = telemetry(list);
  return <div className="space-y-6">
    <section className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted mt-1">TrustOra checks who a checkout would really pay before the money is captured.</p></div>
      <button className="btn-primary" onClick={() => nav('/scanner')}><Icon icon={ScanLine} size={16} />Scan a website</button>
    </section>

    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="card text-sm text-danger">Could not load investigations: {error}</p>}

    <section aria-label="Totals" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Websites checked" value={metrics.websitesChecked} hint="Completed investigations" loading={loading} />
      <Stat label="Cleared" value={metrics.allowed} hint="ALLOW · Cleared" loading={loading} />
      <Stat label="Needs review" value={warnCount} hint="WARN · Needs review" loading={loading} />
      <Stat label="Held" value={metrics.prevented} hint={metrics.defendedAmount > 0 ? `PAUSE · ${money(metrics.defendedAmount)} flagged and not captured` : 'PAUSE · Never captured'} loading={loading} />
    </section>

    <div className="grid gap-6 lg:grid-cols-[1fr_380px] items-start">
      <div className="space-y-6 min-w-0">
        <section className="space-y-3" aria-label="Latest flagged investigation">
          <h2 className="font-semibold">Latest flagged investigation</h2>
          {loading ? <Skeleton className="h-40 w-full" /> : latest ? <>
            <p className="text-sm text-muted">{radarMessage(latest)}</p>
            <ClaimedVsActual inv={latest} />
            <div className="flex flex-wrap items-center gap-3 text-sm"><VerdictBadge verdict={latest.verdict} /><span className="text-muted">{scoreText(latest.verdict, latest.riskScore)}</span>
              <Link className="text-action font-semibold underline" to={`/investigations/${latest.id}`}>Open this investigation</Link></div>
          </> : <EmptyState icon={<ListChecks size={24} strokeWidth={1.5} />} title="Nothing flagged yet">Scan a website or buy from a demo store. Anything that needs review or is held shows up here.</EmptyState>}
        </section>

        <section className="space-y-3" aria-label="Recent investigations">
          <div className="flex items-baseline justify-between"><h2 className="font-semibold">Recent investigations</h2><Link to="/investigations" className="text-action text-sm font-semibold">View all ({list.length})</Link></div>
          {loading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
            : list.length === 0 ? <EmptyState icon={<ListChecks size={24} strokeWidth={1.5} />} title="No investigations yet">Run a scan or check out from a demo store to create one.</EmptyState>
              : <ul className="card !p-0 divide-y divide-line">{list.slice(0, 5).map(i => <li key={i.id}>
                <Link to={`/investigations/${i.id}`} className="p-4 flex justify-between items-center gap-3 hover:bg-surface-2">
                  <div className="min-w-0"><div className="font-mono text-sm font-semibold truncate">{i.domain}</div>
                    <div className="text-xs text-muted truncate">{displayBrand(i.claimedBrand, i.domain)} → {i.payeeName ?? 'Payee not supplied'} · {formatDateTime(i.createdAt)}</div></div>
                  <VerdictBadge verdict={i.verdict} /></Link></li>)}</ul>}
        </section>
      </div>

      <aside className="space-y-6 min-w-0">
        <section className="card space-y-3" aria-label="Try the demo in 3 steps">
          <h2 className="font-semibold">Try the demo in 3 steps</h2>
          <ol className="space-y-3 text-sm">{STORES.map((s, n) => <li key={s.id} className="flex gap-3">
            <span className="font-mono text-xs text-muted pt-0.5 w-4">{n + 1}.</span>
            <div className="min-w-0 space-y-1"><Link className="text-action font-semibold underline" to={`/store/${s.id}`}>{s.name}</Link>
              <div><Badge tone={VERDICT_WORDS[s.expected].tone}>Expect {s.expected} · {VERDICT_WORDS[s.expected].subtitle}</Badge></div></div></li>)}</ol>
          <p className="text-xs text-muted">Open a store, add the item and check out. The stores are fictional.</p>
        </section>

        <section className="card space-y-3" aria-label="Recent activity">
          <h2 className="font-semibold flex items-center gap-2"><Icon icon={Activity} size={20} />Recent activity</h2>
          {loading ? <Skeleton className="h-16 w-full" /> : activity.length === 0
            ? <p className="text-sm text-muted">No completed investigations yet.</p>
            : <ul className="space-y-4">{activity.map(t => <li key={t.id} className="flex gap-3">
              <span aria-hidden="true" className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', t.tone === 'bad' ? 'bg-danger' : t.tone === 'warn' ? 'bg-warning' : 'bg-action')} />
              <div><div className="flex justify-between gap-4 text-sm font-semibold"><span>{t.title}</span><span className="font-mono text-xs text-muted">{t.time}</span></div><p className="text-sm text-muted">{t.text}</p></div></li>)}</ul>}
          <Link to="/investigations" className="inline-flex items-center gap-1 text-sm text-action font-semibold">All investigations<Icon icon={ArrowRight} size={16} /></Link>
        </section>
      </aside>
    </div>
  </div>;
}
