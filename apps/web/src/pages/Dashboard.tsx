import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, ListChecks, ScanLine } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { Icon, Skeleton, Stat, VerdictBadge, Badge, WakeNote } from '../components/ui';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { cn, money, telemetry } from '../lib/format';
import { dashboardMetrics } from '../lib/metrics';
import { radarMessage } from '../lib/explain';
import { displayBrand, formatDateTime, payeeDisplay, scoreText, VERDICT_WORDS } from '../lib/labels';
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

  return <div className="space-y-8">
    {/* Hero */}
    <section className="relative isolate overflow-hidden rounded-2xl bg-navy p-8 md:p-12 text-white shadow-2">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width=%2260%22 height=%2260%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ccircle cx=%2230%22 cy=%2230%22 r=%222%22 fill=%22%234c9aff%22 fill-opacity=%220.15%22/%3E%3C/svg%3E')] opacity-30" />
      <div className="relative z-10 max-w-3xl">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-white/20 bg-white/10 text-xs font-medium text-white/90 mb-4">Trustworthy checkout scanning</span>
        <h1 className="text-3xl font-bold tracking-tight leading-tight mb-4">Who would this checkout really pay?</h1>
        <p className="text-white/80 text-base lg:text-xl mb-8 max-w-xl leading-relaxed">
          TrustOra verifies who is behind a checkout, compares storefront claims with public records,
          and helps identify suspicious receiving accounts before money is captured.
        </p>
        <div className="flex flex-wrap gap-3">
          <button className="btn-xl bg-action hover:bg-action-hover" onClick={() => nav('/scanner')}>
            <Icon icon={ScanLine} size={16} className="shrink-0" /> Check a store</button>
          <Link to="/stores" className="btn-xl border border-white/30 hover:bg-white/10">Explore demo cases</Link>
        </div>
      </div>
    </section>

    {/* Wake note + error */}
    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="card text-sm text-danger border-danger border">Could not load investigations: {error}</p>}

    {/* Metrics */}
    <section aria-label="Totals" className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Stat label="Websites checked" value={metrics.websitesChecked} hint="Completed investigations" loading={loading} />
      <Stat label="Cleared" value={metrics.allowed} hint="ALLOW · Cleared" loading={loading} />
      <Stat label="Needs review" value={warnCount} hint="WARN · Needs review" loading={loading} />
      <Stat label="Held" value={metrics.prevented} hint={metrics.defendedAmount > 0 ? `PAUSE · ${money(metrics.defendedAmount)} flagged and not captured` : 'PAUSE · Never captured'} loading={loading} />
    </section>

    {/* Latest flagged investigation */}
    <section className="space-y-3" aria-label="Latest flagged investigation">
      <h2 className="font-semibold">Latest flagged investigation</h2>
      {loading ? <Skeleton className="h-48 w-full" /> : latest ? <>
        <div className="rounded-xl bg-surface-2 border border-line p-4"><p className="text-sm text-muted">{radarMessage(latest)}</p>
          <ClaimedVsActual inv={latest} />
          <div className="flex flex-wrap items-center gap-3 mt-4 text-sm"><VerdictBadge verdict={latest.verdict} /><span className="text-muted">{scoreText(latest.verdict, latest.riskScore)}</span>
            <Link className="text-action font-semibold underline" to={`/investigations/${latest.id}`}>Open this investigation</Link></div></div>
      </> : <EmptyStateWithIcon />}
    </section>

    {/* Two column layout: recent investigations + demo stores */}
    <div className="grid gap-6 lg:grid-cols-[1fr_360px] items-start">
      <div className="space-y-6 min-w-0">
        <section className="space-y-3" aria-label="Recent investigations">
          <div className="flex items-baseline justify-between"><h2 className="font-semibold">Recent investigations</h2><Link to="/investigations" className="text-action text-sm font-semibold">View all ({list.length})</Link></div>
          {loading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
            : list.length === 0 ? <EmptyStateWithIcon />
              : <ul className="card !p-0 divide-y divide-line">{list.slice(0, 5).map(i => <li key={i.id}>
                <Link to={`/investigations/${i.id}`} className="p-4 flex justify-between items-center gap-3 hover:bg-surface-2">
                  <div className="min-w-0"><div className="font-mono text-sm font-semibold truncate">{i.domain}</div>
                    <div className="text-xs text-muted truncate">{displayBrand(i.claimedBrand, i.domain)} → {payeeDisplay(i.payeeName)} · {formatDateTime(i.createdAt)}</div></div>
                  <VerdictBadge verdict={i.verdict} /></Link></li>)}</ul>}
        </section>
      </div>

      <aside className="space-y-6 min-w-0">
        <section className="card xl p-5 space-y-4" aria-label="Try the demo in 3 steps">
          <div className="flex items-baseline gap-2"><h2 className="font-semibold">Try the demo</h2><span className="mono-label bg-tint px-2 py-1 rounded">3 fictional stores</span></div>
          <ol className="space-y-3 text-sm">{STORES.map((s, n) => <li key={s.id} className="flex gap-3">
            <span className="font-mono text-xs text-muted pt-0.5 w-4">{n + 1}.</span>
            <div className="min-w-0 space-y-1"><Link className="text-action font-semibold underline" to={`/store/${s.id}`}>{s.name}</Link>
              <div><Badge tone={VERDICT_WORDS[s.expected].tone}>Expect {s.expected} · {VERDICT_WORDS[s.expected].subtitle}</Badge></div></div></li>)}</ol>
          <p className="text-xs text-muted">Open a store, add the item and check out. The stores are fictional.</p>
        </section>

        <section className="card xl p-5 space-y-4" aria-label="Recent activity">
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

function EmptyStateWithIcon() {
  return <div className="card flex flex-col items-center justify-center p-12 text-center" role="status">
    <ListChecks className="h-12 w-12 text-muted mb-3" aria-hidden="true" />
    <h3 className="font-semibold">Nothing flagged yet</h3>
    <p className="text-sm text-muted">Scan a website or buy from a demo store. Anything that needs review or is held shows up here.</p>
    <Link to="/scanner" className="mt-4 inline-flex items-center gap-1 text-sm text-action font-semibold">Scan a site<Icon icon={ArrowRight} size={16} /></Link>
  </div>;
}
