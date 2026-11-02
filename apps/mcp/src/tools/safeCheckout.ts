import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import {
  GuardianApiError,
  plainMessageFor,
  type GuardianApiClient,
} from '../apiClient.js';
import { errorResult, formatCheckout, toolResult } from '../format.js';
import { isSafePublicUrl } from '../security/publicUrl.js';

const ItemSchema = z.object({
  name: z.string().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
  unitPrice: z.number().positive(),
});

export const SafeCheckoutInputSchema = z
  .object({
    phase: z.enum(['create', 'finalize']).optional(),
    checkoutId: z.string().min(1).max(128).optional(),
    merchantUrl: z
      .string()
      .url()
      .max(2048)
      .refine(isSafePublicUrl, { message: 'merchantUrl must be a public http(s) address' })
      .optional(),
    amount: z.number().positive().max(1_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform((value) => value.toUpperCase())
      .optional(),
    merchantId: z.string().min(1).max(100).optional(),
    payeeEmail: z.string().email().max(254).optional(),
    claimedBrand: z.string().min(1).max(80).optional(),
    agentId: z.string().min(1).max(60).optional(),
    items: z.array(ItemSchema).max(20).optional(),
    humanDecision: z.enum(['proceed', 'abort']).optional(),
  })
  .superRefine((value, context) => {
    if (value.phase === 'finalize' && value.checkoutId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkoutId'],
        message: 'checkoutId is required when phase is finalize',
      });
    }

    if (value.phase === 'finalize' || value.checkoutId !== undefined) return;

    if (value.merchantUrl === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['merchantUrl'],
        message: 'merchantUrl is required when checkoutId is not supplied',
      });
    }
    if (value.amount === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'amount is required when checkoutId is not supplied',
      });
    }
    if (value.currency === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currency'],
        message: 'currency is required when checkoutId is not supplied',
      });
    }
    if (value.merchantId === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['merchantId'],
        message: 'merchantId is required when checkoutId is not supplied',
      });
    }
  });

export type SafeCheckoutInput = z.infer<typeof SafeCheckoutInputSchema>;

export function registerSafeCheckout(server: McpServer, api: GuardianApiClient): void {
  server.registerTool(
    'safe_checkout',
    {
      title: 'Run a guarded checkout',
      description:
        'Run a guarded checkout. Use phase=create with merchant details to hold an order, then phase=finalize with its checkoutId after human approval. Omitting phase creates and finalizes in one call. A PAUSE never pays. A WARN needs humanDecision proceed. Returns CAPTURED, NEEDS_HUMAN_DECISION or PAUSED.',
      inputSchema: SafeCheckoutInputSchema,
    },
    async (input) => {
      try {
        if (input.phase === 'finalize' || input.checkoutId !== undefined) {
          if (input.checkoutId === undefined) {
            throw new GuardianApiError(
              'VALIDATION_ERROR',
              plainMessageFor('VALIDATION_ERROR')
            );
          }

          const finalized = await api.finalizeCheckout(input.checkoutId, {
            humanDecision: input.humanDecision,
          });

          return toolResult(
            formatCheckout({ ...finalized, checkoutId: input.checkoutId }),
            { checkoutId: input.checkoutId, result: finalized }
          );
        }

        if (
          input.merchantUrl === undefined ||
          input.amount === undefined ||
          input.currency === undefined ||
          input.merchantId === undefined
        ) {
          throw new GuardianApiError(
            'VALIDATION_ERROR',
            plainMessageFor('VALIDATION_ERROR')
          );
        }

        const created = await api.createCheckout({
          merchantUrl: input.merchantUrl,
          amount: input.amount,
          currency: input.currency,
          merchantId: input.merchantId,
          payeeEmail: input.payeeEmail,
          claimedBrand: input.claimedBrand,
          agentId: input.agentId,
          items: input.items,
        });

        const checkoutId = created.checkoutId;
        if (typeof checkoutId !== 'string' || checkoutId.length === 0) {
          throw new GuardianApiError('BAD_RESPONSE', plainMessageFor('BAD_RESPONSE'));
        }

        if (input.phase === 'create') {
          return toolResult(formatCheckout(created), { checkout: created });
        }

        if (created.status !== undefined && created.status !== 'AWAITING_APPROVAL') {
          return toolResult(formatCheckout(created), { checkout: created });
        }

        const finalized = await api.finalizeCheckout(checkoutId, {
          humanDecision: input.humanDecision,
        });

        const payload = {
          ...finalized,
          checkoutId,
          approvalUrl: created.approvalUrl,
        };

        return toolResult(formatCheckout(payload), {
          checkout: created,
          result: finalized,
        });
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
