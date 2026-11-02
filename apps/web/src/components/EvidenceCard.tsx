import type { Evidence } from '@checkout-guardian/contracts';
import { cn, Tone } from '../lib/format';
import { Pill } from './ui';
export function EvidenceCard({ e, index }: { e: Evidence; index: number }) {
  const tone: Tone = e.status === 'PASS' ? 'ok' : e.status === 'WARN' ? 'warn' : 'bad';
  const bg = e.status === 'PASS' ? 'bg-tint' : e.status === 'WARN' ? 'bg-warn-bg' : 'bg-bad-bg';
  return <div className={cn('rounded-lg p-4', bg)}>
    <div className="flex items-start justify-between gap-2 mb-3">
      <div className={cn('mono-label', tone === 'bad' ? '!text-bad-deep' : tone === 'warn' ? '!text-warn' : '!text-electric')}>Node 0{index + 1} // {e.title}</div>
      <Pill tone={e.status === 'PASS' ? 'neutral' : tone}>{e.badge}</Pill></div>
    <dl className="space-y-2">{e.fields.map(f => <div key={f.label} className="flex justify-between gap-3 text-sm">
      <dt className="text-ink/80">{f.label}</dt>
      {f.meter !== undefined
        ? <dd className="flex items-center gap-2 flex-1 justify-end"><span className="h-1.5 w-24 rounded-full bg-ink/10 overflow-hidden"><span className={cn('block h-full', f.flag ? 'bg-bad-deep' : 'bg-ok')} style={{ width: `${f.meter}%` }} /></span><span className={cn('font-mono text-xs font-semibold', f.flag && 'text-bad-deep')}>{f.value}</span></dd>
        : <dd className={cn('font-mono text-[13px] text-right break-all', f.flag && 'text-bad-deep font-semibold', f.strike && 'line-through text-muted')}>{f.value}</dd>}
    </div>)}</dl></div>;
}
