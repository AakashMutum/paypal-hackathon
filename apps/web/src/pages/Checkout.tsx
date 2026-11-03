import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { storeById } from '../data/stores';
import { useCart } from '../context/CartContext';
import { useApp } from '../context/OrderStateContext';
import { PaypalButton } from '../components/PaypalButton';
import { api } from '../api/apiClient';
import { money } from '../lib/format';
export default function Checkout() {
  const { id } = useParams(); const s = storeById(id); const cart = useCart(); const nav = useNavigate(); const { setLatestId, protection, toast } = useApp();
  const [email, setEmail] = useState('alex.walker@mail.example');
  const order = useRef<{ orderId: string; invId: string } | null>(null);
  if (!s) return <Navigate to="/stores" replace />;
  const items = cart.storeId === s.id && cart.items.length ? cart.items : [{ sku: s.product.sku, name: s.product.name, price: s.product.price, qty: 1 }];
  const total = items.reduce((a, i) => a + i.price * i.qty, 0);
  return <>
    <section><h1 className="text-2xl font-bold">Checkout</h1><p className="text-sm text-muted mt-1">Paying <span className="font-mono">{s.domain}</span></p></section>
    <div className="card space-y-3">
      {items.map((i, n) => <div key={n} className="flex justify-between text-sm"><span>{i.name} × {i.qty}</span><span className="font-mono">{money(i.price * i.qty)}</span></div>)}
      <div className="border-t border-ink/10 pt-3 flex justify-between font-semibold"><span>Total</span><span className="font-mono">{money(total)}</span></div></div>
    <div className="card space-y-2"><label htmlFor="em" className="mono-label">Buyer email</label>
      <input id="em" className="input font-mono" value={email} onChange={e => setEmail(e.target.value)} type="email" /></div>
    <div className="card flex gap-3 items-start text-sm"><ShieldCheck className={protection ? 'text-ok' : 'text-muted'} />
      <p>{protection ? 'Guardian will verify the receiving PayPal account before any funds are captured.' : 'Pre-payment intervention is off. Turn it on from the dashboard to screen this checkout.'}</p></div>
    <PaypalButton disabled={!email}
      createOrder={async () => { const r = await api.createOrder({ storeId: s.id, items, buyerEmail: email }); order.current = { orderId: r.orderId, invId: r.investigationId }; setLatestId(r.investigationId); return r.paypalOrderId; }}
      onApprove={async () => { const o = order.current; if (!o) return; try { await api.notifyApproval(o.orderId); } catch { /* backend decides the outcome */ } cart.clear(); toast('Approval sent. Guardian is verifying…', 'info'); nav(`/engine/${o.invId}`); }} />
    <Link to={`/store/${s.id}`} className="block text-center text-sm text-muted hover:text-ink">Back to store</Link>
  </>;
}
