import type { Evidence, NodeId, SignalAvailability } from '../types';
import { fieldState, findingText, groupState, MARK_WORD } from '../lib/checks';
import { cn } from '../lib/format';
import { evidenceLabel, NODE_TITLE } from '../lib/labels';
import { StatusMark } from './ui';

const ORDER: NodeId[] = ['SURFACE', 'MERCHANT', 'PRICE', 'PAYEE'];
/** Each group appears this long after the one before it: four groups, 600 ms in all. */
export const REVEAL_STEP_MS = 150;

const NOT_RUN_WHY: Partial<Record<NodeId, string>> = {
  PRICE: 'No comparable price was available, so the price was not compared.',
  PAYEE: 'No receiving account was supplied, so nothing was compared with the storefront.',
};

/**
 * "What was checked": four areas as a ruled list. Each row has a status mark, a label and the
 * finding in wrapped text. A check that did not run says "Not checked" in a neutral style. With
 * reveal the groups appear one after another; the data is already complete, only its appearance is
 * staged, and reduced motion shows everything at once.
 */
export function CheckList({ evidence, availability, reveal }: { evidence: Evidence[]; availability?: SignalAvailability; reveal?: boolean }) {
  return <ol aria-label="What was checked" className="border-y border-line ruled">{ORDER.map((node, i) => {
    const e = evidence.find(x => x.node === node) ?? evidence[i];
    const state = e ? groupState(e, availability) : null;
    return <li key={node} className={cn('py-4', reveal && 'reveal')} style={reveal ? { animationDelay: `${i * REVEAL_STEP_MS}ms` } : undefined}>
      <div className="flex items-center gap-2">
        {state ? <StatusMark state={state} size={20} /> : <span className="w-5 h-5 shrink-0" aria-hidden="true" />}
        <h3 className="font-medium flex-1">{NODE_TITLE[node]}</h3>
        <span className="text-sm text-muted">{state ? MARK_WORD[state] : 'Waiting'}</span>
      </div>
      {e && state === 'none' && NOT_RUN_WHY[node] && <p className="text-sm text-muted mt-2 pl-7">{NOT_RUN_WHY[node]}</p>}
      {e && <dl className="mt-2 space-y-2 pl-7">{e.fields.map(f => {
        const fs = fieldState(f, state ?? 'info');
        const t = findingText(f);
        return <div key={f.label} className="grid grid-cols-[16px_minmax(0,1fr)] sm:grid-cols-[16px_minmax(0,12rem)_minmax(0,1fr)] gap-x-3 gap-y-0.5 items-start">
          <span className="mt-0.5"><StatusMark state={fs} /></span>
          <dt className="text-muted">{evidenceLabel(f.label)}</dt>
          <dd className={cn('col-start-2 sm:col-start-auto break-words [hyphens:none]', f.strike && 'line-through text-muted')}>
            {t.text}{t.detail && <span className="block text-xs text-muted">{t.detail}</span>}</dd>
        </div>;
      })}</dl>}
    </li>;
  })}</ol>;
}
