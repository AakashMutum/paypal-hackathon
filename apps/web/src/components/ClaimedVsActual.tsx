import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { Investigation } from '../types';
import { CLAIM_SENTENCE, claimMatch, type ClaimMatch } from '../lib/explain';
import { cn, money } from '../lib/format';
import { displayBrand } from '../lib/labels';
import { Icon } from './ui';

const CONNECTOR: Record<ClaimMatch, { word: string; glyph: typeof XCircle; text: string; edge: string }> = {
  MATCH: { word: 'MATCH', glyph: CheckCircle2, text: 'text-success', edge: 'border-success' },
  MISMATCH: { word: 'MISMATCH', glyph: XCircle, text: 'text-danger', edge: 'border-danger' },
  NOT_CHECKED: { word: 'NOT CHECKED', glyph: MinusCircle, text: 'text-muted', edge: 'border-line-strong' },
};

/**
 * The product's central idea in one picture: what the storefront says it is, what PayPal would
 * really pay, and whether the two agree. The connector says so with an icon and words, and only
 * from the investigation's own data.
 */
export function ClaimedVsActual({ inv, className }: { inv: Investigation; className?: string }) {
  const match = claimMatch(inv);
  const c = CONNECTOR[match];
  const done = inv.status === 'COMPLETE';
  return <section aria-label="Claimed versus actual" className={cn('cva', className)}><div className="cva-grid">
    <div className="card !p-4 space-y-1">
      <p className="text-sm font-medium text-muted">Storefront says</p>
      <p className="text-lg font-semibold break-words">{displayBrand(inv.claimedBrand, inv.domain)}</p>
      <p className="font-mono text-xs text-muted break-all">{inv.domain}</p>
      <p className="text-sm">{inv.productName}</p>
      <p className="font-mono text-sm num">{money(inv.price, inv.currency)}</p>
    </div>

    <div className="cva-mid" role="group" aria-label={`Result: ${c.word}`}>
      <span aria-hidden="true" className="cva-line" />
      <div className={cn('rounded-md border-2 bg-surface px-3 py-2 w-full', c.edge)}>
        <div className={cn('flex items-center justify-center gap-1.5 font-semibold text-sm', c.text)}><Icon icon={c.glyph} size={20} />{done ? c.word : 'CHECKING'}</div>
        <p className="text-xs text-muted mt-1">{done ? CLAIM_SENTENCE[match] : 'The check is still running.'}</p>
      </div>
      <span aria-hidden="true" className="cva-line" />
    </div>

    <div className={cn('card !p-4 space-y-1 border-2', done ? c.edge : 'border-line')}>
      <p className="text-sm font-medium text-muted">PayPal pays</p>
      <p className="text-lg font-semibold break-words">{inv.payeeName ?? 'Not supplied'}</p>
      <p className="font-mono text-xs text-muted break-all">{inv.payeeId ? `Merchant id ${inv.payeeId}` : 'No merchant id'}</p>
      <p className="text-sm">{inv.payeeTier ?? 'Account type not checked'}</p>
      <p className="text-xs text-muted">Account email: kept private, never shown</p>
    </div>
  </div></section>;
}
