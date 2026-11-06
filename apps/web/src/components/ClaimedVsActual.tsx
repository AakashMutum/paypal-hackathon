import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { Investigation } from '../types';
import { payeeNotChecked } from '../lib/checks';
import { CLAIM_SENTENCE, claimMatch, type ClaimMatch } from '../lib/explain';
import { cn, money, softBreak } from '../lib/format';
import { displayBrand, payeeDisplay } from '../lib/labels';
import { Icon } from './ui';

const CONNECTOR: Record<ClaimMatch, { word: string; glyph: typeof XCircle; mark: string }> = {
  MATCH: { word: 'MATCH', glyph: CheckCircle2, mark: 'text-success' },
  MISMATCH: { word: 'MISMATCH', glyph: XCircle, mark: 'text-danger' },
  NOT_CHECKED: { word: 'NOT CHECKED', glyph: MinusCircle, mark: 'text-muted' },
};

/**
 * The product's central idea in one picture: what the storefront says it is, what PayPal would
 * really pay, and whether the two agree. The connector says so with a mark and words, and only
 * from the investigation's own data. No cards: two plain columns and a rule between them.
 */
export function ClaimedVsActual({ inv, className }: { inv: Investigation; className?: string }) {
  const match = claimMatch(inv);
  const c = CONNECTOR[match];
  const done = inv.status === 'COMPLETE';
  const noPayee = payeeNotChecked(inv);
  return <section aria-label="Claimed versus actual" className={cn('cva', className)}><div className="cva-grid">
    <div className="space-y-0.5 min-w-0">
      <p className="label">Storefront says</p>
      <p className="text-xl font-semibold break-words">{displayBrand(inv.claimedBrand, inv.domain)}</p>
      <p className="font-mono text-xs text-muted break-words">{softBreak(inv.domain)}</p>
      <p className="pt-1">{inv.productName}</p>
      <p className="font-mono num">{money(inv.price, inv.currency)}</p>
    </div>

    <div className="cva-mid" role="group" aria-label={`Result: ${done ? c.word : 'checking'}`}>
      <span aria-hidden="true" className="cva-line" />
      <div className="px-2">
        <div className="flex items-center justify-center gap-1.5 font-semibold text-sm"><span className={c.mark}><Icon icon={c.glyph} size={20} /></span>{done ? c.word : 'CHECKING'}</div>
        <p className="text-xs text-muted mt-1 max-w-[18rem] mx-auto">{done ? CLAIM_SENTENCE[match] : 'The check is still running.'}</p>
      </div>
      <span aria-hidden="true" className="cva-line" />
    </div>

    <div className="space-y-0.5 min-w-0">
      <p className="label">PayPal pays</p>
      <p className="text-xl font-semibold break-words">{payeeDisplay(inv.payeeName)}</p>
      <p className="font-mono text-xs text-muted break-all">{noPayee ? 'A website check has no receiving account' : inv.payeeId ? `Merchant id ${inv.payeeId}` : 'No merchant id'}</p>
      <p className="pt-1">{noPayee ? 'Compared when you pay' : inv.payeeTier ?? 'Account type not checked'}</p>
      <p className="text-xs text-muted">The account email is never shown.</p>
    </div>
  </div></section>;
}
