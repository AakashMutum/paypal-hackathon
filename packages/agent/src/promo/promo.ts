import { z } from 'zod';

import type { Evidence } from '../types.js';
import type { IdFactory } from '../evidence/ids.js';
import type { LlmClient } from '../llm/client.js';
import { PROMO_SYSTEM, wrapUntrusted } from '../llm/prompts.js';

/**
 * Promotional and pressure language (PRD section 9: "evaluating promotional language").
 *
 * One model call reads the page's visible text, which the shield has already cleaned, and may
 * only pick tactics from a fixed list. No model-written text reaches the evidence: the summary is
 * built here from the picked tactics. The evidence is never deterministic, never higher than
 * medium, and has no scoring weight, so it cannot reach PAUSE or change a hard rule.
 */

export const PROMO_TACTICS = [
  'false_urgency',
  'scarcity_claim',
  'guarantee_claim',
  'pay_now_pressure',
  'discount_claim',
] as const;
export type PromoTactic = (typeof PROMO_TACTICS)[number];

export const PromoResponseSchema = z
  .object({ tactics: z.array(z.enum(PROMO_TACTICS)).max(PROMO_TACTICS.length) })
  .strict();

export const PROMO_TIMEOUT_MS = 6000;
export const PROMO_MAX_TOKENS = 120;
export const PROMO_TEXT_CHARS = 3000;
const MIN_TEXT_CHARS = 40;

const TACTIC_LABEL: Record<PromoTactic, string> = {
  false_urgency: 'urgency',
  scarcity_claim: 'scarcity claims',
  guarantee_claim: 'guarantee claims',
  pay_now_pressure: 'pressure to pay now',
  discount_claim: 'discount claims',
};

export interface PromoInput {
  visibleText: string | undefined;
  /** Evidence collected so far. Used to skip the call or drop tactics that are already covered. */
  existing: readonly Evidence[];
}

export interface PromoOptions {
  llm?: LlmClient;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PromoOutput {
  evidence: Evidence[];
  usedLlm: boolean;
  degraded: boolean;
}

const NONE: PromoOutput = { evidence: [], usedLlm: false, degraded: false };

/** Why the call is skipped, or undefined when it should run. */
export function promoSkipReason(input: PromoInput): string | undefined {
  const text = input.visibleText?.trim() ?? '';
  if (text.length < MIN_TEXT_CHARS) return 'no_text';
  // Page text that already tried to instruct the system is not a reliable thing to classify.
  if (input.existing.some((entry) => entry.type === 'INJECTION_ATTEMPT')) return 'injection_suspected';
  if (input.existing.some((entry) => entry.type === 'PROMOTIONAL_LANGUAGE')) return 'already_present';
  return undefined;
}

export async function assessPromotionalLanguage(
  input: PromoInput,
  ids: IdFactory,
  options: PromoOptions = {},
): Promise<PromoOutput> {
  try {
    if (!options.llm || promoSkipReason(input)) return NONE;

    const response = await options.llm.generateJson({
      tier: 'fast',
      system: PROMO_SYSTEM,
      user: [
        'List the pressure or promotional tactics used in the page text, using only the allowed names.',
        wrapUntrusted('page_text', (input.visibleText ?? '').slice(0, PROMO_TEXT_CHARS), PROMO_TEXT_CHARS + 200),
      ].join('\n'),
      schema: PromoResponseSchema,
      schemaName: 'PromotionalLanguage',
      maxOutputTokens: PROMO_MAX_TOKENS,
      timeoutMs: options.timeoutMs ?? PROMO_TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (!response.ok) return { evidence: [], usedLlm: true, degraded: true };
    // The client already validates, but this module does not rely on that: an answer that is not
    // exactly the allowed shape is discarded.
    const parsed = PromoResponseSchema.safeParse(response.data);
    if (!parsed.success) return { evidence: [], usedLlm: true, degraded: true };

    const priceAlreadyCovered = input.existing.some((entry) => entry.type === 'PRICE_DEVIATION');
    const tactics = [...new Set(parsed.data.tactics)].filter(
      (tactic) => !(tactic === 'discount_claim' && priceAlreadyCovered),
    );
    if (tactics.length === 0) return { evidence: [], usedLlm: true, degraded: false };

    const labels = tactics.map((tactic) => TACTIC_LABEL[tactic]).join(', ');
    return {
      evidence: [
        {
          id: ids.next('PROMOTIONAL_LANGUAGE'),
          type: 'PROMOTIONAL_LANGUAGE',
          severity: tactics.length >= 2 ? 'medium' : 'low',
          confidence: 0.5,
          summary: `The page uses pressure or promotional wording (${labels}). This is a model-assisted observation, not proof of fraud.`,
          source: 'llm',
          deterministic: false,
          data: { tactics },
        },
      ],
      usedLlm: true,
      degraded: false,
    };
  } catch {
    return { evidence: [], usedLlm: true, degraded: true };
  }
}
