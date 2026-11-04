import { ReactNode, useEffect } from 'react';
import { X } from 'lucide-react';
import type { Verdict } from '../types';
import { cn, Tone, TONE } from '../lib/format';
import { VERDICT_WORDS } from '../lib/labels';

export function Pill({ tone = 'neutral', pulse, children, className }: { tone?: Tone; pulse?: boolean; children: ReactNode; className?: string }) {
  return <span className={cn('pill', TONE[tone], className)}>{pulse && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}{children}</span>;
}
export function RiskBadge({ verdict }: { verdict?: Verdict }) {
  if (!verdict) return <Pill tone="cyan" pulse>Checking</Pill>;
  const w = VERDICT_WORDS[verdict];
  return <Pill tone={w.tone}>{w.word}<span className="font-normal opacity-80">· {w.subtitle}</span></Pill>;
}
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => { if (!open) return; const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-navy/40 backdrop-blur-md" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
    <div className="bg-white rounded-xl border border-ink/10 shadow-l3 w-full max-w-lg max-h-[85vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4"><h2 className="text-lg font-semibold">{title}</h2>
        <button className="p-1 rounded hover:bg-canvas" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      {children}
    </div></div>;
}
export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return <div className="card text-center py-10"><div className="mx-auto mb-3 w-12 h-12 rounded-full bg-tint text-electric grid place-items-center">{icon}</div>
    <h2 className="font-semibold text-lg">{title}</h2><div className="text-sm text-muted mt-1 mb-4">{children}</div></div>;
}
export function Switch({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    className={cn('relative w-12 h-7 rounded-full transition focus-visible:ring-2 focus-visible:ring-accent', on ? 'bg-electric' : 'bg-white/20')}>
    <span className={cn('absolute top-0.5 w-6 h-6 rounded-full bg-white transition-all', on ? 'left-[22px]' : 'left-0.5')} /></button>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded bg-ink/10 animate-pulse', className ?? 'h-4 w-full')} />;
}
export function WakeNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p role="status" className="card text-sm text-muted">Waking up the server. A free host sleeps when it is idle, so the first request can take up to a minute.</p>;
}
