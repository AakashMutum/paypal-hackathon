import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { STORES } from '../data/stores';
import { VerdictText } from '../components/ui';
import { StoreArt } from '../components/StoreArt';
import { money } from '../lib/format';

export default function Stores() {
  usePageTitle('Demo stores');
  return <div className="space-y-6">
    <section><h1>Demo stores</h1>
      <p className="text-muted mt-1 max-w-2xl">These stores are fictional. Three stores, three different outcomes: check out from each to watch TrustOra decide. Payments here are simulated or use PayPal's test mode, so no real money moves.</p></section>
    <ul className="ruled border-y border-line">{STORES.map(s => <li key={s.id} className="grid gap-x-6 gap-y-3 py-4 sm:grid-cols-[72px_minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.3fr)_auto] sm:items-center">
      <div className="w-[72px] h-[72px] rounded-md grid place-items-center overflow-hidden" style={{ background: s.theme.bg }} aria-hidden="true"><StoreArt kind={s.kind} accent={s.theme.accent} size={56} /></div>
      <div className="min-w-0"><h2 className="font-semibold text-base">{s.name}</h2><p className="font-mono text-xs text-muted break-all">{s.domain}</p></div>
      <p className="text-sm">{s.product.name} <span className="font-mono num text-muted block sm:inline">{money(s.product.price)}</span></p>
      <p className="text-sm"><span className="label block">Expected outcome</span><VerdictText verdict={s.expected} /></p>
      <Link to={`/store/${s.id}`} className="link text-sm sm:text-right">Open store<span className="sr-only">: {s.name}</span></Link>
    </li>)}</ul>
    <p className="text-sm text-muted">Want to see every result in one table? Open the <Link to="/analyst" className="link">analyst console</Link>.</p>
  </div>;
}
