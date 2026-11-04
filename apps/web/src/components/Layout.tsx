import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, Gauge, LayoutDashboard, ScanLine, ListChecks, Store, User, BadgeCheck, RotateCcw } from 'lucide-react';
import { cn, telemetry } from '../lib/format';
import { Icon, Modal } from './ui';
import { ModeBadge } from './Provenance';
import { SiteFooter } from './HowChecked';
import { ThemeToggle } from './ThemeToggle';
import { useInvestigations } from '../hooks/useOrderPolling';
import { SHOW_RESET } from '../lib/env';
import { ResetDialog } from './ResetDialog';
import { useApp } from '../context/OrderStateContext';
import trustoraLogo from '../assets/trustora-logo.png';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, match: (p: string) => p === '/' },
  { to: '/scanner', label: 'Scan', icon: ScanLine, match: (p: string) => p.startsWith('/scanner') },
  { to: '/investigations', label: 'Investigations', icon: ListChecks, match: (p: string) => /^\/(investigations|engine|pay|history)/.test(p) },
  { to: '/stores', label: 'Demo stores', icon: Store, match: (p: string) => /^\/(stores|checkout)/.test(p) },
  { to: '/analyst', label: 'Analyst', icon: Gauge, match: (p: string) => p.startsWith('/analyst') },
];

function Notifications({ onClose }: { onClose: () => void }) {
  const { list } = useInvestigations();
  const items = telemetry(list);
  return <Modal open onClose={onClose} title="Notifications">
    {items.length === 0 ? <p className="text-sm text-muted">Nothing yet. Completed investigations appear here.</p>
      : <ul className="space-y-3">{items.map(t => <li key={t.id} className="flex gap-3 text-sm">
        <span aria-hidden="true" className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', t.tone === 'bad' ? 'bg-danger' : t.tone === 'warn' ? 'bg-warning' : 'bg-action')} />
        <div><div className="font-semibold">{t.title} <span className="font-mono text-xs text-muted">{t.time}</span></div><div className="text-muted">{t.text}</div></div></li>)}</ul>}
  </Modal>;
}

function Account({ onClose }: { onClose: () => void }) {
  const { toast } = useApp();
  const [resetting, setResetting] = useState(false);
  const row = 'flex items-center gap-3 p-3 rounded-md hover:bg-surface-2 text-sm font-medium';
  if (resetting) return <ResetDialog onClose={() => setResetting(false)} onDone={() => { toast('Demo data reset', 'ok'); onClose(); }} />;
  return <Modal open onClose={onClose} title="Demo profile">
    <p className="text-sm text-muted mb-3">A sample profile. This demo has no user accounts.</p>
    <Link to="/profile" onClick={onClose} className={row}><Icon icon={User} />Sample profile</Link>
    <Link to="/stores" onClick={onClose} className={row}><Icon icon={Store} />Demo stores</Link>
    <Link to="/analyst" onClick={onClose} className={row}><Icon icon={Gauge} />Analyst console</Link>
    <Link to="/onboarding" onClick={onClose} className={row}><Icon icon={BadgeCheck} />Register a merchant</Link>
    {SHOW_RESET && <button className={cn(row, 'w-full text-left')} onClick={() => setResetting(true)}><Icon icon={RotateCcw} />Reset demo data</button>}
  </Modal>;
}

export default function Layout() {
  const [panel, setPanel] = useState<'bell' | 'user' | null>(null);
  const { pathname } = useLocation();
  const link = (active: boolean) => cn('flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium', active ? 'bg-surface-2 text-content' : 'text-muted hover:text-content hover:bg-surface-2');
  const tab = (active: boolean) => cn('flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[11px] font-medium min-w-[60px]', active ? 'text-action' : 'text-muted');
  return <div className="min-h-screen lg:grid lg:grid-cols-[232px_1fr]">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-surface focus:text-content focus:border focus:border-line-strong focus:rounded-md focus:px-3 focus:py-2">Skip to main content</a>
    <aside className="hidden lg:flex flex-col gap-6 border-r border-line bg-surface sticky top-0 h-screen p-4" aria-label="Sidebar">
      <Link to="/" aria-label="TrustOra home" className="inline-flex self-start rounded-md bg-white p-1"><img src={trustoraLogo} alt="" className="h-9 w-auto object-contain" /></Link>
      <nav aria-label="Primary" className="flex flex-col gap-1">{NAV.map(n => <NavLink key={n.to} to={n.to} aria-current={n.match(pathname) ? 'page' : undefined} className={link(n.match(pathname))}><Icon icon={n.icon} />{n.label}</NavLink>)}</nav>
    </aside>

    <div className="min-w-0 flex flex-col pb-24 lg:pb-0">
      <header className="sticky top-0 z-30 bg-surface border-b border-line">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-8 h-14 flex items-center gap-2 sm:gap-3">
          <Link to="/" aria-label="TrustOra home" className="lg:hidden inline-flex rounded-md bg-white p-1"><img src={trustoraLogo} alt="" className="h-7 w-auto object-contain" /></Link>
          <ModeBadge />
          <div className="flex items-center gap-1 sm:gap-2 ml-auto">
            <ThemeToggle />
            <button aria-label="Notifications" onClick={() => setPanel('bell')} className="p-1.5 sm:p-2 rounded-md hover:bg-surface-2"><Icon icon={Bell} /></button>
            <button aria-label="Account menu" onClick={() => setPanel('user')} className="p-1.5 sm:p-2 rounded-md hover:bg-surface-2"><Icon icon={User} /></button>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="w-full max-w-[1200px] mx-auto px-4 lg:px-8 py-6 flex-1 space-y-4"><Outlet /></main>
      <div className="max-w-[1200px] w-full mx-auto px-4 lg:px-8"><SiteFooter /></div>
    </div>

    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line px-1 pb-2 pt-1 flex justify-around" aria-label="Primary">
      {NAV.map(n => <NavLink key={n.to} to={n.to} aria-current={n.match(pathname) ? 'page' : undefined} className={tab(n.match(pathname))}><Icon icon={n.icon} />{n.label}</NavLink>)}</nav>
    {panel === 'bell' && <Notifications onClose={() => setPanel(null)} />}
    {panel === 'user' && <Account onClose={() => setPanel(null)} />}
  </div>;
}
