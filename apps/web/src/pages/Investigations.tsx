import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import type { Investigation } from '../types';
import { useInvestigations } from '../hooks/useOrderPolling';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSlowLoading } from '../hooks/useSlowLoading';
import { CaseVerdict } from '../components/CaseVerdict';
import { EmptyState, Icon, Skeleton, WakeNote } from '../components/ui';
import { cn, download, softBreak } from '../lib/format';
import { displayBrand, formatDateTime } from '../lib/labels';

export const PAGE_SIZE = 25;
const SEGMENTS = [
  { value: 'ALL', label: 'All' }, { value: 'ALLOW', label: 'Allowed' }, { value: 'WARN', label: 'Needs review' }, { value: 'PAUSE', label: 'Held' },
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

/** Every case in one plain table, with filters and sortable columns. A row opens the case page. */
export default function Investigations() {
  usePageTitle('Cases');
  const nav = useNavigate();
  const { list, loading, error } = useInvestigations(3000);
  const slow = useSlowLoading(loading);
  const [seg, setSeg] = useState<typeof SEGMENTS[number]['value']>('ALL');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'time', dir: -1 });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const kept = list.filter(i => (seg === 'ALL' || i.verdict === seg) && (!needle || (i.domain + ' ' + i.claimedBrand + ' ' + (i.payeeName ?? '') + ' ' + i.id).toLowerCase().includes(needle)));
    return [...kept].sort((a, b) => { const x = sortValue(a, sort.key), y = sortValue(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  }, [list, seg, q, sort]);
  const visible = rows.slice(0, shown);

  const th = (key: SortKey, label: string, right?: boolean) => <th scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'} className={cn('py-2 pr-4 font-normal', right && 'text-right')}>
    <button type="button" className="inline-flex items-center gap-1 hover:text-content" onClick={() => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'time' || key === 'verdict' ? -1 : 1 }))}>
      {label}{sort.key === key && <Icon icon={sort.dir === 1 ? ArrowUp : ArrowDown} size={16} />}</button></th>;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1>Cases</h1><p className="text-muted mt-1">Every check and every checkout, newest first.</p></div>
      <button type="button" className="tbtn" onClick={() => download('trustora-cases.json', rows)} disabled={!rows.length}><Icon icon={Download} size={16} />Export</button></div>

    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-full border border-line-strong p-0.5" role="group" aria-label="Filter by result">{SEGMENTS.map(s =>
        <button key={s.value} type="button" aria-pressed={seg === s.value} onClick={() => { setSeg(s.value); setShown(PAGE_SIZE); }}
          className={cn('px-4 h-9 rounded-full text-sm font-medium', seg === s.value ? 'bg-action text-action-on' : 'text-muted hover:text-content')}>{s.label}</button>)}</div>
      <div className="relative flex-1 min-w-[200px] max-w-md"><Icon icon={Search} size={16} className="absolute left-3.5 top-3.5 text-muted" />
        <input className="input pl-10" placeholder="Search domain, brand or payee" value={q} onChange={e => { setQ(e.target.value); setShown(PAGE_SIZE); }} aria-label="Search cases" /></div>
      <span className="label num" aria-live="polite">{loading ? '' : `${rows.length} ${rows.length === 1 ? 'case' : 'cases'}`}</span>
    </div>

    <WakeNote show={slow} />
    {error && !loading && <p role="alert" className="text-sm text-danger">Could not load cases: {error}</p>}
    {loading ? <div className="space-y-3" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
      : !rows.length ? <EmptyState title="No cases match">Try another filter, or <Link className="link" to="/check">check a website</Link>.</EmptyState>
        : <div className="overflow-x-auto"><table className="w-full text-[15px] min-w-[760px]">
          <caption className="sr-only">Cases. Choose a domain to open the case.</caption>
          <thead><tr className="text-left label border-b border-line">{th('domain', 'Domain')}{th('brand', 'Claimed brand')}{th('payee', 'Who gets paid')}{th('verdict', 'Result')}{th('time', 'Time', true)}</tr></thead>
          <tbody>{visible.map(i => <tr key={i.id} onClick={() => nav(`/engine/${i.id}`)} className="border-b border-line align-top cursor-pointer hover:bg-surface-2">
            <td className="py-3 pr-4 font-mono break-words"><Link to={`/engine/${i.id}`} onClick={e => e.stopPropagation()} className="link">{softBreak(i.domain)}</Link></td>
            <td className="py-3 pr-4">{displayBrand(i.claimedBrand, i.domain)}</td>
            <td className="py-3 pr-4">{i.payeeName ?? <span className="text-muted">Not supplied</span>}</td>
            <td className="py-3 pr-4"><CaseVerdict inv={i} /></td>
            <td className="py-3 text-right text-muted num whitespace-nowrap"><time dateTime={i.createdAt}>{formatDateTime(i.createdAt)}</time></td>
          </tr>)}</tbody></table></div>}
    {rows.length > visible.length && <button type="button" className="btn-secondary" onClick={() => setShown(n => n + PAGE_SIZE)}>Load more ({rows.length - visible.length} more)</button>}
  </div>;
}
