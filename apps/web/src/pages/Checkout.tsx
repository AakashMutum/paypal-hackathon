import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { storeById } from '../data/stores';
import { useCart } from '../context/CartContext';
import { useApp } from '../context/OrderStateContext';
import { PaypalButton } from '../components/PaypalButton';
import { useHealth } from '../components/Provenance';
import { PAYPAL_CLIENT_ID } from '../hooks/usePaypalAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { api, USE_MOCK } from '../api/apiClient';
import { friendlyPaymentError, paymentButtonMode } from '../lib/payment';
import { money, softBreak } from '../lib/format';
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
  return <div className="max-w-md mx-auto bg-surface border border-line rounded-lg p-6 sm:p-8 space-y-6">
    <section><h1 className="text-2xl">Checkout</h1><p className="text-muted mt-1">Paying <span className="font-mono text-sm break-words">{softBreak(s.domain)}</span>, a fictional store.</p></section>
    <dl className="ruled border-y border-line">
      {items.map((i, n) => <div key={n} className="flex justify-between gap-4 py-3"><dt>{i.name} × {i.qty}</dt><dd className="font-mono num">{money(i.price * i.qty)}</dd></div>)}
      <div className="flex justify-between py-3 font-semibold text-lg"><dt>Total</dt><dd className="font-mono num">{money(total)}</dd></div></dl>
    <div><label htmlFor="em" className="text-sm font-medium block mb-1">Email for the receipt</label>
      <input id="em" className="input font-mono" value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="buyer@example.com" autoComplete="email" />
      <p className="label mt-1">Kept with the order so the payment can be matched to you. No email is sent.</p></div>
    {problem && <div role="alert" className="border-l-2 border-danger pl-4 space-y-1"><h2 className="font-semibold">{problem.title}</h2><p className="text-sm">{problem.message}</p><p className="text-sm font-semibold">No funds were captured.</p>
      {problem.details && <details className="text-xs text-muted"><summary className="cursor-pointer">Details</summary><pre className="whitespace-pre-wrap break-all font-mono mt-1">{problem.details}</pre></details>}</div>}
    <PaypalButton mode={mode} disabled={!email} onError={fail}
      createOrder={async () => { setProblem(null); const r = await api.createOrder({ storeId: s.id, items, buyerEmail: email }); order.current = { orderId: r.orderId, invId: r.investigationId }; setLatestId(r.investigationId); return r.paypalOrderId; }}
      onApprove={async () => { const o = order.current; if (!o) return; try { await api.notifyApproval(o.orderId); } catch { /* backend decides the outcome */ } cart.clear(); toast('Approval sent. TrustOra is checking…', 'info'); nav(`/engine/${o.invId}`); }} />
    <p className="text-center"><Link to={`/store/${s.id}`} className="link text-sm">Back to the store</Link></p>
  </div>;
}
