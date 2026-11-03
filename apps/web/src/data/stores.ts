import type { Verdict } from '../types';
export interface Store { id: string; domain: string; name: string; kind: 'genuine' | 'suspicious' | 'impersonator'; tagline: string; expected: Verdict;
  product: { sku: string; name: string; price: number; msrp: number; blurb: string };
  theme: { bg: string; fg: string; accent: string; accentFg: string; font: string; banner: string } }
export const STORES: Store[] = [
  { id: 'pulseaudio', domain: 'pulseaudio-store.com', name: 'PulseAudio', kind: 'genuine', tagline: 'Studio-grade sound since 2014.', expected: 'ALLOW',
    product: { sku: 'PAP-1', name: 'PulseAudio Pro Headphones', price: 299, msrp: 299, blurb: 'Over-ear, 40h battery, adaptive noise cancelling.' },
    theme: { bg: '#FFFFFF', fg: '#0F172A', accent: '#0E7490', accentFg: '#fff', font: 'Inter, sans-serif', banner: 'Free 30-day returns · Free shipping over $99' } },
  { id: 'mega-deals', domain: 'mega-dealsoutlet.net', name: 'MEGA DEALS OUTLET', kind: 'suspicious', tagline: 'LOWEST PRICES ANYWHERE!!!', expected: 'WARN',
    product: { sku: 'LW-77', name: 'Unbranded Luxury Watch', price: 19.99, msrp: 499, blurb: 'Looks like a $500 watch. Only 3 left at this price!' },
    theme: { bg: '#FFF7B8', fg: '#1a1a1a', accent: '#E11D48', accentFg: '#fff', font: 'Impact, Arial Black, sans-serif', banner: 'MEGA SALE · 96% OFF · ENDS TONIGHT' } },
  { id: 'luxaura-outlet', domain: 'luxaura-outletdeals.com', name: 'Luxaura Outlet Deals', kind: 'impersonator', tagline: 'Authentic luxury. Outlet prices.', expected: 'PAUSE',
    product: { sku: 'LXH-1', name: 'Luxaura Handbag', price: 149, msrp: 2500, blurb: 'Leather, gold hardware. 94% off boutique price.' },
    theme: { bg: '#0B0B0B', fg: '#EADFB4', accent: '#C9A24B', accentFg: '#111', font: 'Georgia, serif', banner: 'Official Outlet · Worldwide shipping' } },
];
export const storeById = (id?: string) => STORES.find(s => s.id === id);
