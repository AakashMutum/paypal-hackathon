import { Link, useNavigate } from 'react-router-dom';
import { Globe, BadgeCheck, Flag, ShieldAlert, ScanLine, FileSearch, Zap, Building2, Mail, Activity, ShieldCheck, Radar } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { useApp } from '../context/OrderStateContext';
import { Pill, RiskBadge, Skeleton, Switch, WakeNote } from '../components/ui';
import { cn, telemetry } from '../lib/format';
import { dashboardMetrics } from '../lib/metrics';
import { radarMessage } from '../lib/explain';
import { displayBrand, scoreText } from '../lib/labels';
import { STORES } from '../data/stores';
import { VERDICT_WORDS } from '../lib/labels';

export default function Dashboard() {
  usePageTitle('Overview');
  const { list, loading, error } = useInvestigations(3000);
  const slow = useSlowLoading(loading);
  const { protection, setProtection, toast } = useApp();
  const nav = useNavigate();
  const metrics = dashboardMetrics(list);
  const flagged = list.filter(i => i.status === 'COMPLETE' && (i.verdict === 'WARN' || i.verdict === 'PAUSE'));
  const stats = [
    { l: 'Websites checked', v: metrics.websitesChecked, icon: Globe, sub: <span className="text-muted text-xs">All completed checks</span> },
    { l: 'Cleared', v: metrics.allowed, icon: BadgeCheck, sub: <span className="text-muted text-xs">ALLOW decisions</span> },
    { l: 'Flagged', v: metrics.suspicious, icon: Flag, sub: <span className="text-muted text-xs">WARN or PAUSE</span> },
    { l: 'Held', v: metrics.prevented, icon: ShieldAlert, sub: <span className="text-muted text-xs">PAUSE: never captured</span> },
  ];
  const defended = metrics.defendedAmount;
  const radar = flagged[0];
  const [whole, cents] = defended.toFixed(2).split('.');
  return <>
    <section>
      <p className="mono-label !text-electric">Overview</p>
      <h1 className="text-3xl font-bold mt-1">Protection overview</h1>
      <p className="text-muted text-sm mt-1">TrustOra protection {protection ? 'enabled' : 'paused'} (demo switch; the API screens every order)</p>
    </section>

    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="card text-sm text-bad">Could not load investigations: {error}</p>}

    <section className="card space-y-3" aria-label="Try the demo in 3 steps">
      <h2 className="font-semibold">Try the demo in 3 steps</h2>
      <ol className="space-y-2 text-sm">{STORES.map((s, n) => <li key={s.id} className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted w-4">{n + 1}.</span>
        <Link className="text-electric font-semibold underline" to={`/store/${s.id}`}>{s.name}</Link>
        <span className="text-muted">→ expect</span><Pill tone={VERDICT_WORDS[s.expected].tone}>{s.expected} · {VERDICT_WORDS[s.expected].subtitle}</Pill></li>)}</ol>
      <p className="text-xs text-muted">Open each store, add the item and check out. These are fictional stores.</p>
    </section>

    <section className="rounded-xl bg-navy text-white p-5 shadow-l2">
      <div className="flex justify-between items-start">
        <Pill tone="cyan" pulse className="!bg-white/5">Guardian {protection ? 'on' : 'off'}</Pill></div>
      <p className="text-sm text-white/60 mt-4">Amount held or paused</p>
      <div className="flex items-end justify-between gap-3 mt-1">
        {loading ? <Skeleton className="h-10 w-40 !bg-white/20" /> : <div className="text-4xl font-bold font-mono">${Number(whole).toLocaleString()}<span className="text-lg text-white/60">.{cents}</span></div>}
        <span className="pill border-white/15 text-white/80 !h-9 px-3"><ShieldCheck size={14} aria-hidden="true" />{loading ? 'Loading' : metrics.websitesChecked === 0 ? 'No investigations yet' : 'From recorded investigations'}</span></div>
      <div className="mt-5 rounded-lg bg-white/5 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Zap size={18} className="text-accent" aria-hidden="true" /><div><div className="text-sm font-semibold">Pre-payment check</div><div className="text-xs text-white/60">Investigates before capture</div></div></div>
        <Switch on={protection} label="Pre-payment check" onChange={b => { setProtection(b); toast(b ? 'Switch on' : 'Switch off. This only changes this screen: the API still screens every order', b ? 'ok' : 'bad'); }} /></div>
    </section>

    <section className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
      <button className="btn-direct shrink-0" onClick={() => nav('/scanner')}><ScanLine size={16} aria-hidden="true" />Scan URL</button>
      <button className="btn-secondary shrink-0" onClick={() => nav('/onboarding')}><BadgeCheck size={16} aria-hidden="true" />Register merchant</button>
      <button className="btn-secondary shrink-0" onClick={() => nav('/engine')}><FileSearch size={16} aria-hidden="true" />Latest check</button>
    </section>

    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">{stats.map(s => <div key={s.l} className="card !p-4">
      <div className="flex justify-between"><span className="mono-label">{s.l}</span><s.icon size={16} className="text-muted" aria-hidden="true" /></div>
      {loading ? <Skeleton className="h-8 w-12 my-2" /> : <div className="text-3xl font-semibold font-mono my-1">{s.v}</div>}{s.sub}</div>)}</section>

    <section className="card">
      <div className="flex items-center justify-between"><h2 className="font-semibold flex items-center gap-2"><Radar size={18} className="text-electric" aria-hidden="true" />Latest flagged check</h2>
        {radar && <Pill tone={radar.verdict === 'PAUSE' ? 'bad' : 'warn'}>{radar.verdict === 'PAUSE' ? 'Held' : 'Needs review'}</Pill>}</div>
      {loading ? <Skeleton className="h-24 w-full mt-3" /> : radar ? <>
        <p className="text-sm text-muted my-2">{radarMessage(radar)}</p>
        <div className="rounded-lg bg-tint p-3 space-y-2">
          <div className="bg-white rounded p-3 flex justify-between items-center"><div><div className="mono-label">Domain</div><div className="font-mono text-sm font-semibold break-all">{radar.domain}</div></div></div>
          <div className="text-center"><Pill tone={radar.verdict === 'PAUSE' ? 'bad' : 'warn'}>{scoreText(radar.verdict, radar.riskScore)}</Pill></div>
          <div className="bg-white rounded p-3"><div className="mono-label">Storefront says</div><div className="font-mono text-sm font-semibold break-words">{displayBrand(radar.claimedBrand, radar.domain)}</div></div>
          <div className={cn('rounded p-3', radar.payeeMismatch ? 'bg-bad-bg' : 'bg-white')}><div className={cn('mono-label', radar.payeeMismatch && '!text-bad-deep')}>PayPal pays</div><div className={cn('font-mono text-sm font-semibold', radar.payeeMismatch && 'text-bad-deep')}>{radar.payeeName ?? 'Not supplied'}</div></div>
        </div>
        <div className="flex justify-between text-xs mt-3 text-muted"><span>Funds are not captured without an ALLOW or an acknowledged warning</span><Link className="text-electric font-semibold" to={`/engine/${radar.id}`}>Open check</Link></div>
      </> : <p className="text-sm text-muted mt-2">Nothing has been flagged. Run a scan to see how a check looks.</p>}
    </section>

    <section>
      <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold text-lg">Recent investigations</h2><Link to="/history" className="text-electric text-sm font-semibold">View all ({list.length})</Link></div>
      {loading
        ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>
        : list.length === 0
          ? <p className="card !p-4 text-sm text-muted">No investigations yet. Run a scan or check out from a demo storefront to create one.</p>
          : <div className="space-y-3">{list.slice(0, 3).map(i => <button key={i.id} onClick={() => nav(`/engine/${i.id}`)} className="card !p-4 w-full text-left hover:shadow-l2 hover:border-electric/20 transition">
            <div className="flex justify-between items-start gap-2"><div><div className="font-mono font-semibold text-sm break-all">{i.domain}</div><div className="text-xs text-muted">Storefront says: {displayBrand(i.claimedBrand, i.domain)}</div></div><RiskBadge verdict={i.verdict} /></div>
            <div className="mt-3 rounded bg-tint p-2 flex justify-between items-center text-xs font-mono">
              <span className="flex items-center gap-2 min-w-0">{(i.payeeName ?? '').includes('@') ? <Mail size={14} aria-hidden="true" /> : <Building2 size={14} aria-hidden="true" />}<span className="truncate">{i.payeeName ?? 'Payee not supplied'}</span></span>
              <span className="font-semibold text-muted">{scoreText(i.verdict, i.riskScore)}</span></div></button>)}</div>}
    </section>

    <section className="card">
      <div className="flex justify-between"><h2 className="font-semibold flex items-center gap-2"><Activity size={18} className="text-electric" aria-hidden="true" />Recent activity</h2></div>
      {loading ? <Skeleton className="h-16 w-full mt-3" /> : telemetry(list).length === 0
        ? <p className="text-sm text-muted mt-2">No completed investigations yet.</p>
        : <ul className="mt-3 space-y-4">{telemetry(list).map(t => <li key={t.id} className="flex gap-3"><span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', t.tone === 'bad' ? 'bg-bad' : t.tone === 'warn' ? 'bg-warn' : t.tone === 'info' ? 'bg-electric' : 'bg-muted')} />
          <div><div className="flex justify-between gap-4 text-sm font-semibold"><span>{t.title}</span><span className="font-mono text-xs text-muted">{t.time}</span></div><p className="text-sm text-muted">{t.text}</p></div></li>)}</ul>}
    </section>
  </>;
}
