import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, ScanLine, Store, ChevronRight } from 'lucide-react';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import { STORES } from '../data/stores';
import { useHealth } from '../components/Provenance';
export default function Scanner() {
  const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false);
  const nav = useNavigate(); const { setLatestId, toast } = useApp(); const { health } = useHealth();
  const replayOnly = health?.modes?.signals === 'replay';
  const run = async (u: string) => {
    if (!u.trim()) { toast('Enter a website address to scan', 'bad'); return; }
    setBusy(true);
    try { const inv = await api.scanUrl(u); setLatestId(inv.id); nav(`/engine/${inv.id}`); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); run(url); };
  return <>
    <section><h1 className="text-2xl font-bold">Scan a storefront</h1><p className="text-sm text-muted mt-1">Check whether a website's claims match the account that would receive your money.</p></section>
    <form onSubmit={submit} className="card space-y-3">
      <label htmlFor="u" className="mono-label">Website address</label>
      <input id="u" className="input font-mono" placeholder="store-name.example" value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" />
      <button className="btn-direct w-full" disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" />Scanning…</> : <><ScanLine size={16} />Scan URL</>}</button>
    </form>
    {replayOnly && <p className="card text-sm" role="note">This API replays recorded signals, so only the demo stores below can be checked properly. Unknown domains need live signals and will not be cleared.</p>}
    <section className="card"><h2 className="font-semibold mb-3">Try a demo target</h2>
      <div className="flex flex-wrap gap-2">{STORES.map(s => <button key={s.id} disabled={busy} className="btn-secondary !h-9 font-mono text-xs" onClick={() => { setUrl(s.domain); run(s.domain); }}>{s.domain}</button>)}</div></section>
    <Link to="/stores" className="card flex items-center gap-3 hover:shadow-l2"><Store className="text-electric" /><div className="flex-1"><div className="font-semibold">Open demo storefronts</div><div className="text-sm text-muted">Buy from the genuine, suspicious and impersonator stores.</div></div><ChevronRight size={18} /></Link>
  </>;
}
