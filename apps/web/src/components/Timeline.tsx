import { Globe, Building2, TrendingDown, Wallet } from 'lucide-react';
import type { Evidence, NodeId } from '@checkout-guardian/contracts';
import { cn } from '../lib/format';
import { EvidenceCard } from './EvidenceCard';
const ICON: Record<NodeId, typeof Globe> = { SURFACE: Globe, MERCHANT: Building2, PRICE: TrendingDown, PAYEE: Wallet };
const ORDER: NodeId[] = ['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'];
export function Timeline({ evidence }: { evidence: Evidence[] }) {
  return <ol>{ORDER.map((node, i) => {
    const e = evidence[i]; const Icon = ICON[node];
    const dot = !e ? 'bg-canvas text-muted border border-ink/10' : e.status === 'PASS' ? 'bg-ok text-white' : e.status === 'WARN' ? 'bg-warn text-white' : 'bg-bad-deep text-white';
    return <li key={node} className="flex gap-3">
      <div className="flex flex-col items-center"><span className={cn('w-7 h-7 rounded-full grid place-items-center shrink-0', dot, !e && 'animate-pulse')}><Icon size={14} /></span>
        {i < 3 && <span className="w-px flex-1 bg-ink/10 my-1" />}</div>
      <div className="flex-1 pb-4">{e ? <EvidenceCard e={e} index={i} /> : <div className="rounded-lg bg-canvas p-4 text-sm text-muted font-mono">Node 0{i + 1} // awaiting {node.toLowerCase()} signal…</div>}</div>
    </li>;
  })}</ol>;
}
