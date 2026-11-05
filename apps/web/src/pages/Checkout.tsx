import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { storeById } from '../data/stores';
import { useCart } from '../context/CartContext';
import { useApp } from '../context/OrderStateContext';
import { PaypalButton } from '../components/PaypalButton';
import { useHealth } from '../components/Provenance';
import { PAYPAL_CLIENT_ID } from '../hooks/usePaypalAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { api, USE_MOCK } from '../api/apiClient';
import { friendlyPaymentError, paymentButtonMode } from '../lib/payment';
import { money } from '../lib/format';

export default function Checkout() {
  usePageTitle('Checkout');
  const { id } = useParams(); const s = storeById(id); const cart = useCart(); const nav = useNavigate(); const { setLatestId, toast } = useApp();
  const { health, error: healthError } = useHealth();
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<ReturnType<typeof friendlyPaymentError> | null>(null);
  const order = useRef<{ orderId: string; invId: string } | null>(null);
  if (!s) return <Navigate to="/stores" replace />;
  const items = cart.storeId === s.id && cart.items.length ? cart.items : [{ sku: s.product.sku, name: s.product.name, price: s.product.price, qty: 1 }];
  const total = items.reduce((a, i) => a + i.price * i.qty, 0);
  const mode = paymentButtonMode({ useMock: USE_MOCK, apiPaypal: health?.modes?.paypal, healthPending: !health && !healthError, healthFailed: Boolean(healthError), clientId: PAYPAL_CLIENT_ID });
  const fail = (e: unknown) => { setProblem(friendlyPaymentError(e instanceof Error ? e.message : String(e))); toast('The payment step did not complete. No funds were captured.', 'bad'); };
  return <>
    <section className="space-y-2">
      <h1 className="text-[22px] font-bold">Checkout</h1>
      <p className="text-sm text-muted">Paying <span className="font-mono">{s.domain}</span></p>
    </section>

    <div className="card xl p-5 space-y-3">
      {items.map((i, n) => <div key={n} className="flex justify-between text-sm"><span>{i.name} × {i.qty}</span><span className="font-mono">{money(i.price * i.qty)}</span></div>)}
      <div className="border-t border-line pt-3 flex justify-between font-semibold"><span>Total</span><span className="font-mono">{money(total)}</span></div></div>

    <div className="card xl p-5 space-y-2"><label htmlFor="em" className="mono-label block">Buyer email</label>
      <input id="em" className="input font-mono" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="buyer@example.com" autoComplete="email" /></div>

    <div className="card xl flex gap-3 items-start p-5 text-sm"><ShieldCheck className="text-success shrink-0 mt-0.5" aria-hidden="true" />
      <p>TrustOra investigates the merchant and the receiving PayPal account before any funds are captured.</p></div>

    {problem && <div role="alert" className="card xl border-danger border p-4 space-y-1"><h2 className="font-semibold text-danger">{problem.title}</h2><p className="text-sm">{problem.message}</p><p className="text-sm font-semibold">No funds were captured.</p>
      {problem.details && <details className="text-xs text-muted"><summary className="cursor-pointer">Details</summary><pre className="whitespace-pre-wrap break-all font-mono mt-1">{problem.details}</pre></details>}</div>}

    <PaypalButton mode={mode} disabled={!email} onError={fail}
      createOrder={async () => { setProblem(null); const r = await api.createOrder({ storeId: s.id, items, buyerEmail: email }); order.current = { orderId: r.orderId, invId: r.investigationId }; setLatestId(r.investigationId); return r.paypalOrderId; }}
      onApprove={async () => { const o = order.current; if (!o) return; try { await api.notifyApproval(o.orderId); } catch { /* backend decides the outcome */ } cart.clear(); toast('Approval sent. TrustOra is checking…', 'info'); nav(`/engine/${o.invId}`); }} />

    <Link to={`/store/${s.id}`} className="block text-center text-sm text-muted hover:text-content hover:underline mt-6">Back to store</Link>
  </>;
}
