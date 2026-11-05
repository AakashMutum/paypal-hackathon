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

  if (mode === 'loading') return <div className="space-y-2" aria-busy="true"><Skeleton className="h-11 w-full" /><p className="text-sm text-muted">Checking how payments are set up…</p></div>;
  if (mode === 'unknown') return <p role="alert" className="flex gap-2 text-sm text-danger"><AlertTriangle size={16} className="shrink-0 mt-0.5" />The server could not be reached, so the payment button cannot be shown. Try again in a few seconds.</p>;
  if (mode === 'unconfigured') return <div className="rounded-md bg-surface-2 px-4 py-3 text-center" role="note">
    <p className="text-sm">Checkout is not set up on this deployment yet.</p>
    <a className="link text-sm" href={SANDBOX_DOC_URL} target="_blank" rel="noreferrer">How to set it up<span className="sr-only"> (opens in a new tab)</span></a></div>;
  if (mode === 'sdk') {
    if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
    return <div className={disabled ? 'pointer-events-none opacity-50' : ''}>{!ready && <Skeleton className="h-11 w-full" />}<div ref={ref} aria-label="PayPal checkout" /></div>;
  }
  return <div className="space-y-1">
    <button disabled={disabled || busy} onClick={async () => { setBusy(true); try { await cb.current.createOrder(); cb.current.onApprove(); } catch (e) { cb.current.onError?.(e); } finally { setBusy(false); } }}
      className="btn-primary w-full">
      {busy ? <Loader2 className="animate-spin" size={18} /> : null}Simulated payment</button>
    <p className="text-sm text-muted text-center">Simulated payment: no PayPal call is made and no real money moves.</p></div>;
}
