import { createContext, ReactNode, useContext, useState } from 'react';
import type { CartItem } from '../types';
interface Ctx { storeId: string | null; items: CartItem[]; add: (storeId: string, item: CartItem) => void; clear: () => void }
const C = createContext<Ctx>(null as unknown as Ctx);
export const useCart = () => useContext(C);
export function CartProvider({ children }: { children: ReactNode }) {
  const [storeId, setStore] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const add = (s: string, item: CartItem) => { setStore(s); setItems(p => (s !== storeId ? [item] : [...p, item])); };
  return <C.Provider value={{ storeId, items, add, clear: () => { setItems([]); setStore(null); } }}>{children}</C.Provider>;
}
