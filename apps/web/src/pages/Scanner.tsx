import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, ScanLine, Store, ChevronRight, AlertTriangle } from 'lucide-react';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import { usePageTitle } from '../hooks/usePageTitle';
import { STORES } from '../data/stores';
import { useHealth } from '../components/Provenance';
import { friendlyPaymentError } from '../lib/payment';

/** The API's message for a bad address, or a plain version of a network failure. */
function scanErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string }).code;
  if (code === 'INVALID_URL') return message;
  const friendly = friendlyPaymentError(message);
  return friendly.title === 'Could not reach the server' ? `${friendly.title}. ${friendly.message}` : message;
}

export default function Scanner() {
  usePageTitle('Scan');
  const [url, setUrl] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const nav = useNavigate(); const { setLatestId } = useApp(); const { health } = useHealth();
  const replayOnly = health?.modes?.signals === 'replay';
  const run = async (u: string) => {
    if (!u.trim()) { setError('Enter a website address to scan.'); return; }
    setBusy(true); setError(null);
    try { const inv = await api.scanUrl(u); setLatestId(inv.id); nav(`/engine/${inv.id}`); }
    catch (e) { setError(scanErrorText(e)); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void run(url); };
  return <>
    <section><h1 className="text-2xl font-bold">Scan a storefront</h1><p className="text-sm text-muted mt-1">Check whether a website's claims match the account that would receive your money.</p></section>
    <form onSubmit={submit} className="card space-y-3" noValidate>
      <label htmlFor="u" className="mono-label">Website address</label>
      <input id="u" className="input font-mono" placeholder="store-name.example" value={url} onChange={e => { setUrl(e.target.value); setError(null); }} autoComplete="off" aria-invalid={error ? true : undefined} aria-describedby={error ? 'scan-error' : undefined} />
      {error && <p id="scan-error" role="alert" className="flex gap-2 text-sm text-bad"><AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{error}</p>}
      <button className="btn-direct w-full" disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Scanning…</> : <><ScanLine size={16} aria-hidden="true" />Scan URL</>}</button>
    </form>
    {replayOnly && <p className="card text-sm" role="note">This API replays recorded signals, so only the demo stores below can be checked properly. Unknown domains need live signals and will not be cleared.</p>}
    <section className="card"><h2 className="font-semibold mb-3">Try a demo target</h2>
      <div className="flex flex-wrap gap-2">{STORES.map(s => <button key={s.id} disabled={busy} className="btn-secondary !h-9 font-mono text-xs" onClick={() => { setUrl(s.domain); void run(s.domain); }}>{s.domain}</button>)}</div></section>
    <Link to="/stores" className="card flex items-center gap-3 hover:shadow-l2"><Store className="text-electric" aria-hidden="true" /><div className="flex-1"><div className="font-semibold">Open demo storefronts</div><div className="text-sm text-muted">Buy from the genuine, suspicious and impersonator stores.</div></div><ChevronRight size={18} aria-hidden="true" /></Link>
  </>;
}
