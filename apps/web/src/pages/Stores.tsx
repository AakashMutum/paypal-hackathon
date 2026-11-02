import { Link } from 'react-router-dom';
import { Headphones, Watch, ShoppingBag, ExternalLink } from 'lucide-react';
import { STORES } from '../data/stores';
import { Pill } from '../components/ui';
import { money, VERDICT } from '../lib/format';
const ICON = { genuine: Headphones, suspicious: Watch, impersonator: ShoppingBag };
export default function Stores() {
  return <>
    <section><h1 className="text-2xl font-bold">Demo storefronts</h1><p className="text-sm text-muted mt-1">Three stores, three different outcomes. Check out from each to watch Guardian decide.</p></section>
    {STORES.map(s => { const I = ICON[s.kind]; return <div key={s.id} className="card flex gap-4 items-center">
      <div className="w-12 h-12 rounded-lg grid place-items-center shrink-0" style={{ background: s.theme.bg, color: s.theme.accent, border: '1px solid rgba(0,0,0,.1)' }}><I /></div>
      <div className="flex-1 min-w-0"><div className="font-semibold">{s.name}</div><div className="font-mono text-xs text-muted truncate">{s.domain} · {s.product.name} · {money(s.product.price)}</div>
        <div className="mt-1"><Pill tone={VERDICT[s.expected].tone}>EXPECTED: {s.expected}</Pill></div></div>
      <Link to={`/store/${s.id}`} className="btn-primary !h-9">Visit<ExternalLink size={14} /></Link></div>; })}
    <Link to="/analyst" className="btn-secondary w-full">Open Analyst Console</Link>
  </>;
}
