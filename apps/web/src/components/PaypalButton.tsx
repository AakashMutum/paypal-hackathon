import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { usePaypalAuth } from '../hooks/usePaypalAuth';
// The frontend only collects buyer approval. The backend creates the AUTHORIZE order and decides capture/void.
export function PaypalButton({ createOrder, onApprove, disabled }: { createOrder: () => Promise<string>; onApprove: () => void; disabled?: boolean }) {
  const { ready, error, sdk } = usePaypalAuth();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const cb = useRef({ createOrder, onApprove }); cb.current = { createOrder, onApprove };
  useEffect(() => {
    if (!sdk || !ready || !window.paypal || !ref.current) return;
    ref.current.innerHTML = '';
    window.paypal.Buttons({ createOrder: () => cb.current.createOrder(), onApprove: async () => cb.current.onApprove() }).render(ref.current);
  }, [sdk, ready]);
  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (sdk) return <div ref={ref} className={disabled ? 'pointer-events-none opacity-50' : ''} />;
  return <button disabled={disabled || busy} onClick={async () => { setBusy(true); try { await cb.current.createOrder(); cb.current.onApprove(); } finally { setBusy(false); } }}
    className="w-full h-12 rounded bg-[#FFC439] hover:bg-[#f5b921] text-[#003087] font-bold italic text-lg flex items-center justify-center gap-2 disabled:opacity-60">
    {busy ? <Loader2 className="animate-spin" size={18} /> : null}Pay with PayPal <span className="text-[10px] not-italic font-semibold opacity-70">SANDBOX</span></button>;
}
