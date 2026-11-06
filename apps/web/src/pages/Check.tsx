import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../api/apiClient';
import { useApp } from '../context/OrderStateContext';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { CaseVerdict } from '../components/CaseVerdict';
import { EmptyState, Icon, Skeleton, VerdictText, WakeNote } from '../components/ui';
import { STORES } from '../data/stores';
import { summaryCounts } from '../lib/checks';
import { money, softBreak } from '../lib/format';
import { displayBrand, formatDateTime, payeeDisplay } from '../lib/labels';
import { friendlyPaymentError } from '../lib/payment';

/** The API's message for a bad address, or a plain version of a network failure. */
export function scanErrorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string }).code;
  if (code === 'INVALID_URL') return message;
  const friendly = friendlyPaymentError(message);
  return friendly.title === 'Could not reach the server' ? `${friendly.title}. ${friendly.message}` : message;
}

function Summary({ list, loading }: { list: Parameters<typeof summaryCounts>[0]; loading: boolean }) {
  if (loading) return <Skeleton className="h-5 w-72" />;
  const c = summaryCounts(list);
  if (c.total === 0) return <p className="text-muted">No checks yet. Run one above or open a known case below.</p>;
  const parts = [`${c.total} ${c.total === 1 ? 'check' : 'checks'}`, `${c.cleared} allowed`];
  if (c.noFlags > 0) parts.push(`${c.noFlags} with no red flags (receiving account not checked)`);
  parts.push(`${c.review} need review`, `${c.held} held`);
  return <p className="text-muted num">{parts.join(' · ')}</p>;
}

/** Home: one question, one input, then the known cases and the latest checks as ruled lists. */
export default function Check() {
  usePageTitle('Check a website');
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const { setLatestId } = useApp();
  const { list, loading, error: listError } = useInvestigations(5000);
  const slow = useSlowLoading(loading);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ran = useRef<string | null>(null);

  const run = async (u: string) => {
    if (!u.trim()) { setError('Enter a website address to check.'); return; }
    setBusy(true); setError(null);
    try { const r = await api.scanUrl(u); setLatestId(r.id); nav(`/engine/${r.id}`, { state: { fresh: true } }); }
    catch (e) { setError(scanErrorText(e)); setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void run(url); };

  // /?check=<address> (from the command palette or a "Run" link) fills the field and runs once.
  const wanted = params.get('check');
  useEffect(() => {
    if (!wanted) { ran.current = null; return; }
    if (ran.current === wanted) return;
    ran.current = wanted;
    setUrl(wanted);
    setParams({}, { replace: true });
    void run(wanted);
  }, [wanted]);

  const latest = list.slice(0, 5);
  return <div className="space-y-12">
    <section className="max-w-2xl">
      <div>
        <h1>Who would this checkout really pay?</h1>
        <p className="mt-2 text-muted">Paste a store's address. TrustOra compares what the storefront says with the public records and the account that would be paid, before any money is captured.</p>
        <form onSubmit={submit} className="mt-6" noValidate>
          <label htmlFor="check-url" className="label block mb-1">Website address</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input id="check-url" className="input font-mono sm:flex-1 !h-11" placeholder="store-name.example" value={url} autoComplete="off" spellCheck={false}
              onChange={e => { setUrl(e.target.value); setError(null); }} aria-invalid={error ? true : undefined} aria-describedby={error ? 'check-error' : undefined} />
            <button className="btn-primary !h-11 sm:px-6" disabled={busy}>{busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" />Checking…</> : 'Check'}</button>
          </div>
          {error && <p id="check-error" role="alert" className="flex gap-2 text-sm text-danger mt-2"><Icon icon={AlertTriangle} size={16} className="shrink-0 mt-0.5" />{error}</p>}
          <p className="label mt-2">A check does not include a payee. The receiving account is compared at checkout, so a check on its own reads "no red flags", not "allowed".</p>
        </form>
        <div className="mt-6" aria-live="polite" aria-busy={loading}><Summary list={list} loading={loading} /></div>
        <WakeNote show={slow} />
        {listError && !loading && <p role="alert" className="text-sm text-danger mt-2">Could not load past checks: {listError}</p>}
      </div>
    </section>

    <section aria-labelledby="known-h">
      <div className="flex items-baseline justify-between gap-4"><h2 id="known-h" className="text-lg font-semibold">Known cases</h2><Link to="/stores" className="link text-sm">Demo stores</Link></div>
      <p className="text-muted text-sm mt-1">Three fictional stores with three different outcomes.</p>
      <ul className="ruled mt-3 border-y border-line">{STORES.map(s => <li key={s.id} className="grid gap-x-6 gap-y-1 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1.4fr)_auto] sm:items-center">
        <span className="font-mono text-sm break-words">{softBreak(s.domain)}</span>
        <span className="text-sm">{s.product.name} <span className="font-mono num text-muted">· {money(s.product.price)}</span></span>
        <span className="text-sm"><span className="label mr-1.5">Expected</span><VerdictText verdict={s.expected} /></span>
        <Link to={`/check?check=${encodeURIComponent(s.domain)}`} className="link text-sm sm:text-right">Run<span className="sr-only"> a check on {s.domain}</span></Link>
      </li>)}</ul>
    </section>

    <section aria-labelledby="latest-h">
      <div className="flex items-baseline justify-between gap-4"><h2 id="latest-h" className="text-lg font-semibold">Latest checks</h2><Link to="/investigations" className="link text-sm">All cases</Link></div>
      {loading ? <div className="mt-3 space-y-3" aria-busy="true"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        : latest.length === 0 ? <div className="mt-3"><EmptyState title="No checks yet">Run a check above, or open a known case. Every check is kept here as a case you can open again.</EmptyState></div>
          : <div className="mt-3 overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
            <caption className="sr-only">The latest five checks</caption>
            <thead><tr className="text-left label border-b border-line"><th scope="col" className="py-2 pr-4 font-normal">Domain</th><th scope="col" className="py-2 pr-4 font-normal">Claimed brand</th><th scope="col" className="py-2 pr-4 font-normal">Who gets paid</th><th scope="col" className="py-2 pr-4 font-normal">Result</th><th scope="col" className="py-2 font-normal text-right">Time</th></tr></thead>
            <tbody>{latest.map(i => <tr key={i.id} className="border-b border-line align-top">
              <td className="py-3 pr-4 font-mono break-words"><Link to={`/engine/${i.id}`} className="link">{softBreak(i.domain)}</Link></td>
              <td className="py-3 pr-4">{displayBrand(i.claimedBrand, i.domain)}</td>
              <td className="py-3 pr-4">{i.payeeName ?? <span className="text-muted">{payeeDisplay(null)}</span>}</td>
              <td className="py-3 pr-4"><CaseVerdict inv={i} /></td>
              <td className="py-3 text-right text-muted num whitespace-nowrap"><time dateTime={i.createdAt}>{formatDateTime(i.createdAt)}</time></td>
            </tr>)}</tbody></table></div>}
    </section>
  </div>;
}
