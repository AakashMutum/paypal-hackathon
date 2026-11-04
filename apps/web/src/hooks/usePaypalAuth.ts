import { useEffect, useState } from 'react';
export interface PayPalButtonsConfig {
  createOrder: () => Promise<string>;
  onApprove: () => Promise<void>;
  onError?: (error: unknown) => void;
}

export interface PayPalButtonsInstance {
  render: (container: HTMLElement) => Promise<void>;
}

export interface PayPalNamespace {
  Buttons: (config: PayPalButtonsConfig) => PayPalButtonsInstance;
}

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}
/** The public PayPal sandbox client id this build was given, or undefined. */
export const PAYPAL_CLIENT_ID: string | undefined = (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined)?.trim() || undefined;

/** Loads PayPal's SDK once, only when asked to (the API is in sandbox mode and a client id exists). */
export function usePaypalAuth(enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !PAYPAL_CLIENT_ID) return;
    if (window.paypal) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(PAYPAL_CLIENT_ID)}&intent=authorize&currency=USD`;
    s.onload = () => setReady(true); s.onerror = () => setError('The PayPal button could not be loaded.');
    document.body.appendChild(s);
  }, [enabled]);
  return { ready, error };
}
