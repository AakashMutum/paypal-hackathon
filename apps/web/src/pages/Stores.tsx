import { Link } from 'react-router-dom';
import { ExternalLink, Gauge } from 'lucide-react';
import { usePageTitle } from '../hooks/usePageTitle';
import { STORES } from '../data/stores';
import { Badge, Icon } from '../components/ui';
import { StoreArt } from '../components/StoreArt';
import { money } from '../lib/format';
import { VERDICT_WORDS } from '../lib/labels';

export default function Stores() {
  usePageTitle('Demo stores');
  return <div className="space-y-4">
    <section><h1 className="text-xl font-semibold">Demo stores</h1>
      <p className="text-sm text-muted mt-1">Three fictional stores, three different outcomes. Check out from each to watch TrustOra decide. None of these stores is real.</p></section>
    <div className="grid gap-4 md:grid-cols-3">{STORES.map(s => <article key={s.id} className="card flex flex-col gap-3">
      <div className="rounded-md grid place-items-center py-4" style={{ background: s.theme.bg }}><StoreArt kind={s.kind} accent={s.theme.accent} size={96} /></div>
      <div className="flex-1 space-y-1"><h2 className="font-semibold">{s.name}</h2>
        <p className="text-sm text-muted">{s.product.name} · <span className="font-mono num">{money(s.product.price)}</span></p>
        <p className="font-mono text-xs text-muted break-all">{s.domain}</p>
        <div className="flex flex-wrap gap-2 pt-1"><Badge tone="neutral">Fictional demo store</Badge>
          <Badge tone={VERDICT_WORDS[s.expected].tone}>Expect {s.expected} · {VERDICT_WORDS[s.expected].subtitle}</Badge></div></div>
      <Link to={`/store/${s.id}`} className="btn-primary">Visit the store<Icon icon={ExternalLink} size={16} /></Link></article>)}</div>
    <Link to="/analyst" className="btn-secondary w-full sm:w-auto"><Icon icon={Gauge} size={16} />Open the analyst console</Link>
  </div>;
}
