import { AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { Evidence, NodeId } from '../types';
import { cn } from '../lib/format';
import { EvidenceCard } from './EvidenceCard';
import { Icon } from './ui';

const ORDER: NodeId[] = ['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'];
const WAITING: Record<NodeId, string> = { SURFACE: 'storefront', MERCHANT: 'merchant', PRICE: 'price', PAYEE: 'payee' };

/** The evidence in four groups: storefront, merchant, price and payee. */
export function Timeline({ evidence }: { evidence: Evidence[] }) {
  return <ol>{ORDER.map((node, i) => {
    const e = evidence[i];
    const glyph = !e ? Circle : e.status === 'PASS' ? CheckCircle2 : e.status === 'WARN' ? AlertTriangle : XCircle;
    const word = !e ? 'Waiting' : e.status === 'PASS' ? 'Passed' : e.status === 'WARN' ? 'Needs attention' : 'Failed';
    const tone = !e ? 'text-muted' : e.status === 'PASS' ? 'text-success' : e.status === 'WARN' ? 'text-warning' : 'text-danger';
    return <li key={node} className="flex gap-3">
      <div className="flex flex-col items-center"><span className={cn('shrink-0', tone, !e && 'animate-pulse')}><Icon icon={glyph} label={word} /></span>
        {i < 3 && <span className="w-px flex-1 bg-line my-1" />}</div>
      <div className="flex-1 pb-4">{e ? <EvidenceCard e={e} index={i} /> : <div className="rounded-md bg-surface-2 p-4 text-sm text-muted">Waiting for the {WAITING[node]} check…</div>}</div>
    </li>;
  })}</ol>;
}
