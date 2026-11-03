import type { Verdict } from '../types';

// The three canonical demo stores. They match tests/fixtures and the API catalog: same names,
// domains, products and prices. Every brand and domain is invented.
export interface Store {
  id: string; domain: string; name: string; kind: 'genuine' | 'suspicious' | 'impersonator'; tagline: string; expected: Verdict;
  product: { sku: string; name: string; price: number; msrp: number; blurb: string };
  theme: { bg: string; fg: string; accent: string; accentFg: string; font: string; banner: string };
}

export const STORES: Store[] = [
  { id: 'harborline-outfitters', domain: 'www.harborline-outfitters.example', name: 'Harborline Outfitters', kind: 'genuine', tagline: 'Honest gear for the open road.', expected: 'ALLOW',
    product: { sku: 'HBL-BAG-1', name: 'Canvas weekender bag', price: 84.5, msrp: 84.5, blurb: 'Waxed canvas, leather handles, fits a long weekend.' },
    theme: { bg: '#FFFFFF', fg: '#0F172A', accent: '#0E7490', accentFg: '#fff', font: 'Inter, sans-serif', banner: 'Free 30-day returns · Free shipping over $75' } },
  { id: 'bargainbarn-outlet', domain: 'www.bargainbarn-outlet.example', name: 'BARGAIN BARN OUTLET', kind: 'suspicious', tagline: 'LOWEST PRICES ANYWHERE!!!', expected: 'WARN',
    product: { sku: 'BBO-JKT-7', name: 'Insulated trail jacket', price: 39, msrp: 139, blurb: 'Warm, light, and priced to move. Only a few left at this price!' },
    theme: { bg: '#FFF7B8', fg: '#1a1a1a', accent: '#E11D48', accentFg: '#fff', font: 'Impact, Arial Black, sans-serif', banner: 'MEGA SALE · 72% OFF · ENDS TONIGHT' } },
  { id: 'harborlyne-outfitters-sale', domain: 'www.harborlyne-outfitters-sale.example', name: 'Harborlyne Outfitters Sale', kind: 'impersonator', tagline: 'Honest gear. Sale prices.', expected: 'PAUSE',
    product: { sku: 'HBL-BAG-1', name: 'Canvas weekender bag', price: 29, msrp: 84.5, blurb: 'Waxed canvas, leather handles. 66% off the usual price.' },
    theme: { bg: '#F8FAFC', fg: '#0F172A', accent: '#0E7490', accentFg: '#fff', font: 'Inter, sans-serif', banner: 'Official Outlet · Worldwide shipping' } },
];
export const storeById = (id?: string) => STORES.find(s => s.id === id);
