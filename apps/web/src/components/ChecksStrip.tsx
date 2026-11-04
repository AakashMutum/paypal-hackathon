import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { Evidence, NodeId } from '../types';
import { cn } from '../lib/format';
import { NODE_TITLE } from '../lib/labels';
import { Icon } from './ui';

const ORDER: NodeId[] = ['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'];
/** Each check appears this long after the one before it: four checks, 600 ms in all with the first one's own fade. */
export const REVEAL_STEP_MS = 150;

const WORD = { PASS: 'Passed', WARN: 'Needs attention', FAIL: 'Failed' } as const;

/**
 * The four checks as a short list. With reveal they appear one after another. The data is already
 * complete when this is drawn; only its appearance is staged. Under reduced motion all four are
 * simply there.
 */
export function ChecksStrip({ evidence, reveal }: { evidence: Evidence[]; reveal?: boolean }) {
  return <ol aria-label="The four checks" className="card !p-0 divide-y divide-line">{ORDER.map((node, i) => {
    const e = evidence[i];
    const glyph = !e ? Circle : e.status === 'PASS' ? CheckCircle2 : e.status === 'WARN' ? AlertTriangle : XCircle;
    const tone = !e ? 'text-muted' : e.status === 'PASS' ? 'text-success' : e.status === 'WARN' ? 'text-warning' : 'text-danger';
    return <li key={node} className={cn('flex items-center gap-3 px-4 py-3', reveal && 'reveal')} style={reveal ? { animationDelay: `${i * REVEAL_STEP_MS}ms` } : undefined}>
      <span className={tone}><Icon icon={glyph} label={e ? WORD[e.status] : 'Waiting'} /></span>
      <span className="font-medium flex-1">{NODE_TITLE[node]}</span>
      <span className={cn('text-sm', tone)}>{e ? WORD[e.status] : 'Waiting'}</span>
    </li>;
  })}</ol>;
}
