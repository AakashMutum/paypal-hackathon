import { z } from 'zod';
import type { Request, Response } from 'express';
import { sendError } from '../middleware/errors.js';

const money = z.number().finite().positive().max(1_000_000);
const currency = z
  .string()
  .length(3)
  .transform((c) => c.toUpperCase());
const shortText = z.string().trim().min(1).max(200);
const item = z.object({
  name: shortText,
  quantity: z.number().int().min(1).max(100),
  unitPrice: z.number().finite().min(0).max(1_000_000),
});
const payee = z.object({ merchantId: shortText, email: z.string().email().max(254).optional() });

export const scanBody = z.object({ url: z.string().trim().min(3).max(2048) });

export const createOrderBody = z
  .object({
    storeId: z.string().trim().min(1).max(100).optional(),
    url: z.string().trim().min(3).max(2048).optional(),
    amount: money.optional(),
    buyerEmail: z.string().email().max(254).optional(),
    items: z
      .array(
        z.object({
          sku: z.string().max(100).optional(),
          name: shortText.optional(),
          price: z.number().finite().min(0).max(1_000_000),
          qty: z.number().int().min(1).max(100),
        }),
      )
      .max(50)
      .optional(),
  })
  .refine((b) => b.storeId || b.url, { message: 'storeId or url is required' });

export const acknowledgeBody = z.object({ note: z.string().max(500).optional() }).default({});

export const merchantBody = z.object({
  legalName: shortText,
  domain: shortText,
  paypalEmail: z.string().email().max(254),
  type: z.enum(['REGISTERED', 'INDIVIDUAL']),
  country: z.string().trim().min(2).max(60),
});

export const reportBody = z.object({
  domain: shortText,
  reason: z.string().trim().min(1).max(1000),
  investigationId: z.string().max(128).optional(),
});

export const policyBody = z.object({
  perOrderCap: z.number().finite().min(0).max(1_000_000),
  dailyCap: z.number().finite().min(0).max(10_000_000),
  firstPurchaseCap: z.number().finite().min(0).max(1_000_000).optional(),
  currency,
});

const merchantTarget = {
  merchantUrl: z.string().trim().min(3).max(2048).optional(),
  /** Older clients send a bare domain. */
  domain: z.string().trim().min(3).max(255).optional(),
};

export const investigationBody = z
  .object({
    orderId: z.string().max(128).optional(),
    ...merchantTarget,
    claimedBrand: z.string().max(80).optional(),
    transactionAmount: money.optional(),
    amount: money.optional(),
    currency: currency.optional(),
    payee: payee.optional(),
    agentId: z.string().max(60).optional(),
    items: z.array(item).max(20).optional(),
  })
  .refine((b) => b.merchantUrl || b.domain, { message: 'merchantUrl is required' });

export const checkoutBody = z
  .object({
    ...merchantTarget,
    merchant: z.object({ domain: z.string().max(255).optional(), brand: z.string().max(80).optional() }).optional(),
    amount: money,
    currency,
    merchantId: z.string().max(100).optional(),
    payeeEmail: z.string().email().max(254).optional(),
    payee: payee.optional(),
    claimedBrand: z.string().max(80).optional(),
    agentId: z.string().max(60).optional(),
    items: z.array(item).max(20).optional(),
  })
  .refine((b) => b.merchantUrl || b.domain || b.merchant?.domain, { message: 'merchantUrl is required' });

export const finalizeBody = z.object({ humanDecision: z.enum(['proceed', 'abort']).optional() }).default({});

/** Parses req.body with a schema; on failure sends 400 in the standard error envelope. */
export function parseBody<S extends z.ZodTypeAny>(schema: S, req: Request, res: Response): z.output<S> | undefined {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return result.data as z.output<S>;
  sendError(
    res,
    400,
    'VALIDATION_ERROR',
    'The request body is not valid.',
    result.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })),
  );
  return undefined;
}
