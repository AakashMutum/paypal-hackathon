import { FormEvent, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { MerchantRegistration, MerchantResult } from '../types';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import { Pill } from '../components/ui';
import { cn } from '../lib/format';
export default function Onboarding() {
  const { toast } = useApp();
  const [f, setF] = useState<MerchantRegistration>({ legalName: '', domain: '', paypalEmail: '', type: 'REGISTERED', country: 'US' });
  const [busy, setBusy] = useState(false); const [res, setRes] = useState<MerchantResult | null>(null);
  const set = (k: keyof MerchantRegistration) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: FormEvent) => { e.preventDefault(); setBusy(true); try { setRes(await api.registerMerchant(f)); toast('Merchant submitted for verification', 'ok'); } catch (err) { toast((err as Error).message, 'bad'); } finally { setBusy(false); } };
  return <>
    <section><h1 className="text-2xl font-bold">Verify a merchant</h1><p className="text-sm text-muted mt-1">Register a storefront so TrustOra can match its claims to its PayPal account.</p></section>
    <form onSubmit={submit} className="card space-y-4">
      {([['legalName', 'Legal business name', 'Example Trading Ltd'], ['domain', 'Storefront domain', 'example-trading.example'], ['paypalEmail', 'PayPal account email', 'payee@example-trading.example']] as const).map(([k, l, p]) => <div key={k}>
        <label htmlFor={k} className="mono-label">{l}</label><input id={k} required className="input mt-1" placeholder={p} value={f[k]} onChange={set(k)} type={k === 'paypalEmail' ? 'email' : 'text'} /></div>)}
      <div><span className="mono-label">Account type</span>
        <div className="mt-1 bg-canvas border border-ink/10 p-0.5 rounded-md grid grid-cols-2">{(['REGISTERED', 'INDIVIDUAL'] as const).map(t => <button type="button" key={t} onClick={() => setF({ ...f, type: t })} className={cn('py-2 rounded text-sm font-semibold', f.type === t ? 'bg-white shadow-l1' : 'text-muted')}>{t === 'REGISTERED' ? 'Registered business' : 'Individual'}</button>)}</div></div>
      <div><label htmlFor="c" className="mono-label">Country</label><select id="c" className="input mt-1" value={f.country} onChange={set('country')}>{['US', 'IN', 'GB', 'DE', 'HK', 'SG'].map(c => <option key={c}>{c}</option>)}</select></div>
      <button className="btn-primary w-full" disabled={busy}>{busy && <Loader2 size={16} className="animate-spin" />}Submit for verification</button>
    </form>
    {res && <div className="card flex items-center justify-between"><div><div className="mono-label">Merchant ID</div><div className="font-mono font-semibold">{res.merchantId}</div></div>
      <Pill tone={res.status === 'VERIFIED' ? 'ok' : 'warn'}>{res.status}</Pill></div>}
  </>;
}
