import { Link, useNavigate } from 'react-router-dom';
import { Globe, BadgeCheck, Flag, ShieldAlert, ScanLine, FileSearch, Zap, Building2, Mail, Activity, ShieldCheck, Radar } from 'lucide-react';
import { useInvestigations } from '../hooks/useOrderPolling';
import { useApp } from '../context/OrderStateContext';
import { Pill, RiskBadge, Switch } from '../components/ui';
import { cn, money, telemetry } from '../lib/format';

export default function Dashboard() {
  const { list } = useInvestigations(3000);
  const { protection, setProtection, toast } = useApp();
  const nav = useNavigate();
  const done = list.filter(i => i.status === 'COMPLETE');
  const flagged = done.filter(i => i.verdict !== 'ALLOW');
  const stats = [
    { l: 'Websites Checked', v: 139 + list.length, icon: Globe, sub: <span className="text-electric font-mono text-xs">↗ +12% this week</span> },
    { l: 'Verified Entities', v: 97 + done.filter(i => i.verdict === 'ALLOW').length, icon: BadgeCheck, sub: <span className="text-muted text-xs">Trusted PayPal tier</span> },
    { l: 'Suspicious Sites', v: 16 + flagged.length, icon: Flag, sub: <Pill tone="info">Flagged</Pill> },
    { l: 'Prevented Threats', v: 4 + done.filter(i => i.verdict === 'BLOCK').length, icon: ShieldAlert, sub: <span className="mono-label !text-bad">Capture paused</span> },
  ];
  const defended = 4620.45 + flagged.filter(i => i.captureState !== 'CAPTURED').reduce((s, i) => s + i.price, 0);
  const radar = flagged[0];
  const [whole, cents] = defended.toFixed(2).split('.');
  return <>
    <section>
      <p className="mono-label !text-electric">Active session • ID #8849-DF</p>
      <h1 className="text-3xl font-bold mt-1">Welcome, Alex</h1>
      <p className="text-muted text-sm mt-1">TrustOra protection {protection ? 'enabled' : 'paused'} across 18 connected checkouts</p>
    </section>

    <section className="rounded-xl bg-navy text-white p-5 shadow-l2">
      <div className="flex justify-between items-start">
        <Pill tone="cyan" pulse className="!bg-white/5">SENTINEL PROTECTION: {protection ? 'OPTIMAL' : 'PAUSED'}</Pill>
        <span className="pill border-white/20 text-white/80">LIVE HUD</span></div>
      <p className="text-sm text-white/60 mt-4">Estimated Capital Defended</p>
      <div className="flex items-end justify-between gap-3 mt-1">
        <div className="text-4xl font-bold font-mono">${Number(whole).toLocaleString()}<span className="text-lg text-white/60">.{cents} saved</span></div>
        <span className="pill border-white/15 text-white/80 !h-9 px-3"><ShieldCheck size={14} />18 Nodes Active</span></div>
      <div className="mt-5 rounded-lg bg-white/5 p-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><Zap size={18} className="text-accent" /><div><div className="text-sm font-semibold">Pre-Payment Intervention</div><div className="text-xs text-white/60">Real-time checkout interceptor</div></div></div>
        <Switch on={protection} label="Pre-payment intervention" onChange={b => { setProtection(b); toast(b ? 'Interceptor enabled' : 'Interceptor paused — checkouts will not be screened', b ? 'ok' : 'bad'); }} /></div>
    </section>

    <section className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1">
      <button className="btn-direct shrink-0" onClick={() => nav('/scanner')}><ScanLine size={16} />Scan URL</button>
      <button className="btn-secondary shrink-0" onClick={() => nav('/onboarding')}><BadgeCheck size={16} />Verify Merchant</button>
      <button className="btn-secondary shrink-0" onClick={() => nav('/engine')}><FileSearch size={16} />Inspect</button>
    </section>

    <section className="grid grid-cols-2 md:grid-cols-4 gap-3">{stats.map(s => <div key={s.l} className="card !p-4">
      <div className="flex justify-between"><span className="mono-label">{s.l}</span><s.icon size={16} className="text-muted" /></div>
      <div className="text-3xl font-semibold font-mono my-1">{s.v}</div>{s.sub}</div>)}</section>

    <section className="card">
      <div className="flex items-center justify-between"><h2 className="font-semibold flex items-center gap-2"><Radar size={18} className="text-electric" />Live Consistency Radar</h2>
        {radar && <Pill tone={radar.verdict === 'BLOCK' ? 'bad' : 'warn'}>{radar.verdict === 'BLOCK' ? 'INTERCEPTED' : 'FLAGGED'}</Pill>}</div>
      {radar ? <>
        <p className="text-sm text-muted my-2">Active session consistency mismatch detected during payment authorization handoff.</p>
        <div className="rounded-lg bg-tint p-3 space-y-2">
          <div className="bg-white rounded p-3 flex justify-between items-center"><div><div className="mono-label">Browsed domain</div><div className="font-mono text-sm font-semibold break-all">{radar.domain}</div></div><span className="pill border-ink/10 font-mono">Port 443</span></div>
          <div className="text-center"><Pill tone="bad">ENTITY MISMATCH {Math.round(radar.riskScore)}%</Pill></div>
          <div className="bg-white rounded p-3 flex justify-between items-center"><div><div className="mono-label">Claimed storefront</div><div className="font-mono text-sm font-semibold">{radar.claimedBrand}</div></div><Pill tone="bad">SPOOFED</Pill></div>
          <div className="bg-bad-bg rounded p-3 flex justify-between items-center"><div><div className="mono-label !text-bad-deep">Actual recipient account</div><div className="font-mono text-sm font-semibold text-bad-deep">{radar.payeeName}</div></div><span className="text-xs font-mono text-bad-deep">Unlinked</span></div>
        </div>
        <div className="flex justify-between text-xs mt-3 text-muted"><span>Captured token frozen via Sentinel API</span><Link className="text-electric font-semibold" to={`/engine/${radar.id}`}>Audit Trail</Link></div>
      </> : <p className="text-sm text-muted mt-2">No mismatches right now. Run a scan to see the radar in action.</p>}
    </section>

    <section>
      <div className="flex justify-between items-baseline mb-2"><h2 className="font-semibold text-lg">Recent Assessments</h2><Link to="/history" className="text-electric text-sm font-semibold">View All ({list.length})</Link></div>
      <div className="space-y-3">{list.slice(0, 3).map(i => <button key={i.id} onClick={() => nav(`/engine/${i.id}`)} className="card !p-4 w-full text-left hover:shadow-l2 hover:border-electric/20 transition">
        <div className="flex justify-between items-start gap-2"><div><div className="font-mono font-semibold text-sm break-all">{i.domain}</div><div className="text-xs text-muted">Claimed: {i.claimedBrand}</div></div><RiskBadge verdict={i.verdict} /></div>
        <div className="mt-3 rounded bg-tint p-2 flex justify-between items-center text-xs font-mono">
          <span className="flex items-center gap-2 min-w-0">{i.payeeName.includes('@') ? <Mail size={14} /> : <Building2 size={14} />}<span className="truncate">{i.payeeName}</span></span>
          <span className={cn('font-semibold', i.verdict === 'BLOCK' ? 'text-bad' : i.verdict === 'ALLOW' ? 'text-electric' : 'text-warn')}>{i.verdict === 'BLOCK' ? 'CAPTURE PAUSED' : i.verdict === 'ALLOW' ? 'ALLOWED' : i.verdict === 'WARN' ? `${i.riskScore}% Anomaly` : '…'}</span></div></button>)}</div>
    </section>

    <section className="card">
      <div className="flex justify-between"><h2 className="font-semibold flex items-center gap-2"><Activity size={18} className="text-electric" />Sentinel Telemetry Log</h2><span className="mono-label !text-electric">Live Synced</span></div>
      <ul className="mt-3 space-y-4">{telemetry(list).map(t => <li key={t.id} className="flex gap-3"><span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', t.tone === 'bad' ? 'bg-bad' : t.tone === 'warn' ? 'bg-warn' : t.tone === 'info' ? 'bg-electric' : 'bg-muted')} />
        <div><div className="flex justify-between gap-4 text-sm font-semibold"><span>{t.title}</span><span className="font-mono text-xs text-muted">{t.time}</span></div><p className="text-sm text-muted">{t.text}</p></div></li>)}</ul>
    </section>
  </>;
}
