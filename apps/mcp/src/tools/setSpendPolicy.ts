import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { GuardianApiClient } from '../apiClient.js';
import { errorResult, formatPolicy, toolResult } from '../format.js';

export const SetSpendPolicyInputSchema = z
  .object({
    agentId: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/),
    perOrderCap: z.number().nonnegative().max(1_000_000),
    dailyCap: z.number().nonnegative().max(10_000_000),
    firstPurchaseCap: z.number().nonnegative().max(1_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase()),
  })
  .refine((value) => value.perOrderCap <= value.dailyCap, {
    message: 'perOrderCap must not exceed dailyCap',
    path: ['perOrderCap'],
  });

export type SetSpendPolicyInput = z.infer<typeof SetSpendPolicyInputSchema>;

export function registerSetSpendPolicy(server: McpServer, api: GuardianApiClient): void {
  server.registerTool(
    'set_spend_policy',
    {
      title: 'Set a spend policy',
      description:
        'Set per-order, daily and first-purchase spending caps for an agent. The guardian enforces these caps when an order is created and finalized.',
      inputSchema: SetSpendPolicyInputSchema,
    },
    async (input) => {
      try {
        const data = await api.setSpendPolicy(input.agentId, {
          perOrderCap: input.perOrderCap,
          dailyCap: input.dailyCap,
          firstPurchaseCap: input.firstPurchaseCap,
          currency: input.currency,
        });

        return toolResult(formatPolicy(input.agentId, data), { policy: data });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
