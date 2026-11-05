import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Gauge, ListChecks, Menu, ScanLine, Search, Store, X } from 'lucide-react';
import { cn } from '../lib/format';
import { Icon } from './ui';
import { AboutDemo, SiteFooter } from './HowChecked';
import { ThemeMenu } from './ThemeMenu';
import { CommandPalette } from './CommandPalette';
import { SHOW_RESET } from '../lib/env';
import { ResetDialog } from './ResetDialog';
import { useApp } from '../context/OrderStateContext';
import trustoraLogo from '../assets/trustora-logo.png';

const NAV = [
  { to: '/', label: 'Check', short: 'Check', icon: ScanLine, match: (p: string) => p === '/' || p.startsWith('/scanner') },
  { to: '/investigations', label: 'Cases', short: 'Cases', icon: ListChecks, match: (p: string) => /^\/(investigations|engine|pay|history)/.test(p) },
  { to: '/stores', label: 'Demo stores', short: 'Stores', icon: Store, match: (p: string) => /^\/(stores|checkout)/.test(p) },
  { to: '/analyst', label: 'Analyst', short: 'Analyst', icon: Gauge, match: (p: string) => p.startsWith('/analyst') },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The top bar, the mobile sheet and bottom tabs, the command palette and the footer. No sidebar. */
export default function Layout() {
  const { pathname } = useLocation();
  const { toast } = useApp();
  const [palette, setPalette] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [about, setAbout] = useState(false);
  const [resetting, setResetting] = useState(false);
  const sheetRef = useRef<HTMLDialogElement>(null);
  const fullBleed = pathname.startsWith('/analyst');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); }
      else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const d = sheetRef.current;
    if (!d) return;
    if (sheet && !d.open) d.showModal();
    if (!sheet && d.open) d.close();
  }, [sheet]);
  useEffect(() => setSheet(false), [pathname]);

  const link = (active: boolean) => cn('relative h-[52px] px-3 inline-flex items-center text-sm font-medium border-b-2', active ? 'border-action text-content' : 'border-transparent text-muted hover:text-content');
  const tab = (active: boolean) => cn('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium flex-1', active ? 'text-action' : 'text-muted');
  const sheetLink = (active: boolean) => cn('flex items-center gap-3 px-2 py-3 text-base border-b border-line', active ? 'font-semibold text-action' : 'text-content');

  return <div className="min-h-screen flex flex-col">
    <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-surface focus:text-content focus:border focus:border-line-strong focus:rounded-md focus:px-3 focus:py-2">Skip to main content</a>
    <header className="sticky top-0 z-30 bg-surface border-b border-line">
      <div className={cn('h-[52px] px-4 sm:px-6 lg:px-8 mx-auto flex items-center gap-2', fullBleed ? 'max-w-none' : 'max-w-[1280px]')}>
        <Link to="/" aria-label="TrustOra home" className="inline-flex items-center gap-2 rounded">
          <span className="rounded bg-white p-0.5 inline-flex"><img src={trustoraLogo} alt="" className="h-6 w-auto object-contain" /></span>
          <span className="font-semibold tracking-tight">TrustOra</span></Link>
        <nav aria-label="Primary" className="hidden md:flex items-center ml-4">
          {NAV.map(n => <NavLink key={n.to} to={n.to} aria-current={n.match(pathname) ? 'page' : undefined} className={link(n.match(pathname))}>{n.label}</NavLink>)}</nav>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setPalette(true)} aria-label="Search or paste a link" className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded border border-line-strong text-sm text-muted hover:text-content hover:bg-surface-2">
            <Icon icon={Search} size={16} /><span className="hidden lg:inline">Search or paste a link</span>
            <kbd className="hidden lg:inline font-mono text-[11px] border border-line rounded px-1.5">{isMac ? '⌘K' : 'Ctrl+K'}</kbd></button>
          <ThemeMenu />
          <button type="button" onClick={() => setAbout(true)} className="hidden md:inline-flex h-9 px-3 items-center text-sm text-muted hover:text-content rounded hover:bg-surface-2">About</button>
          <button type="button" onClick={() => setPalette(true)} aria-label="Search" className="md:hidden h-9 w-9 grid place-items-center rounded text-muted hover:bg-surface-2"><Icon icon={Search} /></button>
          <button type="button" onClick={() => setSheet(true)} aria-label="Open menu" className="md:hidden h-9 w-9 grid place-items-center rounded text-muted hover:bg-surface-2"><Icon icon={Menu} /></button>
        </div>
      </div>
    </header>

    <main id="main" tabIndex={-1} className={cn('flex-1 w-full pb-24 md:pb-8 outline-none', fullBleed ? 'px-0' : 'max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8')}><Outlet /></main>
    {!fullBleed && <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-24 md:pb-0"><SiteFooter /></div>}

    <nav aria-label="Primary" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-line flex pb-[env(safe-area-inset-bottom)]">
      {NAV.map(n => <NavLink key={n.to} to={n.to} aria-current={n.match(pathname) ? 'page' : undefined} className={tab(n.match(pathname))}><Icon icon={n.icon} />{n.short}</NavLink>)}</nav>

    <dialog ref={sheetRef} aria-label="Menu" onClose={() => setSheet(false)} className="drawer m-0 h-full max-h-none w-full max-w-none bg-surface p-4 text-content md:hidden">
      <div className="flex items-center justify-between mb-2"><span className="font-semibold">TrustOra</span>
        <button type="button" onClick={() => setSheet(false)} aria-label="Close menu" className="h-9 w-9 grid place-items-center rounded hover:bg-surface-2"><Icon icon={X} /></button></div>
      <nav aria-label="Menu">{NAV.map(n => <Link key={n.to} to={n.to} className={sheetLink(n.match(pathname))}><Icon icon={n.icon} />{n.label}</Link>)}
        <button type="button" onClick={() => { setSheet(false); setAbout(true); }} className={cn(sheetLink(false), 'w-full text-left')}>About this demo</button></nav>
    </dialog>

    <CommandPalette open={palette} onClose={() => setPalette(false)} />
    {about && <AboutDemo onClose={() => setAbout(false)}>
      {SHOW_RESET && <button type="button" className="tbtn mt-4" onClick={() => { setAbout(false); setResetting(true); }}>Reset demo data</button>}
    </AboutDemo>}
    {resetting && <ResetDialog onClose={() => setResetting(false)} onDone={() => { setResetting(false); toast('Demo data reset', 'ok'); }} />}
  </div>;
}
