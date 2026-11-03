import type { Listing } from './marketplace.js';
import type { GuardianClient, GuardianVerdict, HumanPrompt } from './shopper.js';

/**
 * A deterministic shopper that needs no language model. It follows the same safe rules a model
 * is prompted to follow, so the demo runs for all three stores without any API key:
 *
 *   1. investigate every listing before doing anything else;
 *   2. ALLOW: hold an order, ask the human to approve it, then finalize;
 *   3. WARN: hold an order, ask the human, and finalize with their decision (proceed or abort);
 *   4. PAUSE: stop. The agent does not pay.
 */

export type ScriptedAction =
  | 'PAID'
  | 'PAUSED'
  | 'HUMAN_PROCEEDED'
  | 'HUMAN_DECLINED'
  | 'HUMAN_DECLINED_PAYMENT'
  | 'OVER_BUDGET'
  | 'ERROR';

export interface ScriptedStoreResult {
  listingId: string;
  title: string;
  merchant: string;
  action: ScriptedAction;
  decision?: GuardianVerdict['decision'];
  score?: number;
  summary?: string;
  checkoutStatus?: string;
  captureId?: string;
  detail?: string;
}

export interface ScriptedOptions {
  listings: Listing[];
  guardian: GuardianClient;
  budget: number;
  autoHuman: 'ask' | 'yes' | 'no';
  humanPrompt?: HumanPrompt;
  write?: (line: string) => void;
}

export async function runScriptedShopper(options: ScriptedOptions): Promise<ScriptedStoreResult[]> {
  const write = options.write ?? ((line: string) => console.log(line));
  const results: ScriptedStoreResult[] = [];

  const ask = async (question: Parameters<HumanPrompt>[0]): Promise<boolean> => {
    if (options.autoHuman === 'yes') return true;
    if (options.autoHuman === 'no') return false;
    if (!options.humanPrompt) return false;
    return options.humanPrompt(question);
  };

  for (const listing of options.listings) {
    const base = { listingId: listing.id, title: listing.title, merchant: listing.merchant };
    write('');
    write(`== ${listing.title}`);
    write(`   seller ${listing.merchant}, ${listing.price} ${listing.currency}, ${listing.url}`);

    if (listing.price > options.budget) {
      write(`   Over budget (${options.budget} ${listing.currency}). The agent skips it.`);
      results.push({ ...base, action: 'OVER_BUDGET' });
      continue;
    }

    try {
      write('   1. The agent checks the merchant with Guardian before doing anything else.');
      const verdict = await options.guardian.investigate(listing);
      write(`   2. Guardian says ${verdict.decision} (risk ${verdict.score}). ${verdict.summary ?? ''}`.trimEnd());
      const known = { ...base, decision: verdict.decision, score: verdict.score, summary: verdict.summary };

      if (verdict.decision === 'PAUSE') {
        write('   3. The agent stops. It does not pay this seller.');
        results.push({ ...known, action: 'PAUSED' });
        continue;
      }

      const held = await options.guardian.startCheckout(listing);
      write(`   3. The agent holds the order (${held.checkoutId}, ${held.status}). Nothing is captured yet.`);

      if (verdict.decision === 'WARN') {
        const proceed = await ask({ kind: 'warn', listingId: listing.id, title: listing.title, amount: listing.price, currency: listing.currency, verdict });
        write(`   4. Guardian warned, so a human decides: ${proceed ? 'proceed' : 'decline'}.`);
        const finalized = await options.guardian.finalizeCheckout(held.checkoutId, {
          approvedByHuman: true,
          humanDecision: proceed ? 'proceed' : 'abort',
        });
        write(`   5. Result: ${finalized.status}${finalized.captureId ? ` (${finalized.captureId})` : ''}.`);
        results.push({ ...known, action: proceed ? 'HUMAN_PROCEEDED' : 'HUMAN_DECLINED', checkoutStatus: finalized.status, captureId: finalized.captureId });
        continue;
      }

      const approved = await ask({ kind: 'proceed', listingId: listing.id, title: listing.title, amount: listing.price, currency: listing.currency, verdict });
      if (!approved) {
        write('   4. The human did not approve the payment. The agent does not finalize.');
        results.push({ ...known, action: 'HUMAN_DECLINED_PAYMENT', checkoutStatus: held.status });
        continue;
      }
      write('   4. The human approved the payment.');
      const finalized = await options.guardian.finalizeCheckout(held.checkoutId, { approvedByHuman: true, humanDecision: 'proceed' });
      write(`   5. Result: ${finalized.status}${finalized.captureId ? ` (${finalized.captureId})` : ''}.`);
      results.push({ ...known, action: finalized.status === 'CAPTURED' ? 'PAID' : 'ERROR', checkoutStatus: finalized.status, captureId: finalized.captureId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      write(`   The agent could not finish this purchase: ${detail}`);
      results.push({ ...base, action: 'ERROR', detail });
    }
  }
  return results;
}

export function summarizeScripted(results: ScriptedStoreResult[]): string[] {
  const label: Record<ScriptedAction, string> = {
    PAID: 'paid',
    PAUSED: 'paused, did not pay',
    HUMAN_PROCEEDED: 'warned, human proceeded',
    HUMAN_DECLINED: 'warned, human declined',
    HUMAN_DECLINED_PAYMENT: 'human did not approve the payment',
    OVER_BUDGET: 'skipped, over budget',
    ERROR: 'error',
  };
  return results.map((r) => `${r.title}: ${r.decision ?? 'not checked'} -> ${label[r.action]}`);
}
