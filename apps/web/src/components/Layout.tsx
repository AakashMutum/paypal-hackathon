import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Bell, LayoutDashboard, ScanLine, Radar, ShieldCheck, History, User, Store, Gauge, BadgeCheck, RotateCcw } from 'lucide-react';
import { cn, telemetry } from '../lib/format';
import { Modal } from './ui';
import { ModeBadge, ModesFooter } from './Provenance';
import { useInvestigations } from '../hooks/useOrderPolling';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import trustoraLogo from '../assets/trustora-logo.png';
const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }, { to: '/scanner', label: 'Scanner', icon: ScanLine },
  { to: '/engine', label: 'Engine', icon: Radar }, { to: '/pay', label: 'Pay', icon: ShieldCheck }, { to: '/history', label: 'History', icon: History },
];
function Notifications({ onClose }: { onClose: () => void }) {
  const { list } = useInvestigations();
  return <Modal open onClose={onClose} title="Notifications"><ul className="space-y-3">{telemetry(list).map(t => <li key={t.id} className="flex gap-3 text-sm">
    <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', t.tone === 'bad' ? 'bg-bad' : t.tone === 'warn' ? 'bg-warn' : t.tone === 'info' ? 'bg-electric' : 'bg-muted')} />
    <div><div className="font-semibold">{t.title} <span className="font-mono text-xs text-muted">{t.time}</span></div><div className="text-muted">{t.text}</div></div></li>)}</ul></Modal>;
}
function Account({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const row = 'flex items-center gap-3 p-3 rounded-lg hover:bg-canvas text-sm font-medium';
  return <Modal open onClose={onClose} title="Alex Walker">
    <p className="text-sm text-muted mb-3 font-mono">alex.walker@mail.example</p>
    <Link to="/profile" onClick={onClose} className={row}><User size={18} />My Profile</Link>
    <Link to="/stores" onClick={onClose} className={row}><Store size={18} />Demo storefronts</Link>
    <Link to="/analyst" onClick={onClose} className={row}><Gauge size={18} />Analyst console</Link>
    <Link to="/onboarding" onClick={onClose} className={row}><BadgeCheck size={18} />Merchant onboarding</Link>
    <button className={cn(row, 'w-full text-left')} onClick={async () => { await api.resetDemo(); toast('Demo data reset', 'ok'); onClose(); }}><RotateCcw size={18} />Reset demo data</button>
  </Modal>;
}
export default function Layout() {
  const [panel, setPanel] = useState<'bell' | 'user' | null>(null);
  const tab = (a: boolean) => cn('flex flex-col items-center gap-1 px-3 py-2 rounded-xl text-[11px] font-medium min-w-[64px]', a ? 'bg-navy text-white' : 'text-muted hover:text-ink');
  return <div className="min-h-screen pb-28 md:pb-10">
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-ink/10">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
        <Link to="/" className="flex items-center gap-2 min-w-0">
          <img src={trustoraLogo} alt="TrustOra" className="h-9 w-auto object-contain" />
          <span className="leading-tight hidden sm:block">
            <span className="block font-mono text-[10px] font-semibold tracking-wider text-electric">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-electric mr-1 animate-pulse" />ACTIVE SESSION
            </span>
          </span>
        </Link>
        <span className="hidden sm:block"><ModeBadge /></span>
        <nav className="hidden md:flex gap-1 ml-auto mr-2">{NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('px-3 py-1.5 rounded text-sm font-medium', isActive ? 'bg-navy text-white' : 'text-muted hover:text-ink')}>{n.label}</NavLink>)}</nav>
        <div className="flex items-center gap-2 ml-auto md:ml-0">
          <button aria-label="Notifications" onClick={() => setPanel('bell')} className="p-2 rounded hover:bg-canvas"><Bell size={20} /></button>
          <button aria-label="Account" onClick={() => setPanel('user')} className="w-9 h-9 rounded-full bg-navy text-white grid place-items-center"><User size={18} /></button></div>
      </div></header>
    <main className="max-w-3xl mx-auto px-4 py-4 space-y-4"><Outlet /><div className="sm:hidden"><ModeBadge /></div></main>
    <footer className="max-w-3xl mx-auto px-4 pb-24 md:pb-6"><ModesFooter /></footer>
    <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-ink/10 px-2 pb-3 pt-2 flex justify-around" aria-label="Primary">
      {NAV.map(n => <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => tab(isActive)}><n.icon size={20} />{n.label}</NavLink>)}</nav>
    {panel === 'bell' && <Notifications onClose={() => setPanel(null)} />}
    {panel === 'user' && <Account onClose={() => setPanel(null)} />}
  </div>;
}
