import { z } from 'zod';

import { LOOKUP_BY, SECTION_HINTS } from '../tools/catalog.js';

/**
 * The investigator protocol.
 *
 * Every object is `.strict()`, so a reply that adds `decision` or `score` is
 * invalid rather than silently accepted (invariant I2). The call list accepts up
 * to ten entries so an eager model does not lose the whole turn; the loop only
 * ever executes the first three and never exceeds the investigation budget.
 */

export const SHORT_REASON = z.string().min(3).max(140);

export const ToolCallSchema = z.discriminatedUnion('tool', [
  z
    .object({
      tool: z.literal('lookup_registry'),
      input: z.object({ by: z.enum(LOOKUP_BY), query: z.string().min(2).max(120) }).strict(),
      why: SHORT_REASON,
    })
    .strict(),
  z
    .object({
      tool: z.literal('fetch_page_section'),
      input: z.object({ hint: z.enum(SECTION_HINTS) }).strict(),
      why: SHORT_REASON,
    })
    .strict(),
  z
    .object({
      tool: z.literal('compare_offers'),
      input: z
        .object({ productQuery: z.string().min(3).max(120), maxPrice: z.number().positive().optional() })
        .strict(),
      why: SHORT_REASON,
    })
    .strict(),
  z
    .object({
      tool: z.literal('get_domain_report'),
      input: z.object({ domain: z.string().min(3).max(120) }).strict(),
      why: SHORT_REASON,
    })
    .strict(),
]);

export const TurnSchema = z.union([
  z
    .object({
      action: z.literal('call_tools'),
      calls: z.array(ToolCallSchema).min(1).max(10),
    })
    .strict(),
  z.object({ action: z.literal('finish'), why: SHORT_REASON }).strict(),
]);

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type Turn = z.infer<typeof TurnSchema>;

export const MAX_CALLS_PER_TURN = 3;
export const MAX_TURNS = 4;
