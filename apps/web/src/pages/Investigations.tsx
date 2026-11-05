import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Search, X } from 'lucide-react';
import type { Investigation } from '../types';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { CaseVerdict } from '../components/CaseVerdict';
import { ClaimedVsActual } from '../components/ClaimedVsActual';
import { EmptyState, Icon, Skeleton, StatusMark, WakeNote } from '../components/ui';
import { decisionSentence, groupState, MARK_WORD } from '../lib/checks';
import { cn, download, softBreak } from '../lib/format';
import { displayBrand, formatDateTime, NODE_TITLE } from '../lib/labels';
import { fundsStatement } from '../lib/payment';

export const PAGE_SIZE = 25;
const SEGMENTS = [
  { value: 'ALL', label: 'All' }, { value: 'ALLOW', label: 'Cleared' }, { value: 'WARN', label: 'Needs review' }, { value: 'PAUSE', label: 'Held' },
] as const;
type SortKey = 'domain' | 'brand' | 'payee' | 'verdict' | 'time';
const VERDICT_RANK = { PAUSE: 3, WARN: 2, ALLOW: 1 } as const;

const sortValue = (i: Investigation, k: SortKey): string | number => {
  switch (k) {
    case 'domain': return i.domain;
    case 'brand': return displayBrand(i.claimedBrand, i.domain).toLowerCase();
    case 'payee': return (i.payeeName ?? '').toLowerCase();
    case 'verdict': return i.verdict ? VERDICT_RANK[i.verdict] : 0;
    default: return Date.parse(i.createdAt) || 0;
  }
};

/** The inspector drawer: a summary of one case with a link to the full case file. */
function Inspector({ inv, onClose }: { inv?: Investigation; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (inv && !d.open) d.showModal();
    if (!inv && d.open) d.close();
  }, [inv]);
  return <dialog ref={ref} aria-label={inv ? `Case ${inv.id}` : 'Case'} onClose={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}
    className="drawer m-0 ml-auto h-full max-h-none w-[480px] max-w-full border-l border-line bg-surface p-0 text-content shadow-l2">
    {inv && <div className="p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="label font-mono">Case {inv.id}</p><h2 className="font-mono text-base font-semibold break-words">{softBreak(inv.domain)}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-3"><CaseVerdict inv={inv} /><time dateTime={inv.createdAt} className="text-muted num">{formatDateTime(inv.createdAt)}</time></div></div>
        <button type="button" onClick={onClose} aria-label="Close case summary" className="h-9 w-9 shrink-0 grid place-items-center rounded hover:bg-surface-2"><Icon icon={X} /></button>
      </div>
      <p>{decisionSentence(inv)}</p>
      <ClaimedVsActual inv={inv} />
      <ul className="ruled border-y border-line" aria-label="Checks">{inv.evidence.map(e => { const s = groupState(e, inv.signalAvailability);
        return <li key={e.id} className="py-2 flex items-center gap-2"><StatusMark state={s} /><span className="flex-1">{NODE_TITLE[e.node]}</span><span className="text-muted text-sm">{MARK_WORD[s]}</span></li>; })}</ul>
      <p className="text-sm text-muted">{inv.orderId ? fundsStatement(inv.captureState).text : 'This was a check only. No payment was started.'}</p>
      <div className="flex flex-wrap gap-4"><Link to={`/engine/${inv.id}`} className="btn-primary">Open full case</Link>
        {inv.orderId && <Link to={`/pay/${inv.id}`} className="btn-secondary">Open payment</Link>}</div>
    </div>}
  </dialog>;
}

/** Every case in one table, with filters and sortable columns. A row opens an inspector drawer. */
export default function Investigations() {
  usePageTitle('Cases');
  const { id } = useParams();
  const nav = useNavigate();
  const { list, loading, error } = useInvestigations(3000);
  const slow = useSlowLoading(loading);
  const [seg, setSeg] = useState<typeof SEGMENTS[number]['value']>('ALL');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'time', dir: -1 });
  const lastOpened = useRef<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const kept = list.filter(i => (seg === 'ALL' || i.verdict === seg) && (!needle || (i.domain + ' ' + i.claimedBrand + ' ' + (i.payeeName ?? '') + ' ' + i.id).toLowerCase().includes(needle)));
    return [...kept].sort((a, b) => { const x = sortValue(a, sort.key), y = sortValue(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [list, seg, q, sort]);
  const visible = rows.slice(0, shown);
  const open = id ? list.find(i => i.id === id) : undefined;

  const openCase = (i: Investigation) => { lastOpened.current = i.id; nav(`/investigations/${i.id}`); };
  const closeCase = () => {
    if (!id) return;
    nav('/investigations');
    const back = lastOpened.current;
    // Focus goes back to the row that opened the drawer.
    if (back) window.setTimeout(() => document.querySelector<HTMLElement>(`[data-case="${CSS.escape(back)}"]`)?.focus(), 0);
  };
  const th = (key: SortKey, label: string, right?: boolean) => <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('py-2 pr-4 font-normal', right && 'text-right')}>
    <button type="button" className="inline-flex items-center gap-1 hover:text-content" onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'time' || key === 'verdict' ? -1 : 1 }))}>
      {label}{sort.key === key && <Icon icon={sort.dir === 1 ? ArrowUp : ArrowDown} size={16} />}</button></th>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1>Cases</h1><p className="text-muted mt-1">Every check and every checkout, newest first.</p></div>
      <button type="button" className="tbtn" onClick={() => download('trustora-cases.json', rows)} disabled={!rows.length}><Icon icon={Download} size={16} />Export</button></div>

    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-md border border-line-strong p-0.5" role="group" aria-label="Filter by decision">{SEGMENTS.map(s =>
        <button key={s.value} type="button" aria-pressed={seg === s.value} onClick={() => { setSeg(s.value); setShown(PAGE_SIZE); }}
          className={cn('px-3 h-8 rounded text-sm font-medium', seg === s.value ? 'bg-action text-action-on' : 'text-muted hover:text-content')}>{s.label}</button>)}</div>
      <div className="relative flex-1 min-w-[200px] max-w-md"><Icon icon={Search} size={16} className="absolute left-3 top-3 text-muted" />
        <input className="input pl-9" placeholder="Search domain, brand or payee" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE_SIZE); }} aria-label="Search cases" /></div>
      <span className="label num" aria-live="polite">{loading ? '' : `${rows.length} ${rows.length === 1 ? 'case' : 'cases'}`}</span>
    </div>

    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="text-sm text-danger">Could not load cases: {error}</p>}
    {loading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      : !rows.length ? <EmptyState title="No cases match">Try another filter, or <Link className="link" to="/">check a website</Link>.</EmptyState>
        : <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
          <caption className="sr-only">Cases. Choose a domain to open a summary.</caption>
          <thead><tr className="text-left label border-b border-line">{th('domain', 'Domain')}{th('brand', 'Claimed brand')}{th('payee', 'Who gets paid')}{th('verdict', 'Decision')}{th('time', 'Time', true)}</tr></thead>
          <tbody>{visible.map(i => <tr key={i.id} aria-selected={id === i.id} onClick={() => openCase(i)} className={cn('border-b border-line align-top cursor-pointer hover:bg-surface-2', id === i.id && 'bg-surface-2')}>
            <td className="py-3 pr-4 font-mono break-words"><button type="button" data-case={i.id} onClick={e => { e.stopPropagation(); openCase(i); }} className="text-left hover:underline underline-offset-2">{softBreak(i.domain)}</button></td>
            <td className="py-3 pr-4">{displayBrand(i.claimedBrand, i.domain)}</td>
            <td className="py-3 pr-4">{i.payeeName ?? <span className="text-muted">Not supplied</span>}</td>
            <td className="py-3 pr-4"><CaseVerdict inv={i} /></td>
            <td className="py-3 text-right text-muted num whitespace-nowrap"><time dateTime={i.createdAt}>{formatDateTime(i.createdAt)}</time></td>
          </tr>)}</tbody></table></div>}
    {rows.length > visible.length && <button type="button" className="btn-secondary" onClick={() => setShown(n => n + PAGE_SIZE)}>Load more ({rows.length - visible.length} more)</button>}

    <Inspector inv={open} onClose={closeCase} />
  </div>;
}
