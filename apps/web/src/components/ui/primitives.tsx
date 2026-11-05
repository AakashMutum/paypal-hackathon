import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, useEffect, useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Dot, Info, MinusCircle, X, XCircle, type LucideIcon } from 'lucide-react';
import { MARK_WORD, type MarkState } from '../../lib/checks';
import type { Verdict } from '../../types';
import { cn, Tone, TONE } from '../../lib/format';
import { VERDICT_WORDS } from '../../lib/labels';
import { Icon } from './Icon';
import { VerdictMark } from './VerdictMark';

// ---------------------------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
const BUTTON: Record<ButtonVariant, string> = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' };

export function Button({ variant = 'secondary', className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button {...rest} className={cn(BUTTON[variant], className)} />;
}

// ---------------------------------------------------------------------------------------------
// Card, Badge, VerdictBadge, Stat
// ---------------------------------------------------------------------------------------------

export function Card({ children, className, as: Tag = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article'; 'aria-label'?: string }) {
  return <Tag {...rest} className={cn('card', className)}>{children}</Tag>;
}

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('pill', TONE[tone], className)}>{children}</span>;
}

const VERDICT_COLOR: Record<Verdict, string> = { ALLOW: 'text-success', WARN: 'text-warning', PAUSE: 'text-danger' };

/** The decision: a coloured mark, then the word and its plain subtitle in normal text. Never colour alone. */
export function VerdictText({ verdict, subtitle = true, className }: { verdict?: Verdict; subtitle?: boolean; className?: string }) {
  if (!verdict) return <span className={cn('inline-flex items-center gap-1.5 text-muted', className)}>Checking…</span>;
  const w = VERDICT_WORDS[verdict];
  return <span className={cn('inline-flex items-center gap-1.5 font-medium whitespace-nowrap', className)}>
    <VerdictMark verdict={verdict} size={16} className={VERDICT_COLOR[verdict]} />{w.word}{subtitle && <span className="font-normal text-muted">· {w.subtitle}</span>}</span>;
}

/** Kept under its older name so every screen shows the decision the same way. */
export function VerdictBadge({ verdict, className }: { verdict?: Verdict; className?: string }) {
  return <VerdictText verdict={verdict} className={className} />;
}

const MARKS: Record<MarkState, { glyph: LucideIcon; color: string }> = {
  pass: { glyph: CheckCircle2, color: 'text-success' },
  warn: { glyph: AlertTriangle, color: 'text-warning' },
  fail: { glyph: XCircle, color: 'text-danger' },
  none: { glyph: MinusCircle, color: 'text-muted' },
  info: { glyph: Dot, color: 'text-muted' },
};

/** The status of one check as an icon with a text label for screen readers. */
export function StatusMark({ state, size = 16 }: { state: MarkState; size?: 16 | 20 }) {
  const m = MARKS[state];
  return <span className={cn('inline-flex shrink-0', m.color)}><Icon icon={m.glyph} size={size} label={MARK_WORD[state]} /></span>;
}

export function Stat({ label, value, hint, loading }: { label: string; value: ReactNode; hint?: ReactNode; loading?: boolean }) {
  return <div className="card !p-4">
    <div className="label">{label}</div>
    {loading ? <Skeleton className="h-8 w-14 my-2" /> : <div className="text-xl font-semibold num my-1">{value}</div>}
    {hint && <div className="text-xs text-muted">{hint}</div>}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Field
// ---------------------------------------------------------------------------------------------

export function Field({ label, hint, error, multiline, className, ...rest }: { label: string; hint?: string; error?: string | null; multiline?: boolean; className?: string } & InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const described = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined;
  const props = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described, className: cn('input', multiline && '!h-28 py-2', className), ...rest };
  return <div className="space-y-1">
    <label htmlFor={id} className="text-sm font-medium">{label}</label>
    {multiline ? <textarea {...(props as TextareaHTMLAttributes<HTMLTextAreaElement>)} /> : <input {...(props as InputHTMLAttributes<HTMLInputElement>)} />}
    {hint && <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p>}
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-danger">{error}</p>}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// Skeleton, EmptyState, Disclosure
// ---------------------------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded bg-line animate-pulse', className ?? 'h-4 w-full')} />;
}

export function WakeNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p role="status" className="card text-sm text-muted">Waking up the server. A free host sleeps when it is idle, so the first request can take up to a minute.</p>;
}

export function EmptyState({ title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <div className="border-y border-line py-10 max-w-xl">
    <h2 className="font-semibold text-base">{title}</h2><div className="text-sm text-muted mt-1">{children}</div></div>;
}

/** A button that shows or hides a region. No tooltips: everything it hides is reachable by keyboard. */
export function Disclosure({ title, children, defaultOpen = false, className }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return <div className={cn('border-t border-line', className)}>
    <button type="button" className="w-full py-3 flex justify-between items-center gap-3 text-sm font-medium text-left" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
      <span>{title}</span><span aria-hidden="true" className="text-muted text-xs">{open ? 'Hide' : 'Show'}</span></button>
    <div id={id} hidden={!open} className="pb-3">{open && children}</div></div>;
}

// ---------------------------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------------------------

export type StepState = 'done' | 'current' | 'todo' | 'failed' | 'held';
export interface Step { label: string; detail?: string; state: StepState }

const STEP_WORD: Record<StepState, string> = { done: 'Done', current: 'Now', todo: 'Not yet', failed: 'Failed', held: 'Held' };

const STEP_EDGE: Record<StepState, string> = { done: 'border-success', current: 'border-action', todo: 'border-line', failed: 'border-danger', held: 'border-warning' };

/** The steps as a ruled row: a coloured top rule, the label, and the state written out (never colour alone). */
export function Stepper({ steps, label, vertical }: { steps: Step[]; label: string; vertical?: boolean }) {
  return <ol aria-label={label} className={cn("grid gap-x-4 gap-y-3", !vertical && "sm:grid-cols-4")}>{steps.map((s, n) => <li key={s.label} aria-current={s.state === 'current' ? 'step' : undefined} className={cn('border-t-2 pt-2', STEP_EDGE[s.state])}>
    <div className="text-sm font-medium">{n + 1}. {s.label}</div>
    <div className="text-xs text-muted mt-0.5">{STEP_WORD[s.state]}{s.detail ? ' · ' + s.detail : ''}</div></li>)}</ol>;
}

// ---------------------------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------------------------

export function Toast({ message, tone }: { message: string; tone: 'ok' | 'bad' | 'info' }) {
  const glyph = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? AlertTriangle : Info;
  return <div role={tone === 'bad' ? 'alert' : 'status'} className="fixed z-[60] bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 max-w-[calc(100vw-2rem)] flex items-center gap-2 bg-navy text-navy-on text-sm px-4 py-2.5 rounded-md shadow-l2">
    <Icon icon={glyph} size={16} /><span>{message}</span></div>;
}

// ---------------------------------------------------------------------------------------------
// Pill (the older name for Badge), Modal, Switch, Empty
// ---------------------------------------------------------------------------------------------

export function Pill({ tone = 'neutral', pulse, children, className }: { tone?: Tone; pulse?: boolean; children: ReactNode; className?: string }) {
  return <Badge tone={tone} className={className}>{pulse && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}{children}</Badge>;
}

export function RiskBadge({ verdict }: { verdict?: Verdict }) {
  return <VerdictBadge verdict={verdict} />;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-[var(--overlay)]" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-surface rounded-xl border border-line shadow-l2 w-full max-w-lg max-h-[85vh] overflow-auto p-5" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4"><h2 id={titleId} className="text-lg font-semibold">{title}</h2>
        <button className="p-1 rounded hover:bg-surface-2" onClick={onClose} aria-label="Close"><Icon icon={X} size={20} /></button></div>
      {children}
    </div></div>;
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return <EmptyState icon={icon} title={title}>{children}</EmptyState>;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (b: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
    className={cn('relative w-12 h-7 rounded-full border transition shrink-0', on ? 'bg-action border-action' : 'bg-surface-2 border-line-strong')}>
    <span className={cn('absolute top-0.5 w-5 h-5 rounded-full transition-all', on ? 'left-[24px] bg-action-on' : 'left-0.5 bg-muted')} /></button>;
}
