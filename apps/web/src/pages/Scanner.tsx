import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ScanLine, AlertTriangle } from 'lucide-react';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import { useOrderPolling } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { STORES } from '../data/stores';
import { useHealth } from '../components/Provenance';
import { InvestigationView } from '../components/InvestigationView';
import { Icon } from '../components/ui';
import { friendlyPaymentError } from '../lib/payment';
import { VERDICT_WORDS } from '../lib/labels';

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
  const [scanId, setScanId] = useState<string | undefined>();
  const { setLatestId } = useApp(); const { health } = useHealth();
  const { inv } = useOrderPolling(scanId);
  const replayOnly = health?.modes?.signals === 'replay';

  const run = async (u: string) => {
    if (!u.trim()) { setError('Enter a website address to scan.'); return; }
    setBusy(true); setError(null); setScanId(undefined);
    try { const r = await api.scanUrl(u); setLatestId(r.id); setScanId(r.id); }
    catch (e) { setError(scanErrorText(e)); } finally { setBusy(false); }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); void run(url); };

  return <div className="max-w-3xl mx-auto space-y-8">
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">Scan a storefront</h1>
      <p className="text-sm text-muted">Check whether a website's claims match the account that would receive your money.</p>
    </section>

    <form onSubmit={submit} className="card xl space-y-4" noValidate>
      <label htmlFor="scan-url" className="mono-label block">Website address</label>
      <div className="relative">
        <input id="scan-url" className="input pl-10 font-mono" placeholder="store-name.example" value={url}
          onChange={e => { setUrl(e.target.value); setError(null); }} autoComplete="off"
          aria-invalid={error ? true : undefined} aria-describedby={error ? 'scan-error' : undefined} />
        <Icon icon={ScanLine} size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
      {error && <p id="scan-error" role="alert" className="flex gap-2 items-start text-sm text-danger border-bad/40 p-3 rounded-lg bg-bad-bg"><Icon icon={AlertTriangle} size={16} className="shrink-0 mt-0.5" />{error}</p>}
      <div className="flex items-center justify-between pt-2">
        <button className="btn-primary" disabled={busy}>
          {busy ? <><Loader2 size={16} className="animate-spin mr-2" aria-hidden="true" />Scanning…</> : <><Icon icon={ScanLine} size={16} className="mr-2" />Scan</>}</button>
        <div className="flex items-center gap-1"><span className="text-xs text-muted">Try:</span>
          {STORES.map(s => <button key={s.id} type="button" disabled={busy} className="btn-secondary !h-8 !px-3 font-mono text-xs min-w-[80px]" onClick={() => { setUrl(s.domain); void run(s.domain); }}>{s.domain.replace(/^www\./, '')}</button>)}</div>
      </div>
    </form>

    {replayOnly && <p className="card text-sm border-warning/40 border bg-warn-bg p-4" role="note">
      This server replays recorded signals, so only the demo stores can be checked properly. Other sites are not cleared.</p>}

    {inv && <section aria-label="Scan result" className="space-y-4">
      <div className="card xl flex flex-wrap items-center justify-between gap-4 p-6">
        <div className="min-w-0"><h2 className="font-bold break-all">{inv.domain}</h2>
          <p className="text-sm text-muted">{inv.status === 'COMPLETE' && inv.verdict ? VERDICT_WORDS[inv.verdict].meaning : 'Collecting evidence…'}</p></div>
        {inv.status === 'COMPLETE' && <VerdictBadge verdict={inv.verdict} />}</div>
      <InvestigationView inv={inv} reveal />
    </section>}

    {!inv && !busy && <div className="card xl text-center p-12"><p className="text-sm text-muted">Or <Link className="text-action underline" to="/stores">buy from a demo store</Link> to see the whole flow, including the payment.</p></div>}
  </div>;
}

import { VerdictBadge } from '../components/ui';
