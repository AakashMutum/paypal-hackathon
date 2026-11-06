import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { Toast } from '../components/ui';
type T = 'ok' | 'bad' | 'info';
interface Ctx { latestId: string | null; setLatestId: (id: string) => void; protection: boolean; setProtection: (b: boolean) => void; toast: (m: string, t?: T) => void }
const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);
const ls = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
export function OrderStateProvider({ children }: { children: ReactNode }) {
  const [latestId, _l] = useState<string | null>(ls('cg_latest'));
  const [protection, _p] = useState(ls('cg_protect') !== 'off');
  const [msg, setMsg] = useState<{ m: string; t: T } | null>(null);
  const toast = useCallback((m: string, t: T = 'info') => { setMsg({ m, t }); setTimeout(() => setMsg(null), 3200); }, []);
  const setLatestId = useCallback((id: string) => { _l(id); localStorage.setItem('cg_latest', id); }, []);
  const setProtection = (b: boolean) => { _p(b); localStorage.setItem('cg_protect', b ? 'on' : 'off'); };
  return <C.Provider value={{ latestId, setLatestId, protection, setProtection, toast }}>
    {children}
    {msg && <Toast message={msg.m} tone={msg.t} />}
  </C.Provider>;
}
