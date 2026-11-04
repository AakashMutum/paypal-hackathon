import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { usePaypalAuth } from '../hooks/usePaypalAuth';
import type { PaymentButtonMode } from '../lib/payment';
import { Skeleton } from './ui';

export const SANDBOX_DOC_URL = 'https://github.com/AakashMutum/paypal-hackathon/blob/main/docs/paypal-sandbox.md';

interface Props {
  mode: PaymentButtonMode;
  createOrder: () => Promise<string>;
  onApprove: () => void;
  onError?: (error: unknown) => void;
  disabled?: boolean;
}

// The frontend only collects buyer approval. The backend creates the AUTHORIZE order and decides capture/void.
// The only PayPal mark on screen is the button PayPal's own SDK renders.
export function PaypalButton({ mode, createOrder, onApprove, onError, disabled }: Props) {
  const { ready, error } = usePaypalAuth(mode === 'sdk');
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const cb = useRef({ createOrder, onApprove, onError }); cb.current = { createOrder, onApprove, onError };
  useEffect(() => {
    if (mode !== 'sdk' || !ready || !window.paypal || !ref.current) return;
    ref.current.innerHTML = '';
    void window.paypal.Buttons({
      createOrder: () => cb.current.createOrder(),
      onApprove: async () => cb.current.onApprove(),
      onError: (e) => cb.current.onError?.(e),
    }).render(ref.current);
  }, [mode, ready]);

  if (mode === 'loading') return <div className="card space-y-2" aria-busy="true"><Skeleton className="h-11 w-full" /><p className="text-xs text-muted">Checking how payments are set up…</p></div>;
  if (mode === 'unknown') return <p role="alert" className="card flex gap-2 text-sm text-bad"><AlertTriangle size={16} className="shrink-0 mt-0.5" />The server could not be reached, so the payment button cannot be shown. Try again in a few seconds.</p>;
  if (mode === 'unconfigured') return <div className="card space-y-2" role="note">
    <button disabled className="btn-secondary w-full">PayPal sandbox button is not configured on this deployment</button>
    <p className="text-sm text-muted">The API is in PayPal sandbox mode, so a buyer must approve the order with PayPal's own button. This build has no sandbox client id (<span className="font-mono">VITE_PAYPAL_CLIENT_ID</span>).{' '}
      <a className="text-electric font-semibold underline" href={SANDBOX_DOC_URL} target="_blank" rel="noreferrer">How to set it up</a></p></div>;
  if (mode === 'sdk') {
    if (error) return <p role="alert" className="text-sm text-bad">{error}</p>;
    return <div className={disabled ? 'pointer-events-none opacity-50' : ''}>{!ready && <Skeleton className="h-11 w-full" />}<div ref={ref} aria-label="PayPal checkout" /></div>;
  }
  return <div className="space-y-1">
    <button disabled={disabled || busy} onClick={async () => { setBusy(true); try { await cb.current.createOrder(); cb.current.onApprove(); } catch (e) { cb.current.onError?.(e); } finally { setBusy(false); } }}
      className="btn-primary w-full !h-12">
      {busy ? <Loader2 className="animate-spin" size={18} /> : null}Simulated payment</button>
    <p className="text-xs text-muted text-center">Simulated payment: no PayPal call is made and no real money moves.</p></div>;
}
