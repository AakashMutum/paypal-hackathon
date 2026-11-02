import { randomUUID } from 'node:crypto';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { GuardianApiClient } from '../apiClient.js';
import { errorResult, formatVerdict, normalizeVerdict, toolResult } from '../format.js';
import { isSafePublicUrl } from '../security/publicUrl.js';

export const InvestigateMerchantInputSchema = z.object({
  merchantUrl: z
    .string()
    .url()
    .max(2048)
    .refine(isSafePublicUrl, { message: 'merchantUrl must be a public http(s) address' }),
  claimedBrand: z.string().min(1).max(80).optional(),
  amount: z.number().positive().max(1_000_000).optional(),
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  merchantId: z.string().min(1).max(100).optional(),
  payeeEmail: z.string().email().max(254).optional(),
  agentId: z.string().min(1).max(60).optional(),
  orderId: z.string().min(1).max(128).optional(),
});

export type InvestigateMerchantInput = z.infer<typeof InvestigateMerchantInputSchema>;

export function registerInvestigateMerchant(
  server: McpServer,
  api: GuardianApiClient
): void {
  server.registerTool(
    'investigate_merchant',
    {
      title: 'Investigate a merchant',
      description:
        'Check a merchant before paying. Returns a guardian decision (ALLOW, WARN or PAUSE) with evidence-backed reasons and the checks that ran. Never pays.',
      inputSchema: InvestigateMerchantInputSchema,
    },
    async (input) => {
      try {
        const data = await api.investigateMerchant({
          orderId: input.orderId ?? `preview-${randomUUID()}`,
          merchantUrl: input.merchantUrl,
          claimedBrand: input.claimedBrand,
          transactionAmount: input.amount,
          currency: input.currency,
          agentId: input.agentId,
          payee:
            input.merchantId === undefined
              ? undefined
              : { merchantId: input.merchantId, email: input.payeeEmail },
        });

        const verdict = normalizeVerdict(data);
        return toolResult(formatVerdict(verdict), { verdict });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
