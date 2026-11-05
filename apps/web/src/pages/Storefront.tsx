import { usePageTitle } from '../hooks/usePageTitle';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { StoreArt } from '../components/StoreArt';
import { storeById } from '../data/stores';
import { useCart } from '../context/CartContext';
import { useApp } from '../context/OrderStateContext';
import { money } from '../lib/format';
export default function Storefront() {
  usePageTitle('Demo store');
  const { id } = useParams(); const s = storeById(id); const nav = useNavigate(); const cart = useCart(); const { toast } = useApp();
  if (!s) return <Navigate to="/stores" replace />;
  const t = s.theme, p = s.product, off = Math.round((1 - p.price / p.msrp) * 100);
  const item = { sku: p.sku, name: p.name, price: p.price, qty: 1 };
  return <div className="min-h-screen" style={{ background: t.bg, color: t.fg, fontFamily: t.font }}>
    <div className="bg-navy text-white text-xs font-sans px-4 py-2 flex justify-between items-center"><Link to="/stores" className="flex items-center gap-1 hover:underline"><ArrowLeft size={12} />Back to the TrustOra demo</Link><span className="font-mono">{s.domain}</span></div>
    <div className="text-center text-xs py-1.5 font-sans font-semibold bg-warning-bg text-warning" role="note">Fictional demo store: not a real shop. Checkout uses simulated or test payments only; no real money moves.</div>
    <div className="text-center text-sm py-2 font-semibold" style={{ background: t.accent, color: t.accentFg }}>{t.banner}</div>
    <header className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between"><h1 className="text-2xl font-bold tracking-tight">{s.name}</h1>
      <span className="text-sm opacity-70">Cart ({cart.storeId === s.id ? cart.items.length : 0})</span></header>
    <main className="max-w-4xl mx-auto px-6 pb-16 grid md:grid-cols-[200px_1fr] gap-10 items-start">
      <div className="max-w-[200px] w-full mx-auto aspect-square rounded-xl grid place-items-center" style={{ background: t.accent + '22' }}><StoreArt kind={s.kind} accent={t.accent} size={120} /></div>
      <div><p className="opacity-70 mb-2">{s.tagline}</p><h2 className="text-3xl font-bold leading-tight">{p.name}</h2><p className="mt-3 opacity-80">{p.blurb}</p>
        <div className="mt-6 flex items-baseline gap-3"><span className="text-3xl font-bold" style={{ color: t.accent }}>{money(p.price)}</span>
          {p.msrp > p.price && <><span className="line-through opacity-60">{money(p.msrp)}</span><span className="px-2 py-0.5 text-sm font-bold rounded" style={{ background: t.accent, color: t.accentFg }}>-{off}%</span></>}</div>
        <div className="mt-8 flex gap-3">
          <button className="px-6 h-12 rounded font-semibold border" style={{ borderColor: t.accent, color: t.accent }} onClick={() => { cart.add(s.id, item); toast('Added to cart', 'ok'); }}>Add to cart</button>
          <button className="px-6 h-12 rounded font-semibold" style={{ background: t.accent, color: t.accentFg }} onClick={() => { cart.add(s.id, item); nav(`/checkout/${s.id}`); }}>Buy now</button></div>
      </div></main></div>;
}
