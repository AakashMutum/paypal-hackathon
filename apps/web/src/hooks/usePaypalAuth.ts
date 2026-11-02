import { useEffect, useState } from 'react';
declare global { interface Window { paypal?: any } }
const CLIENT = import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined;
export function usePaypalAuth() {
  const [ready, setReady] = useState(!CLIENT);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!CLIENT) return;
    if (window.paypal) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${CLIENT}&intent=authorize&currency=USD`;
    s.onload = () => setReady(true); s.onerror = () => setError('PayPal SDK failed to load');
    document.body.appendChild(s);
  }, []);
  return { ready, error, sdk: !!CLIENT };
}
