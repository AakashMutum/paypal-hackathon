import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ApiError, api, USE_MOCK } from '../api/apiClient';
import { Modal } from './ui';

/**
 * Resets the demo data. Against the live API it asks for the admin token, sends it as
 * x-demo-token with this one request, and never stores it (not in state beyond this dialog, not
 * in storage). A 403 is shown as a clear error.
 */
export function ResetDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.resetDemo(USE_MOCK ? undefined : token.trim() || undefined);
      setToken('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 403
        ? 'The admin token was not accepted. Check the token and try again.'
        : (err as Error).message);
    } finally { setBusy(false); }
  };
  return <Modal open onClose={onClose} title="Reset demo data">
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">This deletes every investigation, payment record and policy held by the demo. It cannot be undone.</p>
      {!USE_MOCK && <div className="space-y-1"><label htmlFor="admin-token" className="mono-label">Admin token</label>
        <input id="admin-token" type="password" autoComplete="off" className="input font-mono" value={token} onChange={e => setToken(e.target.value)} />
        <p className="text-xs text-muted">Sent with this one request and not stored. Leave empty only if the API has no token set.</p></div>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-danger flex-1" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={16} /> : null}Reset demo data</button></div>
    </form></Modal>;
}
