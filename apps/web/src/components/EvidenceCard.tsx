import type { Evidence } from '../types';
import { cn, Tone } from '../lib/format';
import { evidenceLabel, NODE_TITLE } from '../lib/labels';
import { Pill } from './ui';
export function EvidenceCard({ e }: { e: Evidence; index?: number }) {
  const tone: Tone = e.status === 'PASS' ? 'ok' : e.status === 'WARN' ? 'warn' : 'bad';
  const bg = e.status === 'PASS' ? 'bg-tint' : e.status === 'WARN' ? 'bg-warn-bg' : 'bg-bad-bg';
  return <div className={cn('rounded-lg p-4', bg)}>
    <div className="flex items-start justify-between gap-2 mb-3">
      <h3 className={cn('text-sm font-semibold', tone === 'bad' ? '!text-bad-deep' : tone === 'warn' ? '!text-warn' : '!text-electric')}>{NODE_TITLE[e.node] ?? e.title}</h3>
      <Pill tone={e.status === 'PASS' ? 'neutral' : tone}>{e.badge}</Pill></div>
    <dl className="space-y-2">{e.fields.map(f => <div key={f.label} className="flex justify-between gap-3 text-sm">
      <dt className="text-ink/80">{evidenceLabel(f.label)}</dt>
      {f.meter !== undefined
        ? <dd className="flex items-center gap-2 flex-1 justify-end"><span className="h-1.5 w-24 rounded-full bg-ink/10 overflow-hidden"><span className={cn('block h-full', f.flag ? 'bg-bad-deep' : 'bg-ok')} style={{ width: `${f.meter}%` }} /></span><span className={cn('font-mono text-xs font-semibold', f.flag && 'text-bad-deep')}>{f.value}</span></dd>
        : <dd className={cn('font-mono text-[13px] text-right break-all', f.flag && 'text-bad-deep font-semibold', f.strike && 'line-through text-muted')}>{f.value}</dd>}
    </div>)}</dl></div>;
}
