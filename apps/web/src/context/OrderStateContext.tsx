import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
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
  const Icon = msg?.t === 'ok' ? CheckCircle2 : msg?.t === 'bad' ? AlertTriangle : Info;
  return <C.Provider value={{ latestId, setLatestId, protection, setProtection, toast }}>
    {children}
    {msg && <div role="status" className="fixed z-[60] bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-navy text-white text-sm px-4 py-2.5 rounded-lg shadow-l3"><Icon size={16} />{msg.m}</div>}
  </C.Provider>;
}
